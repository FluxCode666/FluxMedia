// ab-shadow-relay 的行为测试。
//
// 使用方：服务维护者在改动转发、安全头、超时或并发逻辑时运行。测试使用 httptest
// 伪造生产与影子服务，不访问数据库、真实网络或任何机密环境变量。
package main

import (
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// testRelayConfig 为每个测试构造最小、安全的已验证配置。
func testRelayConfig(productionURL string, shadowURL string) relayConfig {
	productionBaseURL, err := url.Parse(productionURL)
	if err != nil {
		panic(err)
	}
	shadowBaseURL, err := url.Parse(shadowURL)
	if err != nil {
		panic(err)
	}
	return relayConfig{
		productionBaseURL:  productionBaseURL,
		shadowBaseURL:      shadowBaseURL,
		inboundSecret:      "inbound-test-secret",
		shadowSecret:       "shadow-test-secret",
		allowedPaths:       map[string]struct{}{"/internal/evaluate": {}},
		allowedMethods:     map[string]struct{}{http.MethodPost: {}},
		timeout:            time.Second,
		maxBodyBytes:       1024,
		maxInFlightShadows: 2,
	}
}

// newTestRelayServer 创建不会把测试日志写到终端的 relay 服务。
func newTestRelayServer(config relayConfig) *relayServer {
	return newRelayServer(config, log.New(io.Discard, "", 0))
}

// newRelayRequest 构造通过入站鉴权且带 JSON 正文的标准测试请求。
func newRelayRequest(body string) *http.Request {
	request := httptest.NewRequest(
		http.MethodPost,
		"http://relay.internal/internal/evaluate?model=ab-v2",
		strings.NewReader(body),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-AB-Relay-Secret", "inbound-test-secret")
	return request
}

// TestRelayForwardsProductionAndShadowsWithoutClientCredentials 覆盖主响应和影子副本的身份边界。
func TestRelayForwardsProductionAndShadowsWithoutClientCredentials(t *testing.T) {
	shadowReceived := make(chan *http.Request, 1)
	shadowServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		shadowReceived <- request.Clone(request.Context())
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Errorf("读取影子请求正文失败: %v", err)
		}
		if string(body) != `{"prompt":"test"}` {
			t.Errorf("影子正文不一致: %s", body)
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer shadowServer.Close()

	productionServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer production-user-token" {
			t.Errorf("生产端未收到原始 Authorization")
		}
		if request.Header.Get("Cookie") != "session=production-user-cookie" {
			t.Errorf("生产端未收到原始 Cookie")
		}
		if request.Header.Get("X-Trace-Id") != "trace-42" {
			t.Errorf("生产端 trace id 不正确: %q", request.Header.Get("X-Trace-Id"))
		}
		if request.URL.RawQuery != "model=ab-v2" {
			t.Errorf("生产端查询参数不正确: %q", request.URL.RawQuery)
		}
		if request.Header.Get("X-AB-Relay-Secret") != "" {
			t.Errorf("生产端不应收到 relay 入站密钥")
		}
		writer.Header().Set("X-Production", "yes")
		writer.WriteHeader(http.StatusCreated)
		_, _ = writer.Write([]byte(`{"result":"production"}`))
	}))
	defer productionServer.Close()

	server := newTestRelayServer(testRelayConfig(productionServer.URL, shadowServer.URL))
	request := newRelayRequest(`{"prompt":"test"}`)
	request.Header.Set("Authorization", "Bearer production-user-token")
	request.Header.Set("Cookie", "session=production-user-cookie")
	request.Header.Set("X-Api-Key", "client-api-key")
	request.Header.Set("X-Trace-Id", "trace-42")
	response := httptest.NewRecorder()

	server.handleRelay(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("生产响应状态码 = %d，期望 %d", response.Code, http.StatusCreated)
	}
	if response.Header().Get("X-Production") != "yes" {
		t.Fatal("未复制生产响应头")
	}
	if response.Body.String() != `{"result":"production"}` {
		t.Fatalf("生产响应正文 = %s", response.Body.String())
	}

	select {
	case shadowRequest := <-shadowReceived:
		if shadowRequest.URL.RawQuery != "" {
			t.Fatalf("影子端不应收到查询参数: %q", shadowRequest.URL.RawQuery)
		}
		if shadowRequest.Header.Get("Authorization") != "" {
			t.Fatal("影子端不应收到 Authorization")
		}
		if shadowRequest.Header.Get("Cookie") != "" {
			t.Fatal("影子端不应收到 Cookie")
		}
		if shadowRequest.Header.Get("X-Api-Key") != "" {
			t.Fatal("影子端不应收到客户端 API Key")
		}
		if shadowRequest.Header.Get("X-AB-Shadow-Secret") != "shadow-test-secret" {
			t.Fatal("影子端未收到专用密钥")
		}
		if shadowRequest.Header.Get("X-AB-Shadow") != "1" {
			t.Fatal("影子端未收到影子标记")
		}
		if shadowRequest.Header.Get("X-Trace-Id") != "trace-42" {
			t.Fatal("影子端 trace id 不正确")
		}
	case <-time.After(time.Second):
		t.Fatal("未收到影子请求")
	}
}

// TestRelayRejectsInvalidRequestsBeforeAnyForwarding 确保未鉴权、未白名单和非法 JSON 不会离开本服务。
func TestRelayRejectsInvalidRequestsBeforeAnyForwarding(t *testing.T) {
	upstreamCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		upstreamCalls++
	}))
	defer upstream.Close()

	server := newTestRelayServer(testRelayConfig(upstream.URL, upstream.URL))
	testCases := []struct {
		name       string
		request    *http.Request
		wantStatus int
	}{
		{
			name: "缺少密钥",
			request: func() *http.Request {
				request := newRelayRequest(`{"prompt":"test"}`)
				request.Header.Del("X-AB-Relay-Secret")
				return request
			}(),
			wantStatus: http.StatusUnauthorized,
		},
		{
			name: "未白名单路径",
			request: func() *http.Request {
				request := newRelayRequest(`{"prompt":"test"}`)
				request.URL.Path = "/v1/images/generations"
				return request
			}(),
			wantStatus: http.StatusNotFound,
		},
		{
			name:       "非法 JSON",
			request:    newRelayRequest(`{"prompt":`),
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			server.handleRelay(response, testCase.request)
			if response.Code != testCase.wantStatus {
				t.Fatalf("状态码 = %d，期望 %d", response.Code, testCase.wantStatus)
			}
		})
	}
	if upstreamCalls != 0 {
		t.Fatalf("非法请求不应转发，实际调用数 = %d", upstreamCalls)
	}
}

// TestRelayDoesNotWaitForShadowResponse 验证影子端卡住不会拖慢生产响应。
func TestRelayDoesNotWaitForShadowResponse(t *testing.T) {
	shadowStarted := make(chan struct{})
	shadowRelease := make(chan struct{})
	shadowServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		close(shadowStarted)
		<-shadowRelease
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer shadowServer.Close()

	productionServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"result":"production"}`))
	}))
	defer productionServer.Close()

	server := newTestRelayServer(testRelayConfig(productionServer.URL, shadowServer.URL))
	response := httptest.NewRecorder()
	finished := make(chan struct{})
	go func() {
		server.handleRelay(response, newRelayRequest(`{"prompt":"test"}`))
		close(finished)
	}()

	select {
	case <-shadowStarted:
	case <-time.After(time.Second):
		t.Fatal("影子请求未启动")
	}

	select {
	case <-finished:
		if response.Code != http.StatusOK {
			t.Fatalf("生产响应状态码 = %d", response.Code)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("生产响应错误等待影子服务")
	}

	close(shadowRelease)
}

// TestLoadRelayConfigRejectsUnsafeOrMissingSettings 覆盖启动时 fail-closed 的主要配置边界。
func TestLoadRelayConfigRejectsUnsafeOrMissingSettings(t *testing.T) {
	base := map[string]string{
		"AB_RELAY_PRODUCTION_URL":        "http://production.internal:8080",
		"AB_RELAY_SHADOW_URL":            "https://ab.internal",
		"AB_RELAY_INBOUND_SECRET":        "inbound",
		"AB_RELAY_SHADOW_SECRET":         "shadow",
		"AB_RELAY_ALLOWED_PATHS":         "/internal/evaluate",
		"AB_RELAY_ALLOWED_METHODS":       "POST",
		"AB_RELAY_TIMEOUT_MS":            "",
		"AB_RELAY_MAX_BODY_BYTES":        "",
		"AB_RELAY_MAX_IN_FLIGHT_SHADOWS": "",
	}
	getenv := func(values map[string]string) func(string) string {
		return func(key string) string { return values[key] }
	}

	if _, err := loadRelayConfig(getenv(base)); err != nil {
		t.Fatalf("合法配置不应失败: %v", err)
	}

	testCases := []struct {
		name  string
		key   string
		value string
	}{
		{name: "缺少入站密钥", key: "AB_RELAY_INBOUND_SECRET", value: ""},
		{name: "生产 URL 带凭据", key: "AB_RELAY_PRODUCTION_URL", value: "https://user:pass@production.internal"},
		{name: "影子 URL 带路径", key: "AB_RELAY_SHADOW_URL", value: "https://ab.internal/evaluate"},
		{name: "路径通配符", key: "AB_RELAY_ALLOWED_PATHS", value: "/v1/*"},
		{name: "超长超时", key: "AB_RELAY_TIMEOUT_MS", value: "30001"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			values := make(map[string]string, len(base))
			for key, value := range base {
				values[key] = value
			}
			values[testCase.key] = testCase.value
			if _, err := loadRelayConfig(getenv(values)); err == nil {
				t.Fatal("不安全配置应被拒绝")
			}
		})
	}
}
