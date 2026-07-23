/**
 * 头像上传大小限制单元测试。
 * 覆盖 Free 保守回退与 Starter 能力快照的精确字节边界，防止设置页再次把
 * 所有套餐固定为 5 MB。
 */

import { describe, expect, it } from "vitest";

import {
  isAvatarFileSizeAllowed,
  resolveAvatarMaxFileSizeBytes,
} from "./avatar-upload-limit";

const BYTES_PER_MEGABYTE = 1024 * 1024;
const FREE_MAX_FILE_SIZE_BYTES = 5 * BYTES_PER_MEGABYTE;
const STARTER_MAX_FILE_SIZE_BYTES = 20 * BYTES_PER_MEGABYTE;

describe("头像上传套餐大小限制", () => {
  it("Free 能力快照按 5 MB 上限处理精确边界", () => {
    const maxFileSizeBytes = resolveAvatarMaxFileSizeBytes(
      {
        limits: {
          maxFileSizeBytes: FREE_MAX_FILE_SIZE_BYTES,
        },
      },
      FREE_MAX_FILE_SIZE_BYTES
    );

    expect(maxFileSizeBytes).toBe(FREE_MAX_FILE_SIZE_BYTES);
    expect(resolveAvatarMaxFileSizeBytes(null, FREE_MAX_FILE_SIZE_BYTES)).toBe(
      FREE_MAX_FILE_SIZE_BYTES
    );
    expect(
      isAvatarFileSizeAllowed(FREE_MAX_FILE_SIZE_BYTES, maxFileSizeBytes)
    ).toBe(true);
    expect(
      isAvatarFileSizeAllowed(FREE_MAX_FILE_SIZE_BYTES + 1, maxFileSizeBytes)
    ).toBe(false);
  });

  it("Starter 能力快照把头像上限提升到 20 MB 并保留精确边界", () => {
    const maxFileSizeBytes = resolveAvatarMaxFileSizeBytes(
      {
        limits: {
          maxFileSizeBytes: STARTER_MAX_FILE_SIZE_BYTES,
        },
      },
      FREE_MAX_FILE_SIZE_BYTES
    );

    expect(maxFileSizeBytes).toBe(STARTER_MAX_FILE_SIZE_BYTES);
    expect(
      isAvatarFileSizeAllowed(STARTER_MAX_FILE_SIZE_BYTES, maxFileSizeBytes)
    ).toBe(true);
    expect(
      isAvatarFileSizeAllowed(STARTER_MAX_FILE_SIZE_BYTES + 1, maxFileSizeBytes)
    ).toBe(false);
  });
});
