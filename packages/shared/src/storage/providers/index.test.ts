/**
 * 存储 provider 动态选择与指纹缓存的 DB-free 单测。
 *
 * mock 系统设置读取，覆盖 local/S3 双向切换、同配置复用、连接配置与 bucket
 * 变化后的 provider 失效，以及同一运行时快照中的动态 bucket。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
}));

const getRuntimeSettingString = vi.hoisted(() =>
  vi.fn(async (key: string) => state.settings.get(key) ?? null)
);

vi.mock("../../system-settings", () => ({
  getRuntimeSettingString,
}));

/** 为 S3 分支填入一组完整的可测试配置。 */
function useS3Settings(): void {
  state.settings.set("STORAGE_ENDPOINT", "https://s3.example.com");
  state.settings.set("STORAGE_REGION", "auto");
  state.settings.set("STORAGE_ACCESS_KEY_ID", "access-key-a");
  state.settings.set("STORAGE_SECRET_ACCESS_KEY", "secret-key-a");
}

describe("getStorageProvider", () => {
  beforeEach(() => {
    vi.resetModules();
    getRuntimeSettingString.mockClear();
    state.settings.clear();
  });

  it("配置未变化时复用相同 provider", async () => {
    useS3Settings();
    const { getStorageProvider } = await import("./index");

    const first = await getStorageProvider();
    const second = await getStorageProvider();

    expect(second).toBe(first);
  });

  it("运行时支持 local 到 S3 再到 local 的双向切换", async () => {
    const { getStorageProvider } = await import("./index");

    const firstLocal = await getStorageProvider();
    expect(
      await firstLocal.getSignedUploadUrl("a.txt", "uploads", "text/plain")
    ).toBe("/api/storage/uploads/a.txt");

    useS3Settings();
    const s3 = await getStorageProvider();
    expect(s3).not.toBe(firstLocal);

    state.settings.delete("STORAGE_ENDPOINT");
    const secondLocal = await getStorageProvider();
    expect(secondLocal).not.toBe(s3);
    expect(secondLocal).not.toBe(firstLocal);
    expect(
      await secondLocal.getSignedUploadUrl("b.txt", "uploads", "text/plain")
    ).toBe("/api/storage/uploads/b.txt");
  });

  it("端点或密钥轮换后使 provider 缓存失效", async () => {
    useS3Settings();
    const { getStorageProvider } = await import("./index");

    const first = await getStorageProvider();
    state.settings.set("STORAGE_SECRET_ACCESS_KEY", "secret-key-b");
    const afterSecretRotation = await getStorageProvider();
    state.settings.set("STORAGE_ENDPOINT", "https://s3-b.example.com");
    const afterEndpointRotation = await getStorageProvider();

    expect(afterSecretRotation).not.toBe(first);
    expect(afterEndpointRotation).not.toBe(afterSecretRotation);
  });

  it("bucket 修改后立即出现在新的运行时快照中", async () => {
    useS3Settings();
    state.settings.set("STORAGE_BUCKET_NAME", "uploads-a");
    const { getStorageRuntimeSnapshot } = await import("./index");

    const first = await getStorageRuntimeSnapshot();
    state.settings.set("STORAGE_BUCKET_NAME", "uploads-b");
    const second = await getStorageRuntimeSnapshot();

    expect(first.bucketName).toBe("uploads-a");
    expect(second.bucketName).toBe("uploads-b");
    expect(second.provider).not.toBe(first.provider);
  });

  it("本地存储路径修改后使 local provider 缓存失效", async () => {
    state.settings.set("LOCAL_STORAGE_PATH", "/tmp/storage-a");
    const { getStorageProvider } = await import("./index");

    const first = await getStorageProvider();
    state.settings.set("LOCAL_STORAGE_PATH", "/tmp/storage-b");
    const second = await getStorageProvider();

    expect(second).not.toBe(first);
  });
});
