import { createHash, randomBytes } from "node:crypto";
import type { ApiConfig } from "./types";

export type OpenAIPromptCacheKeyOptions = {
  scope: string;
  model?: string;
  imageModel?: string;
  agentMode?: boolean;
  promptOptimization?: boolean;
  toolSignature?: string;
  // 本次请求的【每请求唯一盐值】(见 buildPromptCacheSalt)。必须并入 key,使 prompt_cache_key
  // 每请求唯一——否则同后端/同 model 的请求会得到相同 prompt_cache_key,若上游中转误把它当
  // 结果缓存键,就会(a)串图:不同输入返回同一张缓存图(实测 700/1000 串);(b)无法变体:用户
  // 传同一张图想要不同结果时被返回缓存的同一张。每请求唯一即可同时杜绝两者。
  inputSignature?: string;
};

function backendScope(config: ApiConfig) {
  const backend = config.backend;
  if (!backend?.id) return backend?.type || "direct";
  return [
    backend.type,
    backend.id,
    backend.accountBackend,
    backend.apiInterfaceMode,
    backend.imagesUpstreamMode,
    backend.chatCompletionsUpstreamMode,
  ]
    .filter(Boolean)
    .join(":");
}

export function buildOpenAIPromptCacheKey(
  config: ApiConfig,
  options: OpenAIPromptCacheKeyOptions
) {
  const digest = createHash("sha256")
    .update("gpt2image:openai-prompt-cache:v2")
    .update("\n")
    .update(backendScope(config))
    .update("\n")
    .update(options.scope)
    .update("\n")
    .update(options.model || "")
    .update("\n")
    .update(options.imageModel || "")
    .update("\n")
    .update(options.agentMode ? "agent" : "standard")
    .update("\n")
    .update(options.promptOptimization === false ? "original" : "optimized")
    .update("\n")
    .update(options.toolSignature || "")
    .update("\n")
    // 关键:并入每请求唯一盐,使 prompt_cache_key 每请求唯一 → 中和上游中转误把它当结果缓存
    // 键的行为:不同输入不串图,同一输入也每次新鲜出图。
    .update(options.inputSignature || "")
    .digest("hex")
    .slice(0, 32);

  return `g2i_${digest}`;
}

/**
 * 生成【每请求唯一】的盐值,作为 buildOpenAIPromptCacheKey 的 inputSignature。
 *
 * WHY 用随机盐而非内容哈希:prompt_cache_key 本是 OpenAI 的 KV 前缀缓存提示,不该被中转拿来
 * 缓存结果;既然某中转误用了它,就让 key 每请求唯一,彻底中和其结果缓存——
 * 不同输入不串图,且同一输入也每次重新生成(用户传同图想要不同结果)。代价:完全重复的请求
 * 不再命中中转结果缓存(各自重新生成),这正符合"同图要不同结果"的预期;OpenAI 自身仍会自动
 * 缓存前缀,KV 收益损失很小。
 */
export function buildPromptCacheSalt(): string {
  return randomBytes(16).toString("hex");
}
