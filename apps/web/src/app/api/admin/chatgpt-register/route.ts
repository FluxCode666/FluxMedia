/**
 * ChatGPT 账号注册机 SSE 接口
 *
 * 职责：调用本机 wine 环境中的 ChatGPTRegister.exe，实时推流注册日志，
 *   注册完成后将获得的 access token 导入生图池 web 账号。
 *
 * 使用方：管理后台 "注册机" Tab（chatgpt-register-tab.tsx）
 * 关键依赖：
 *   - wine 11（WINEPREFIX=/home/user1/.wine-reg，WINEARCH=win32）
 *   - ChatGPTRegister.exe（/home/user1/GPT2Image-Pro/注册机/）
 *   - importImageBackendWebAccountsFromAccessTokens（生图池 service）
 *   - @repo/shared/auth（鉴权）、@repo/shared/system-settings（读配置）
 *
 * 安全设计：
 *   - 仅管理员可调用（getUserRoleById + canAccessAdminArea）
 *   - 代理凭据、API Key 从服务端系统设置读取，从不暴露给客户端
 *   - count/concurrency 服务端硬限
 *   - 不允许外部指定 exe 路径，路径为服务端常量
 */
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { auth } from "@repo/shared/auth";
import { canAccessAdminArea } from "@repo/shared/auth/roles";
import { getUserRoleById } from "@repo/shared/auth/role-server";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { importImageBackendWebAccountsFromAccessTokens } from "@/features/image-backend-pool/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_COUNT = 500;
const MAX_CONCURRENCY = 50;

const EXE_DIR = resolve("/home/user1/GPT2Image-Pro/注册机");
const EXE_PATH = join(EXE_DIR, "ChatGPTRegister.exe");
const AT_PATH = join(EXE_DIR, "at.txt");
const CONFIG_PATH = join(EXE_DIR, "config.yaml");
const WINE_PREFIX = "/home/user1/.wine-reg";

// 进程内单槽并发护栏：config.yaml/at.txt 为固定共享路径，多次并发运行会互相
// 覆盖配置、清空对方正在写入的 at.txt，导致 token 丢失或错配。同一时刻只允许
// 一个注册任务运行（best-effort，仅本进程内有效）。
let registerRunning = false;

const requestSchema = z.object({
  count: z.coerce.number().int().min(1).max(MAX_COUNT).default(1),
  concurrency: z.coerce.number().int().min(1).max(MAX_CONCURRENCY).default(5),
  webGroupId: z.string().trim().min(1).optional().nullable(),
  namePrefix: z.string().trim().max(80).optional(),
});

type SseEvent =
  | { type: "log"; line: string }
  | { type: "imported"; imported: number; failed: number; skipped: number }
  | { type: "error"; message: string }
  | { type: "done" };

// 转义进双引号 YAML 标量的值：反斜杠与双引号须转义，换行/制表符等控制字符
// 用转义序列，避免管理员配置中的特殊字符破坏 YAML 结构或注入额外字段。
function yamlDoubleQuote(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function buildConfigYaml(opts: {
  moemailBaseUrl: string;
  moemailApiKey: string;
  moemailDomain: string;
  proxy: string;
}): string {
  const domain = yamlDoubleQuote(opts.moemailDomain || "pt.sanyela.shop");
  const baseUrl = yamlDoubleQuote(
    opts.moemailBaseUrl || "https://mail.52ai.org"
  );
  const apiKey = yamlDoubleQuote(opts.moemailApiKey);
  const proxy = yamlDoubleQuote(opts.proxy || "");
  return `moemail:
  base_url: "${baseUrl}"
  api_key: "${apiKey}"
  domains:
    - "${domain}"
  expiry_time: 3600000

tempmail:
  base_url: "https://mail.gpthotmail.com"
  api_key: ""
  domain: "mail.gpthotmail.com"

register:
  email_provider: "moemail"
  mail_file: "mail.txt"
  mail_state_file: "mail_state.txt"
  proxy: "${proxy}"
  otp_timeout: 120
  client_version: "prod-3f327b5d73ca80c8edee280ace6683769bc8f8b1"
  client_build_number: "5438759"
  skip_oauth: true

cpa:
  enabled: false

panel:
  enabled: false
  base_url: "http://127.0.0.1:8000"
  bearer_token: ""
  plan_type: "free"
  proxy: ""
  remark: ""
`;
}

export async function POST(request: NextRequest) {
  // 鉴权：仅管理员可调用
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "未登录" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const role = await getUserRoleById(session.user.id);
  if (!canAccessAdminArea(role)) {
    return new Response(JSON.stringify({ error: "无权限" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 解析请求参数
  let params: z.infer<typeof requestSchema>;
  try {
    const body = await request.json();
    params = requestSchema.parse(body);
  } catch {
    return new Response(JSON.stringify({ error: "参数错误" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 并发护栏：已有任务在跑则拒绝，避免共享 config.yaml/at.txt 竞态。
  if (registerRunning) {
    return new Response(
      JSON.stringify({ error: "已有注册任务正在运行，请等待完成后再试" }),
      { status: 409, headers: { "Content-Type": "application/json" } }
    );
  }
  registerRunning = true;

  const encoder = new TextEncoder();
  const flushPadding = `: ${" ".repeat(2048)}\n\n`;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const emit = (event: SseEvent) => {
        write(`data: ${JSON.stringify(event)}\n\n${flushPadding}`);
      };

      // 心跳定时器，防止 nginx/代理断连
      const keepAlive = setInterval(() => {
        write(`: ping\n\n${flushPadding}`);
      }, 5_000);

      try {
        // 从系统设置读取配置
        const [apiKey, baseUrl, domain, proxy] = await Promise.all([
          getRuntimeSettingString("CHATGPT_REGISTER_MOEMAIL_API_KEY"),
          getRuntimeSettingString("CHATGPT_REGISTER_MOEMAIL_BASE_URL"),
          getRuntimeSettingString("CHATGPT_REGISTER_MOEMAIL_DOMAIN"),
          getRuntimeSettingString("CHATGPT_REGISTER_PROXY"),
        ]);

        if (!apiKey) {
          emit({ type: "error", message: "未配置 Moemail API Key" });
          return;
        }
        if (!domain) {
          emit({ type: "error", message: "未配置邮箱域名" });
          return;
        }

        // 写入 config.yaml
        const configYaml = buildConfigYaml({
          moemailBaseUrl: baseUrl ?? "",
          moemailApiKey: apiKey,
          moemailDomain: domain,
          proxy: proxy ?? "",
        });
        await writeFile(CONFIG_PATH, configYaml, "utf-8");

        emit({ type: "log", line: `[注册机] 启动 ${params.count} 个账号，并发 ${params.concurrency}` });

        // 清空上次的 at.txt
        await writeFile(AT_PATH, "", "utf-8");

        // 启动 wine 进程
        const wineProcess = spawn(
          "wine",
          [`Z:${EXE_PATH.replace(/\//g, "\\")}`],
          {
            cwd: EXE_DIR,
            env: {
              ...process.env,
              WINEPREFIX: WINE_PREFIX,
              WINEARCH: "win32",
              WINEDEBUG: "-all",
            },
            stdio: ["pipe", "pipe", "pipe"],
          }
        );

        // stdin 自身的 error（如 wine 缺失导致管道破裂 EPIPE）若无监听器会被
        // Node 当作未捕获异常抛出，拖垮服务进程；这里吞掉，真正的失败由下方的
        // wineProcess "error"/"close" 事件统一上报。
        wineProcess.stdin.on("error", () => {});
        // 输入 count 和 concurrency
        try {
          wineProcess.stdin.write(`${params.count}\n${params.concurrency}\n`);
          wineProcess.stdin.end();
        } catch {
          // 进程已退出，写入失败；交由 "error"/"close" 处理
        }

        // 推流 stdout
        let stdoutBuf = "";
        wineProcess.stdout.on("data", (chunk: Buffer) => {
          stdoutBuf += chunk.toString("utf-8");
          const lines = stdoutBuf.split("\n");
          stdoutBuf = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              emit({ type: "log", line: trimmed });
            }
          }
        });

        // stderr 同样推流（注册机日志也走 stderr）
        let stderrBuf = "";
        wineProcess.stderr.on("data", (chunk: Buffer) => {
          stderrBuf += chunk.toString("utf-8");
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("wine:") && !trimmed.startsWith("fixme:")) {
              emit({ type: "log", line: trimmed });
            }
          }
        });

        // 等待进程结束
        await new Promise<void>((resolve, reject) => {
          wineProcess.on("close", (code) => {
            if (code !== 0 && code !== null) {
              reject(new Error(`注册机进程退出码 ${code}`));
            } else {
              resolve();
            }
          });
          wineProcess.on("error", reject);
        });

        // 剩余缓冲推出
        if (stdoutBuf.trim()) emit({ type: "log", line: stdoutBuf.trim() });
        if (stderrBuf.trim() && !stderrBuf.trim().startsWith("wine:")) {
          emit({ type: "log", line: stderrBuf.trim() });
        }

        // 读取 at.txt 并导入
        const atContent = await readFile(AT_PATH, "utf-8").catch(() => "");
        const tokens = atContent
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("eyJ"));

        if (tokens.length === 0) {
          emit({ type: "log", line: "[注册机] 未获得任何 access token，跳过导入" });
          emit({ type: "imported", imported: 0, failed: 0, skipped: 0 });
          return;
        }

        emit({ type: "log", line: `[注册机] 获得 ${tokens.length} 个 token，开始导入生图池...` });

        const importResult = await importImageBackendWebAccountsFromAccessTokens({
          accessTokensText: tokens.join("\n"),
          webGroupId: params.webGroupId ?? null,
          namePrefix: params.namePrefix ?? null,
          model: null,
          contentSafetyEnabled: true,
          priority: 50,
          concurrency: 5,
        });

        const imported =
          (importResult.syncedByMode?.web ?? 0) +
          (importResult.syncedByMode?.responses ?? 0);
        const failed =
          (importResult.failedByMode?.web ?? 0) +
          (importResult.failedByMode?.responses ?? 0);
        const skipped =
          (importResult.skipped?.web ?? 0) +
          (importResult.skipped?.responses ?? 0);

        emit({
          type: "imported",
          imported,
          failed,
          skipped,
        });
        emit({ type: "log", line: `[注册机] 导入完成：成功 ${imported}，失败 ${failed}，跳过 ${skipped}` });
      } catch (error) {
        emit({
          type: "error",
          message: error instanceof Error ? error.message : "未知错误",
        });
      } finally {
        // 释放并发护栏，允许下一次注册任务运行。
        registerRunning = false;
        clearInterval(keepAlive);
        emit({ type: "done" });
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // 已关闭
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
