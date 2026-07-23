// ab-shadow-relay 是受控内网影子流量转发器。
//
// 使用方：调用方或 Nginx 的精确路径代理把已选定的无副作用 JSON 请求发送到本服务；
// 本服务同步转发生产端并将同一请求异步投递给 A/B 评估端。生产端响应是唯一返回给调用方
// 的响应，影子端的错误、超时和非 2xx 状态绝不会改变生产链路的结果。
//
// 关键依赖：仅使用 Go 标准库。所有目标、允许路径、允许方法和两类密钥都来自启动配置，
// 不接受请求动态指定，避免本服务成为开放代理或把客户端凭据泄露给影子服务。
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	defaultBind                      = ":3030"
	defaultTimeoutMilliseconds       = 5_000
	defaultMaxBodyBytes        int64 = 1 << 20
	defaultMaxInFlightShadows        = 32
	maxTimeoutMilliseconds           = 30_000
	maxBodyBytes               int64 = 8 << 20
	maxInFlightShadows               = 256
)

var traceIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

// relayConfig 是启动时验证完成的不可变配置。
// 目标仅允许固定 origin；allowedPaths/allowedMethods 共同构成最小白名单，防止误把
// 创建订单、扣费或 Webhook 等可变请求纳入影子流量。
type relayConfig struct {
	bind               string
	productionBaseURL  *url.URL
	shadowBaseURL      *url.URL
	inboundSecret      string
	shadowSecret       string
	allowedPaths       map[string]struct{}
	allowedMethods     map[string]struct{}
	timeout            time.Duration
	maxBodyBytes       int64
	maxInFlightShadows int
}

// shadowRequest 保存异步影子投递所需的最小、已脱敏请求数据。
// headers 仅包含内容协商和专用关联字段，永不保存 Authorization、Cookie 或其他客户端凭据。
type shadowRequest struct {
	method  string
	url     *url.URL
	headers http.Header
	body    []byte
	traceID string
}

// relayServer 聚合生产与影子 HTTP 客户端，以及限制影子并发的有界信号量。
// 信号量满时主动丢弃影子副本而非排队，保证 A/B 服务故障不会放大主服务内存和延迟。
type relayServer struct {
	config           relayConfig
	productionClient *http.Client
	shadowClient     *http.Client
	shadowSlots      chan struct{}
	logger           *log.Logger
}

// main 读取 fail-closed 配置并启动 HTTP 服务；任一必需配置缺失时拒绝启动。
// 收到 SIGTERM/SIGINT 时最多等待 30 秒处理在途请求，避免容器滚动更新截断生产响应。
func main() {
	config, err := loadRelayConfig(os.Getenv)
	if err != nil {
		log.Fatalf("ab-shadow-relay configuration error: %v", err)
	}

	server := newRelayServer(config, log.Default())
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", server.handleHealth)
	mux.HandleFunc("/", server.handleRelay)

	httpServer := &http.Server{
		Addr:              config.bind,
		Handler:           mux,
		ReadHeaderTimeout: 15 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       65 * time.Second,
		MaxHeaderBytes:    32 << 10,
	}

	log.Printf(
		"ab-shadow-relay listening on %s paths=%d methods=%d",
		config.bind,
		len(config.allowedPaths),
		len(config.allowedMethods),
	)
	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- httpServer.ListenAndServe()
	}()

	shutdownSignal, stopSignals := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stopSignals()

	select {
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("ab-shadow-relay server error: %v", err)
		}
	case <-shutdownSignal.Done():
		shutdownContext, cancelShutdown := context.WithTimeout(
			context.Background(),
			30*time.Second,
		)
		defer cancelShutdown()
		if err := httpServer.Shutdown(shutdownContext); err != nil {
			log.Printf("ab-shadow-relay graceful shutdown failed: %v", err)
		}
	}
}

// loadRelayConfig 从环境变量构造并校验配置。
//
// 返回错误而不是静默禁用的原因：此服务一旦被调用就属于生产链路的一部分；目标或密钥缺失时
// 返回显式 5xx 比误把流量发往错误位置更可审计。允许值在启动前固定，运行时请求不能扩大范围。
func loadRelayConfig(getenv func(string) string) (relayConfig, error) {
	productionBaseURL, err := parseBaseURL(
		getenv("AB_RELAY_PRODUCTION_URL"),
		"AB_RELAY_PRODUCTION_URL",
	)
	if err != nil {
		return relayConfig{}, err
	}

	shadowBaseURL, err := parseBaseURL(
		getenv("AB_RELAY_SHADOW_URL"),
		"AB_RELAY_SHADOW_URL",
	)
	if err != nil {
		return relayConfig{}, err
	}

	inboundSecret := strings.TrimSpace(getenv("AB_RELAY_INBOUND_SECRET"))
	if inboundSecret == "" {
		return relayConfig{}, errors.New("AB_RELAY_INBOUND_SECRET must be configured")
	}

	shadowSecret := strings.TrimSpace(getenv("AB_RELAY_SHADOW_SECRET"))
	if shadowSecret == "" {
		return relayConfig{}, errors.New("AB_RELAY_SHADOW_SECRET must be configured")
	}

	allowedPaths, err := parseAllowedPaths(getenv("AB_RELAY_ALLOWED_PATHS"))
	if err != nil {
		return relayConfig{}, err
	}

	allowedMethods, err := parseAllowedMethods(getenv("AB_RELAY_ALLOWED_METHODS"))
	if err != nil {
		return relayConfig{}, err
	}

	timeoutMilliseconds, err := parseBoundedInt(
		getenv("AB_RELAY_TIMEOUT_MS"),
		defaultTimeoutMilliseconds,
		1,
		maxTimeoutMilliseconds,
		"AB_RELAY_TIMEOUT_MS",
	)
	if err != nil {
		return relayConfig{}, err
	}

	maxBodyBytesValue, err := parseBoundedInt64(
		getenv("AB_RELAY_MAX_BODY_BYTES"),
		defaultMaxBodyBytes,
		1,
		maxBodyBytes,
		"AB_RELAY_MAX_BODY_BYTES",
	)
	if err != nil {
		return relayConfig{}, err
	}

	maxShadows, err := parseBoundedInt(
		getenv("AB_RELAY_MAX_IN_FLIGHT_SHADOWS"),
		defaultMaxInFlightShadows,
		1,
		maxInFlightShadows,
		"AB_RELAY_MAX_IN_FLIGHT_SHADOWS",
	)
	if err != nil {
		return relayConfig{}, err
	}

	bind := strings.TrimSpace(getenv("AB_RELAY_BIND"))
	if bind == "" {
		bind = defaultBind
	}

	return relayConfig{
		bind:               bind,
		productionBaseURL:  productionBaseURL,
		shadowBaseURL:      shadowBaseURL,
		inboundSecret:      inboundSecret,
		shadowSecret:       shadowSecret,
		allowedPaths:       allowedPaths,
		allowedMethods:     allowedMethods,
		timeout:            time.Duration(timeoutMilliseconds) * time.Millisecond,
		maxBodyBytes:       maxBodyBytesValue,
		maxInFlightShadows: maxShadows,
	}, nil
}

// parseBaseURL 仅接受不带路径、查询、片段和嵌入凭据的固定 HTTP(S) origin。
// 这样请求路径只能来自已校验的入站路径，目标主机只能来自部署配置，避免 SSRF 和开放代理。
func parseBaseURL(value string, name string) (*url.URL, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, fmt.Errorf("%s must be configured", name)
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("%s is invalid", name)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("%s must use http or https", name)
	}
	if parsed.Host == "" || parsed.Hostname() == "" {
		return nil, fmt.Errorf("%s must include a host", name)
	}
	if parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("%s must be an origin without credentials, path, query, or fragment", name)
	}
	return parsed, nil
}

// parseAllowedPaths 读取精确路径白名单，不支持通配符，防止一个宽泛规则意外覆盖高风险端点。
func parseAllowedPaths(value string) (map[string]struct{}, error) {
	paths := make(map[string]struct{})
	for _, rawPath := range strings.Split(value, ",") {
		path := strings.TrimSpace(rawPath)
		if path == "" {
			continue
		}
		if !strings.HasPrefix(path, "/") || strings.ContainsAny(path, "?#*") {
			return nil, errors.New("AB_RELAY_ALLOWED_PATHS must contain exact absolute paths")
		}
		paths[path] = struct{}{}
	}
	if len(paths) == 0 {
		return nil, errors.New("AB_RELAY_ALLOWED_PATHS must contain at least one path")
	}
	return paths, nil
}

// parseAllowedMethods 读取请求方法白名单；方法为空或包含空白字符时拒绝，避免请求走到未审查的语义。
func parseAllowedMethods(value string) (map[string]struct{}, error) {
	methods := make(map[string]struct{})
	for _, rawMethod := range strings.Split(value, ",") {
		method := strings.ToUpper(strings.TrimSpace(rawMethod))
		if method == "" {
			continue
		}
		if strings.ContainsAny(method, " \t\r\n") {
			return nil, errors.New("AB_RELAY_ALLOWED_METHODS must contain HTTP method tokens")
		}
		methods[method] = struct{}{}
	}
	if len(methods) == 0 {
		return nil, errors.New("AB_RELAY_ALLOWED_METHODS must contain at least one method")
	}
	return methods, nil
}

// parseBoundedInt 解析正整数配置，并在上界外失败而不是夹断，避免错误配置被静默放大。
func parseBoundedInt(value string, fallback int, min int, max int, name string) (int, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(trimmed)
	if err != nil || parsed < min || parsed > max {
		return 0, fmt.Errorf("%s must be an integer between %d and %d", name, min, max)
	}
	return parsed, nil
}

// parseBoundedInt64 与 parseBoundedInt 相同，但用于请求体字节数以避免 int 平台宽度差异。
func parseBoundedInt64(value string, fallback int64, min int64, max int64, name string) (int64, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil || parsed < min || parsed > max {
		return 0, fmt.Errorf("%s must be an integer between %d and %d", name, min, max)
	}
	return parsed, nil
}

// newRelayServer 创建两个不跟随重定向的 HTTP 客户端。
// 不跟随重定向可保证实际连接目标始终是启动时审查过的固定 origin，而不是上游响应指定的地址。
func newRelayServer(config relayConfig, logger *log.Logger) *relayServer {
	if logger == nil {
		logger = log.Default()
	}
	return &relayServer{
		config:           config,
		productionClient: newHTTPClient(),
		shadowClient:     newHTTPClient(),
		shadowSlots:      make(chan struct{}, config.maxInFlightShadows),
		logger:           logger,
	}
}

// newHTTPClient 构造连接池隔离的标准 HTTP 客户端，避免影子流量耗尽生产请求的连接池。
// 固定目标由内网直连，不继承 HTTP_PROXY/HTTPS_PROXY，防止配置错误时把影子正文送往外部代理。
func newHTTPClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          128,
			MaxIdleConnsPerHost:   32,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: time.Second,
		},
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// handleHealth 返回不包含配置、目标或密钥的最小健康状态，供受控编排器探测。
func (server *relayServer) handleHealth(writer http.ResponseWriter, _ *http.Request) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write([]byte(`{"status":"ok"}`))
}

// handleRelay 校验入站请求、并行启动影子副本、同步代理生产端并复制生产响应。
// 失败模式：鉴权、路径、格式或大小不符时在本地拒绝；生产端失败返回 502；影子端任何失败只记录日志。
func (server *relayServer) handleRelay(writer http.ResponseWriter, request *http.Request) {
	if request.URL.Path == "/healthz" {
		http.NotFound(writer, request)
		return
	}

	if !constantTimeEqual(
		request.Header.Get("X-AB-Relay-Secret"),
		server.config.inboundSecret,
	) {
		writeError(writer, http.StatusUnauthorized, "unauthorized")
		return
	}

	method := strings.ToUpper(request.Method)
	if _, allowed := server.config.allowedMethods[method]; !allowed {
		writeError(writer, http.StatusMethodNotAllowed, "method is not enabled for shadow relay")
		return
	}
	if _, allowed := server.config.allowedPaths[request.URL.Path]; !allowed {
		writeError(writer, http.StatusNotFound, "path is not enabled for shadow relay")
		return
	}
	if !isJSONContentType(request.Header.Get("Content-Type")) {
		writeError(writer, http.StatusUnsupportedMediaType, "only JSON requests are supported")
		return
	}
	if contentEncoding := request.Header.Get("Content-Encoding"); contentEncoding != "" && !strings.EqualFold(contentEncoding, "identity") {
		writeError(writer, http.StatusUnsupportedMediaType, "compressed request bodies are not supported")
		return
	}
	if request.ContentLength > server.config.maxBodyBytes {
		writeError(writer, http.StatusRequestEntityTooLarge, "request body is too large")
		return
	}

	body, err := readJSONBody(writer, request, server.config.maxBodyBytes)
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			writeError(writer, http.StatusRequestEntityTooLarge, "request body is too large")
			return
		}
		writeError(writer, http.StatusBadRequest, "invalid JSON request body")
		return
	}

	traceID := getTraceID(request.Header.Get("X-Trace-Id"))
	productionURL := makeTargetURL(server.config.productionBaseURL, request.URL, true)
	shadowURL := makeTargetURL(server.config.shadowBaseURL, request.URL, false)

	server.launchShadow(shadowRequest{
		method:  method,
		url:     shadowURL,
		headers: buildShadowHeaders(request.Header, traceID, server.config.shadowSecret),
		body:    body,
		traceID: traceID,
	})

	productionRequest, cancelProductionRequest, err := newUpstreamRequest(
		request.Context(),
		method,
		productionURL,
		body,
		buildProductionHeaders(request.Header, traceID),
		server.config.timeout,
	)
	if err != nil {
		server.logger.Printf("production request construction failed trace_id=%s", traceID)
		writeError(writer, http.StatusBadGateway, "production service is unavailable")
		return
	}
	defer cancelProductionRequest()

	response, err := server.productionClient.Do(productionRequest)
	if err != nil {
		server.logger.Printf(
			"production request failed trace_id=%s error_type=%T",
			traceID,
			err,
		)
		writeError(writer, http.StatusBadGateway, "production service is unavailable")
		return
	}
	defer response.Body.Close()

	copyResponse(writer, response)
}

// constantTimeEqual 通过固定长度 SHA-256 摘要进行恒定时间比较，避免密钥前缀计时侧信道。
func constantTimeEqual(actual string, expected string) bool {
	if actual == "" || expected == "" {
		return false
	}
	actualHash := sha256.Sum256([]byte(actual))
	expectedHash := sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(actualHash[:], expectedHash[:]) == 1
}

// isJSONContentType 只接受标准 JSON 和 +json 媒体类型，拒绝表单、multipart 与二进制上传。
func isJSONContentType(value string) bool {
	mediaType, _, err := mime.ParseMediaType(value)
	if err != nil {
		return false
	}
	return mediaType == "application/json" || strings.HasSuffix(mediaType, "+json")
}

// readJSONBody 在固定上限内读出请求体并验证 JSON 完整性。
// 内存缓冲是有意取舍：同一字节必须同时供生产和影子端独立读取，且服务只允许小体积 JSON。
func readJSONBody(writer http.ResponseWriter, request *http.Request, maxBytes int64) ([]byte, error) {
	defer request.Body.Close()
	body, err := io.ReadAll(http.MaxBytesReader(writer, request.Body, maxBytes))
	if err != nil {
		return nil, err
	}
	if !json.Valid(body) {
		return nil, errors.New("request body is not valid JSON")
	}
	return body, nil
}

// getTraceID 只接受符合 Nginx 同等字符集的上游追踪 ID；非法或缺失时生成服务端随机 ID。
func getTraceID(value string) string {
	trimmed := strings.TrimSpace(value)
	if traceIDPattern.MatchString(trimmed) {
		return trimmed
	}
	var randomBytes [16]byte
	if _, err := rand.Read(randomBytes[:]); err == nil {
		return hex.EncodeToString(randomBytes[:])
	}
	return strconv.FormatInt(time.Now().UnixNano(), 10)
}

// makeTargetURL 将已验证入站路径拼到固定 origin；不会使用入站 Host 或 scheme。
// 影子端不复制 query，避免将 URL 中意外携带的 API Key、签名或其他客户端凭据发送到 A/B 服务。
func makeTargetURL(baseURL *url.URL, incomingURL *url.URL, includeQuery bool) *url.URL {
	target := *baseURL
	target.Path = incomingURL.Path
	target.RawPath = incomingURL.RawPath
	if includeQuery {
		target.RawQuery = incomingURL.RawQuery
	} else {
		target.RawQuery = ""
	}
	target.Fragment = ""
	return &target
}

// newUpstreamRequest 使用独立超时构造可重复读取的请求；请求体由 bytes.Reader 提供，支持并发双发。
// 调用方在请求完成后必须调用返回的 cancel，以便及时释放超时计时器。
func newUpstreamRequest(
	parent context.Context,
	method string,
	targetURL *url.URL,
	body []byte,
	headers http.Header,
	timeout time.Duration,
) (*http.Request, context.CancelFunc, error) {
	contextWithTimeout, cancel := context.WithTimeout(parent, timeout)
	request, err := http.NewRequestWithContext(
		contextWithTimeout,
		method,
		targetURL.String(),
		bytes.NewReader(body),
	)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	request.Header = headers
	return request, cancel, nil
}

// buildProductionHeaders 复制生产端所需请求头，但移除 hop-by-hop、Host 和伪造转发地址头。
// 生产端仍会收到原 Authorization/Cookie；影子端绝不使用本函数，二者的身份边界不可混用。
func buildProductionHeaders(source http.Header, traceID string) http.Header {
	headers := copyHeaders(source)
	removeHopByHopHeaders(headers)
	for _, name := range []string{
		"Host",
		"Content-Length",
		"X-Ab-Relay-Secret",
		"X-Forwarded-For",
		"X-Forwarded-Host",
		"X-Forwarded-Proto",
		"X-Real-Ip",
	} {
		headers.Del(name)
	}
	headers.Set("X-Trace-Id", traceID)
	return headers
}

// buildShadowHeaders 重建影子端允许接收的最小请求头集。
// 客户端的认证、Cookie、API Key、转发地址及任意自定义头一律不复制；影子端只能依赖专用密钥。
func buildShadowHeaders(source http.Header, traceID string, shadowSecret string) http.Header {
	headers := make(http.Header)
	for _, name := range []string{
		"Accept",
		"Accept-Language",
		"Content-Language",
		"Content-Type",
		"User-Agent",
	} {
		for _, value := range source.Values(name) {
			headers.Add(name, value)
		}
	}
	headers.Set("X-AB-Shadow", "1")
	headers.Set("X-AB-Shadow-Secret", shadowSecret)
	headers.Set("X-Trace-Id", traceID)
	return headers
}

// copyHeaders 生成独立 Header 副本，避免生产与影子请求并发修改同一个底层 map。
func copyHeaders(source http.Header) http.Header {
	target := make(http.Header, len(source))
	for name, values := range source {
		copiedValues := make([]string, len(values))
		copy(copiedValues, values)
		target[name] = copiedValues
	}
	return target
}

// removeHopByHopHeaders 移除 RFC 7230 hop-by-hop 头和 Connection 声明的附加头。
func removeHopByHopHeaders(headers http.Header) {
	connectionHeaders := strings.Split(headers.Get("Connection"), ",")
	for _, name := range connectionHeaders {
		if trimmed := strings.TrimSpace(name); trimmed != "" {
			headers.Del(trimmed)
		}
	}
	for _, name := range []string{
		"Connection",
		"Keep-Alive",
		"Proxy-Authenticate",
		"Proxy-Authorization",
		"Te",
		"Trailer",
		"Transfer-Encoding",
		"Upgrade",
	} {
		headers.Del(name)
	}
}

// launchShadow 在有空闲槽位时立即启动异步投递；槽位耗尽时仅记录指标友好的日志并直接返回。
func (server *relayServer) launchShadow(request shadowRequest) {
	select {
	case server.shadowSlots <- struct{}{}:
		go func() {
			defer func() { <-server.shadowSlots }()
			server.forwardShadow(request)
		}()
	default:
		server.logger.Printf("shadow request dropped reason=concurrency_limit trace_id=%s", request.traceID)
	}
}

// forwardShadow 将请求发送到 A/B 端并记录不含正文、凭据或查询参数的结果。
// 即使 A/B 返回 5xx、网络失败或超时，函数也只记录日志，绝不向生产请求传播错误。
func (server *relayServer) forwardShadow(request shadowRequest) {
	upstreamRequest, cancelShadowRequest, err := newUpstreamRequest(
		context.Background(),
		request.method,
		request.url,
		request.body,
		request.headers,
		server.config.timeout,
	)
	if err != nil {
		server.logger.Printf("shadow request construction failed trace_id=%s", request.traceID)
		return
	}
	defer cancelShadowRequest()

	startedAt := time.Now()
	response, err := server.shadowClient.Do(upstreamRequest)
	duration := time.Since(startedAt)
	if err != nil {
		server.logger.Printf(
			"shadow request failed trace_id=%s duration_ms=%d error_type=%T",
			request.traceID,
			duration.Milliseconds(),
			err,
		)
		return
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		server.logger.Printf(
			"shadow request returned non-success trace_id=%s status=%d duration_ms=%d",
			request.traceID,
			response.StatusCode,
			duration.Milliseconds(),
		)
		return
	}
	server.logger.Printf(
		"shadow request completed trace_id=%s status=%d duration_ms=%d",
		request.traceID,
		response.StatusCode,
		duration.Milliseconds(),
	)
}

// copyResponse 将生产端状态、允许响应头和流式正文返回调用方；写入失败通常表示客户端已断开。
func copyResponse(writer http.ResponseWriter, response *http.Response) {
	headers := copyHeaders(response.Header)
	removeHopByHopHeaders(headers)
	for name, values := range headers {
		for _, value := range values {
			writer.Header().Add(name, value)
		}
	}
	writer.WriteHeader(response.StatusCode)
	_, _ = io.Copy(writer, response.Body)
}

// writeError 生成不泄露上游地址、密钥或内部网络详情的稳定 JSON 错误响应。
func writeError(writer http.ResponseWriter, status int, message string) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_, _ = writer.Write([]byte(fmt.Sprintf(`{"error":%q}`, message)))
}
