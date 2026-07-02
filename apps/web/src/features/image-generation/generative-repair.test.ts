/**
 * 生成式修复纯函数单测（DB-free）：修复分辨率与最终放大尺寸计算。
 * 不测 generativeRepairImage 编排（依赖 sharp/后端回调），只测尺寸决策与边界。
 */
import { describe, expect, it } from "vitest";

import {
  finalDimensions,
  REPAIR_LONG_EDGE,
  repairDimensions,
} from "./generative-repair";

describe("repairDimensions", () => {
  it("方形 snap 到 1:1 原生尺寸(1248)", () => {
    expect(repairDimensions(2880, 2880)).toEqual({ rw: 1248, rh: 1248 });
    expect(repairDimensions(512, 512)).toEqual({ rw: 1248, rh: 1248 });
  });

  it("横图 snap 到 3:2 原生尺寸(1536x1024,长边 1536)", () => {
    expect(repairDimensions(3000, 2000)).toEqual({ rw: 1536, rh: 1024 });
    expect(repairDimensions(2560, 1440)).toEqual({ rw: 1536, rh: 1024 });
  });

  it("竖图 snap 到 2:3 原生尺寸(1024x1536)", () => {
    expect(repairDimensions(1024, 1536)).toEqual({ rw: 1024, rh: 1536 });
    expect(repairDimensions(2000, 3000)).toEqual({ rw: 1024, rh: 1536 });
  });

  it("非法尺寸回退首个(方形)原生尺寸", () => {
    expect(repairDimensions(0, 100)).toEqual({
      rw: REPAIR_LONG_EDGE,
      rh: REPAIR_LONG_EDGE,
    });
  });
});

describe("finalDimensions", () => {
  it("把修复尺寸等比放大到目标较长边", () => {
    const p = finalDimensions(1280, 1280, 2880);
    expect(Math.max(p.fw, p.fh)).toBe(2880);
    expect(p.fw).toBe(p.fh);
  });

  it("竖图放大保持比例", () => {
    const p = finalDimensions(848, 1280, 2880);
    expect(Math.max(p.fw, p.fh)).toBe(2880);
    expect(p.fw).toBeLessThan(p.fh);
    // 比例保持
    expect(p.fw / p.fh).toBeCloseTo(848 / 1280, 2);
  });
});
