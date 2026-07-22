/**
 * 读取生图固定档位的运行时基础价格。
 *
 * 统一生图管线和展示页通过此模块取值，避免各处直接读取系统设置而产生缓存或
 * 默认值差异。模型、后端和分组倍率不在这里处理。
 */

import { getRuntimeSettingNumber } from "@repo/shared/system-settings";

import {
  DEFAULT_IMAGE_2K_BASE_CREDIT_COST,
  DEFAULT_IMAGE_4K_BASE_CREDIT_COST,
  DEFAULT_IMAGE_1024_BASE_CREDIT_COST,
  type ImageBaseCreditPricing,
} from "./resolution";

export async function getRuntimeImageBaseCreditPricing(): Promise<ImageBaseCreditPricing> {
  const [base1024Credits, base2kCredits, base4kCredits] = await Promise.all([
    getRuntimeSettingNumber(
      "IMAGE_BASE_CREDITS_1024",
      DEFAULT_IMAGE_1024_BASE_CREDIT_COST,
      { positive: true }
    ),
    getRuntimeSettingNumber(
      "IMAGE_BASE_CREDITS_2K",
      DEFAULT_IMAGE_2K_BASE_CREDIT_COST,
      { positive: true }
    ),
    getRuntimeSettingNumber(
      "IMAGE_BASE_CREDITS_4K",
      DEFAULT_IMAGE_4K_BASE_CREDIT_COST,
      { positive: true }
    ),
  ]);

  return { base1024Credits, base2kCredits, base4kCredits };
}
