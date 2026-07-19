/**
 * 存储运行时配置读取与安全指纹生成。
 *
 * 使用方：provider 选择器、S3 client 缓存和上传路由。所有配置均经系统设置
 * 运行时读取，不在模块加载时快照 process.env；配置指纹只保留带进程随机密钥的
 * HMAC-SHA-256 摘要，
 * 避免缓存键或诊断信息暴露访问密钥。
 */

import { createHmac, randomBytes } from "node:crypto";

import { getRuntimeSettingString } from "../../system-settings";

/** 通用上传桶的默认名称，与旧预签名上传路由保持兼容。 */
export const DEFAULT_STORAGE_BUCKET_NAME = "gpt2image-uploads";

/** 本地存储的默认根目录。 */
export const DEFAULT_LOCAL_STORAGE_PATH = "./storage";

/** 仅存在于当前进程内的随机指纹密钥，避免低熵配置摘要被离线枚举。 */
const CONFIG_FINGERPRINT_KEY = randomBytes(32);

/**
 * 单次读取形成的存储配置快照。
 *
 * endpoint 为空表示使用本地存储；S3 凭证保持可空，直到实际创建 S3 client 时
 * 再统一校验，以便仅使用本地存储的部署无需配置无关密钥。
 */
export interface StorageRuntimeConfig {
  endpoint: string | null;
  region: string;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  bucketName: string;
  localStoragePath: string;
}

/**
 * 从统一系统设置层读取当前存储配置。
 *
 * @returns 当前请求可复用的一致配置对象；缺省值与历史行为兼容
 * @remarks 只读取配置，无额外副作用；底层缓存或数据库失败时原样上抛
 */
export async function getStorageRuntimeConfig(): Promise<StorageRuntimeConfig> {
  const [
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    bucketName,
    localStoragePath,
  ] = await Promise.all([
    getRuntimeSettingString("STORAGE_ENDPOINT"),
    getRuntimeSettingString("STORAGE_REGION"),
    getRuntimeSettingString("STORAGE_ACCESS_KEY_ID"),
    getRuntimeSettingString("STORAGE_SECRET_ACCESS_KEY"),
    getRuntimeSettingString("STORAGE_BUCKET_NAME"),
    getRuntimeSettingString("LOCAL_STORAGE_PATH"),
  ]);

  return {
    endpoint: endpoint || null,
    region: region || "auto",
    accessKeyId: accessKeyId || null,
    secretAccessKey: secretAccessKey || null,
    bucketName: bucketName || DEFAULT_STORAGE_BUCKET_NAME,
    localStoragePath: localStoragePath || DEFAULT_LOCAL_STORAGE_PATH,
  };
}

/**
 * 为配置字段生成不含明文的稳定指纹。
 *
 * @param scope 指纹用途，防止不同缓存域意外复用相同摘要
 * @param values 参与失效判断的配置值，允许包含密钥但绝不写入返回值
 * @returns 十六进制 HMAC-SHA-256 摘要
 * @remarks 纯函数；摘要仅用于进程内相等性判断，不用于鉴权或密钥派生
 */
function createConfigFingerprint(
  scope: string,
  values: ReadonlyArray<string | null>
): string {
  return createHmac("sha256", CONFIG_FINGERPRINT_KEY)
    .update(JSON.stringify([scope, ...values]))
    .digest("hex");
}

/**
 * 生成 provider 缓存指纹。
 *
 * @param config 当前存储配置快照
 * @returns 覆盖存储模式、连接参数、桶和本地路径的安全摘要
 */
export function createStorageProviderFingerprint(
  config: StorageRuntimeConfig
): string {
  return createConfigFingerprint("storage-provider-v1", [
    config.endpoint,
    config.region,
    config.accessKeyId,
    config.secretAccessKey,
    config.bucketName,
    config.localStoragePath,
  ]);
}

/**
 * 生成 S3 client 缓存指纹。
 *
 * @param config 当前存储配置快照
 * @returns 仅覆盖 S3 连接参数与凭证的安全摘要
 */
export function createS3ClientFingerprint(
  config: StorageRuntimeConfig
): string {
  return createConfigFingerprint("s3-client-v1", [
    config.endpoint,
    config.region,
    config.accessKeyId,
    config.secretAccessKey,
  ]);
}
