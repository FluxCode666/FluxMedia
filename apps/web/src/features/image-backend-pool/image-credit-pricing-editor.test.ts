/**
 * 图像固定价格编辑器草稿转换测试。
 */
import { describe, expect, it } from "vitest";

import {
  imageCreditOverridesToDraft,
  imageCreditPricingDraftToOverrides,
  updateImageCreditPricingDraft,
} from "./image-credit-pricing-editor";

describe("image credit pricing editor", () => {
  it("保留稀疏档位并规范模型 ID", () => {
    expect(
      imageCreditPricingDraftToOverrides({
        " Firefly-GPT-Image-2 ": {
          base1024Credits: "1.5",
          base1kCredits: "",
          base2kCredits: "6",
        },
      })
    ).toEqual({
      version: 1,
      byModel: {
        "gpt-image-2": {
          base1024Credits: 1.5,
          base2kCredits: 6,
        },
      },
    });
  });

  it("空白、零值和非法价格保持继承", () => {
    expect(
      imageCreditPricingDraftToOverrides({
        bad: {
          base1024Credits: "0",
          base1kCredits: "-1",
          base2kCredits: "not-a-number",
          base4kCredits: "100001",
        },
      })
    ).toEqual({ version: 1, byModel: {} });
  });

  it("持久化配置可转换回输入草稿并单格更新", () => {
    const draft = imageCreditOverridesToDraft({
      version: 1,
      byModel: { custom: { base4kCredits: 9 } },
    });

    expect(
      updateImageCreditPricingDraft(draft, "custom", "base1024Credits", "2")
    ).toEqual({
      custom: { base1024Credits: "2", base4kCredits: "9" },
    });
  });
});
