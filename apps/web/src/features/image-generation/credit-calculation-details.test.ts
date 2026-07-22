/**
 * 历史积分计算详情解析测试。
 *
 * 锁定分辨率结算快照的读取与旧记录兼容行为；金额始终读取原始历史元数据，
 * 不根据当前价格或尺寸重新计算。
 */

import { describe, expect, it } from "vitest";
import { extractGenerationCreditDetails } from "./credit-calculation-details";

describe("extractGenerationCreditDetails", () => {
  it("读取请求与实际分辨率结算快照", () => {
    const details = extractGenerationCreditDetails(
      {
        outputImage: {
          requestedResolution: "1K",
          requestedSize: "1248x832",
          settledResolution: "2K",
          actualSize: "2048x1152",
          actualCreditCost: {
            baseCredits: 5,
            totalCredits: 5,
          },
        },
      },
      5
    );

    expect(details).toMatchObject({
      requestedResolution: "1K",
      requestedSize: "1248x832",
      settledResolution: "2K",
      actualSize: "2048x1152",
      baseCredits: 5,
      totalCredits: 5,
    });
  });

  it("旧记录没有档位快照时不按尺寸反推", () => {
    const details = extractGenerationCreditDetails(
      {
        outputImage: {
          requestedSize: "1248x832",
          actualSize: "2048x1152",
        },
      },
      5
    );

    expect(details).toMatchObject({
      requestedResolution: null,
      settledResolution: null,
    });
  });
});
