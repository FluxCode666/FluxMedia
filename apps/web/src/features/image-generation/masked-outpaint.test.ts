/**
 * 掩码顺序外绘纯函数单测（DB-free）：切块规划、每块保留区计算与重叠带羽化混合。
 * 不测 maskedOutpaintImage 编排（依赖 sharp/后端回调），只测几何/保留区/羽化正确性与边界。
 */
import { describe, expect, it } from "vitest";

import {
  blendEditedTile,
  OUTPAINT_MAX_WORKING,
  OUTPAINT_TILE,
  type OutpaintTile,
  planOutpaintTiles,
  tileKeepInset,
} from "./masked-outpaint";

describe("planOutpaintTiles", () => {
  it("目标 ≤ 块边：单块，块尺寸=目标", () => {
    const p = planOutpaintTiles(800, 800);
    expect(p.cols).toBe(1);
    expect(p.rows).toBe(1);
    expect(p.tiles).toHaveLength(1);
    expect(p.tileW).toBe(800);
  });

  it("封顶工作分辨率(OUTPAINT_MAX_WORKING)→ 2×2=4 块(控成本;更大目标外层超分补足)", () => {
    // 特性实际在 ≤OUTPAINT_MAX_WORKING 的工作分辨率上切块,故为方形时 2×2=4 块。
    const p = planOutpaintTiles(OUTPAINT_MAX_WORKING, OUTPAINT_MAX_WORKING);
    expect(p.tileW).toBe(OUTPAINT_TILE);
    expect(p.cols).toBe(2);
    expect(p.rows).toBe(2);
    expect(p.tiles).toHaveLength(4);
    const xs = [...new Set(p.tiles.map((t) => t.x))].sort((a, b) => a - b);
    expect(xs[0]).toBe(0);
    expect(xs[xs.length - 1]).toBe(OUTPAINT_MAX_WORKING - OUTPAINT_TILE);
  });

  it("相邻块有正重叠（步进 < 块边）", () => {
    const p = planOutpaintTiles(OUTPAINT_MAX_WORKING, OUTPAINT_MAX_WORKING);
    const xs = [...new Set(p.tiles.map((t) => t.x))].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const overlap = OUTPAINT_TILE - (xs[i]! - xs[i - 1]!);
      expect(overlap).toBeGreaterThan(0);
    }
  });
});

describe("tileKeepInset", () => {
  it("首块(0,0)无保留区（全部重绘）", () => {
    const p = planOutpaintTiles(2880, 2880);
    const t0 = p.tiles.find((t) => t.col === 0 && t.row === 0)!;
    expect(tileKeepInset(p, t0)).toEqual({ left: 0, top: 0 });
  });

  it("非首列块左侧有保留区(=与左邻重叠)", () => {
    const p = planOutpaintTiles(2880, 2880);
    const t = p.tiles.find((x) => x.col === 1 && x.row === 0)!;
    const inset = tileKeepInset(p, t);
    expect(inset.left).toBeGreaterThan(0);
    expect(inset.top).toBe(0);
    // 保留区不吞整块
    expect(inset.left).toBeLessThan(p.tileW);
  });

  it("内部块左、上都有保留区", () => {
    const p = planOutpaintTiles(2880, 2880);
    const t = p.tiles.find((x) => x.col === 2 && x.row === 2)!;
    const inset = tileKeepInset(p, t);
    expect(inset.left).toBeGreaterThan(0);
    expect(inset.top).toBeGreaterThan(0);
  });
});

describe("blendEditedTile", () => {
  // 纯灰 RGB 缓冲（n 像素、每通道值 v），便于用单通道值读出混合结果。
  const solid = (n: number, v: number) => Buffer.from(new Array(n * 3).fill(v));
  const tile = (over: Partial<OutpaintTile>): OutpaintTile => ({
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    col: 0,
    row: 0,
    ...over,
  });

  it("左重叠带：角保留、带内线性升、纯新区全覆盖", () => {
    // 1 行 4px，left=2：x=0 保留(committed 100)、x=1 半混(150)、x≥2 纯新(200)。
    const canvas = solid(4, 100);
    const edited = solid(4, 200);
    blendEditedTile(canvas, 4, tile({ w: 4, col: 1 }), edited, 2, 0);
    expect([canvas[0], canvas[3], canvas[6], canvas[9]]).toEqual([
      100, 150, 200, 200,
    ]);
  });

  it("上重叠带：同理沿 y 线性过渡", () => {
    // 1 列 3px，top=2：y=0 保留(100)、y=1 半混(150)、y=2 纯新(200)。
    const canvas = solid(3, 100);
    const edited = solid(3, 200);
    blendEditedTile(canvas, 1, tile({ h: 3, row: 1 }), edited, 0, 2);
    expect([canvas[0], canvas[3], canvas[6]]).toEqual([100, 150, 200]);
  });

  it("首块(left=0,top=0)整块用编辑结果", () => {
    const canvas = solid(3, 100);
    const edited = solid(3, 200);
    blendEditedTile(canvas, 3, tile({ w: 3 }), edited, 0, 0);
    expect([canvas[0], canvas[3], canvas[6]]).toEqual([200, 200, 200]);
  });

  it("只改本块在画布中的偏移区域，不动别处", () => {
    // 画布 3×2，块 2×1 落在 (row1,col1..2)；只有那两像素变 99，其余保持 10。
    const canvas = solid(6, 10);
    const edited = solid(2, 99);
    blendEditedTile(
      canvas,
      3,
      tile({ x: 1, y: 1, w: 2, col: 1, row: 1 }),
      edited,
      0,
      0
    );
    expect(canvas[12]).toBe(99); // (row1,col1)
    expect(canvas[15]).toBe(99); // (row1,col2)
    expect(canvas[9]).toBe(10); // (row1,col0) 未动
    expect(canvas[0]).toBe(10); // (row0,col0) 未动
  });
});
