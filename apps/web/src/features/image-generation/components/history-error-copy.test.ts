/** 历史记录安全错误本地化测试，锁定未知文本不会被直接展示。 */

import { describe, expect, it } from "vitest";
import { formatHistoryError } from "./history-error-copy";

const zhCopy = (_en: string, zh: string) => zh;

describe("formatHistoryError", () => {
  it("本地化稳定错误", () => {
    expect(formatHistoryError("Generation timed out", zhCopy)).toBe("生成超时");
  });

  it("未知文本降级为通用失败且不透传", () => {
    expect(formatHistoryError("Failed query: select secret", zhCopy)).toBe(
      "生成失败"
    );
  });

  it("空错误保持为空", () => {
    expect(formatHistoryError(null, zhCopy)).toBeNull();
  });
});
