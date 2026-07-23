/**
 * 外接 API 普通持久化与旧治理输入守卫的源码契约测试。
 *
 * 替代已删除的 relayOnly 路径清单，确保所有入口拒绝旧字段，并且响应续承、
 * 视频与可编辑文件始终走正常业务路径。
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const JSON_HANDLER_FILES = [
  "image-generations.ts",
  "chat-completions.ts",
  "responses.ts",
  "video-generations.ts",
  "editable-file-generations.ts",
] as const;

/**
 * 读取指定外接 API handler 的源码。
 *
 * @param fileName handlers 目录内的文件名。
 * @returns UTF-8 源码文本；文件缺失时由 readFileSync 显式抛错。
 */
function readHandler(fileName: string): string {
  return readFileSync(
    new URL(`./handlers/${fileName}`, import.meta.url),
    "utf8"
  );
}

/**
 * 截取 handler 导出后的执行路径，避开同文件辅助函数声明造成的顺序误判。
 *
 * @param source 完整源码。
 * @returns 第一个外接 handler 导出起始至文件末尾的源码；导出缺失时测试失败。
 */
function getHandlerBody(source: string): string {
  const factoryStart = source.indexOf("function makeEditableFileHandler");
  const exportStart = source.indexOf("export const postExternal");
  const start = factoryStart >= 0 ? factoryStart : exportStart;
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start);
}

describe("normal persistence handlers", () => {
  it.each(
    JSON_HANDLER_FILES
  )("%s rejects deprecated governance fields before schema parsing", (fileName) => {
    const source = getHandlerBody(readHandler(fileName));
    const guard = source.indexOf("const deprecatedFieldResponse");
    const schemaParse = source.indexOf(".safeParse(body)");

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(schemaParse).toBeGreaterThan(guard);
  });

  it.each([
    "image-edits.ts",
    "agent-images.ts",
  ])("%s guards JSON and multipart input before compatibility conversion", (fileName) => {
    const source = getHandlerBody(readHandler(fileName));
    const firstGuard = source.indexOf("const deprecatedFieldResponse");
    const secondGuard = source.indexOf(
      "const deprecatedFieldResponse",
      firstGuard + 1
    );

    expect(firstGuard).toBeGreaterThanOrEqual(0);
    expect(source.indexOf("formDataFromJson(body)")).toBeGreaterThan(
      firstGuard
    );
    expect(secondGuard).toBeGreaterThan(firstGuard);
    expect(
      source.indexOf("getFormImageReferences(formData)", secondGuard)
    ).toBeGreaterThan(secondGuard);
  });

  it("persists Responses continuation state in streaming and JSON paths", () => {
    const source = getHandlerBody(readHandler("responses.ts"));

    expect(source).not.toContain("auth.relayOnly");
    expect(
      source.match(/await bindImageBackendStickyMember\(\{/g)
    ).toHaveLength(4);
    expect(source.match(/await storeResponsesContinuation\(\{/g)).toHaveLength(
      2
    );
  });

  it.each([
    "video-generations.ts",
    "editable-file-generations.ts",
  ])("%s has no relay policy gate before its normal capability path", (fileName) => {
    const source = getHandlerBody(readHandler(fileName));

    expect(source).not.toContain("relay-policy");
    expect(source).not.toContain("shouldRejectRelayOnly");
    expect(source).not.toContain("unsupported_relay_mode");
    expect(source).toContain("canUsePlanCapability");
  });
});
