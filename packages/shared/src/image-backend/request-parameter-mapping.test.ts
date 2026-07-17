/** API 后端请求参数映射的纯函数测试。 */
import { describe, expect, it } from "vitest";

import {
  applyRequestParameterMappings,
  normalizeRequestParameterMappings,
} from "./request-parameter-mapping";

describe("request parameter mapping", () => {
  it("以 move 重命名顶层字段且不修改原载荷", () => {
    const input = { model: "nano-banana-pro", prompt: "a cat" };
    const result = applyRequestParameterMappings(input, [
      { source: "model", target: "model_id", mode: "move" },
    ]);

    expect(result).toEqual({ model_id: "nano-banana-pro", prompt: "a cat" });
    expect(input).toEqual({ model: "nano-banana-pro", prompt: "a cat" });
  });

  it("支持复制 Responses 嵌套工具参数", () => {
    const result = applyRequestParameterMappings(
      { tools: [{ type: "image_generation", model: "grok-imagine" }] },
      [
        {
          source: "tools.0.model",
          target: "tools.0.image_model",
          mode: "copy",
        },
      ]
    );

    expect(result).toEqual({
      tools: [
        {
          type: "image_generation",
          model: "grok-imagine",
          image_model: "grok-imagine",
        },
      ],
    });
  });

  it("允许 multipart 兼容的重复字段名称", () => {
    const result = applyRequestParameterMappings({ image: "binary" }, [
      { source: "image", target: "images[]", mode: "move" },
    ]);

    expect(result).toEqual({ "images[]": "binary" });
  });

  it("忽略缺失来源和不安全的数据库配置", () => {
    const result = applyRequestParameterMappings({ prompt: "a cat" }, [
      { source: "missing", target: "caption", mode: "move" },
      { source: "prompt", target: "__proto__.polluted", mode: "move" },
    ]);

    expect(result).toEqual({ prompt: "a cat" });
    expect(normalizeRequestParameterMappings("not-an-array")).toEqual([]);
  });
});
