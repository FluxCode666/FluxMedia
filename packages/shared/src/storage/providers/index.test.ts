/**
 * getStorageProvider 选择分支与单例缓存的 DB-free 单测
 *
 * mock 掉 ../../system-settings（其真实实现 import @repo/database），仅暴露
 * getRuntimeSettingString，从而验证：
 * - STORAGE_ENDPOINT 已配置时选 s3 provider；
 * - 未配置时回退 local provider；
 * - 首次解析后缓存，后续调用不再读取运行时设置。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  endpoint: "" as string | null,
}));

const getRuntimeSettingString = vi.hoisted(() =>
  vi.fn(async (key: string) => (key === "STORAGE_ENDPOINT" ? state.endpoint : null))
);

vi.mock("../../system-settings", () => ({
  getRuntimeSettingString,
}));

describe("getStorageProvider", () => {
  beforeEach(() => {
    vi.resetModules();
    getRuntimeSettingString.mockClear();
    state.endpoint = "";
  });

  it("STORAGE_ENDPOINT 已配置时选用 s3 provider", async () => {
    state.endpoint = "https://s3.example.com";

    const [{ getStorageProvider }, { s3Provider }] = await Promise.all([
      import("./index"),
      import("./s3"),
    ]);

    expect(await getStorageProvider()).toBe(s3Provider);
  });

  it("未配置 STORAGE_ENDPOINT 时回退 local provider", async () => {
    state.endpoint = "";

    const [{ getStorageProvider }, { localProvider }] = await Promise.all([
      import("./index"),
      import("./local"),
    ]);

    expect(await getStorageProvider()).toBe(localProvider);
  });

  it("缓存命中：多次调用仅读取一次运行时设置", async () => {
    state.endpoint = "https://s3.example.com";

    const { getStorageProvider } = await import("./index");
    const first = await getStorageProvider();
    const second = await getStorageProvider();

    expect(second).toBe(first);
    expect(getRuntimeSettingString).toHaveBeenCalledTimes(1);
  });
});
