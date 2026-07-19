/**
 * 存储 provider 的运行时选择与缓存入口。
 *
 * 使用方：Server Actions、UOL、后台任务和 API 路由。每次获取都会读取统一系统
 * 设置快照，并按不含明文密钥的配置指纹复用 provider；配置变化后立即切换，
 * 无需重启进程。
 */

import type { StorageProvider } from "../types";
import {
  createStorageProviderFingerprint,
  getStorageRuntimeConfig,
  type StorageRuntimeConfig,
} from "./runtime-config";

/** 进程内 provider 缓存，只保存安全指纹和已绑定配置的实例。 */
let cachedProvider:
  | {
      fingerprint: string;
      provider: StorageProvider;
    }
  | undefined;

/**
 * 一次业务调用使用的存储快照。
 *
 * provider、bucket 与 endpoint 来自同一配置读取，避免设置切换瞬间一次请求
 * 混用新旧值。凭证只封装在 provider 内，不向调用方暴露。
 */
export interface StorageRuntimeSnapshot {
  provider: StorageProvider;
  bucketName: string;
  endpoint: string | null;
}

/**
 * 按配置快照解析或复用 provider。
 *
 * @param config 当前存储配置快照
 * @returns 与该快照绑定的 local 或 S3 provider
 * @remarks 配置指纹改变时替换缓存；切到 local 时销毁遗留 S3 client
 */
async function resolveStorageProvider(
  config: StorageRuntimeConfig
): Promise<StorageProvider> {
  const fingerprint = createStorageProviderFingerprint(config);
  if (cachedProvider?.fingerprint === fingerprint) {
    return cachedProvider.provider;
  }

  let provider: StorageProvider;
  if (config.endpoint) {
    const { createS3StorageProvider, prepareS3ClientConfig } = await import(
      "./s3"
    );
    prepareS3ClientConfig(config);
    provider = createS3StorageProvider(config);
  } else {
    const [{ createLocalStorageProvider }, { destroyCachedS3Client }] =
      await Promise.all([import("./local"), import("./s3")]);
    destroyCachedS3Client();
    provider = createLocalStorageProvider(config.localStoragePath);
  }

  cachedProvider = { fingerprint, provider };
  return provider;
}

/**
 * 获取当前存储运行时快照。
 *
 * @returns 同一配置版本的 provider、通用上传桶和 endpoint
 * @remarks 读取系统设置并可能重建 provider/S3 client；读取失败时原样上抛
 */
export async function getStorageRuntimeSnapshot(): Promise<StorageRuntimeSnapshot> {
  const config = await getStorageRuntimeConfig();
  const provider = await resolveStorageProvider(config);
  return {
    provider,
    bucketName: config.bucketName,
    endpoint: config.endpoint,
  };
}

/**
 * 获取当前存储提供者。
 *
 * @returns 动态配置对应的 provider
 * @remarks 每次调用都校验配置指纹，命中时复用实例
 */
export async function getStorageProvider(): Promise<StorageProvider> {
  return (await getStorageRuntimeSnapshot()).provider;
}

export { getStorageRuntimeConfig } from "./runtime-config";
