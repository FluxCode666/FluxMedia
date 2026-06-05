import { initializeCanvas, readPsd } from "ag-psd";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { assembleLayeredPsd } from "./assembler";

// readPsd 解码 8bit/4 通道图层像素时内部会调 createImageData;Node 无 DOM canvas,
// 注册一个返回纯对象的工厂即可绕开(仅"读回校验"需要;assembleLayeredPsd 写出不需要)。
initializeCanvas(
  () => {
    throw new Error("createCanvas 在测试中不应被调用");
  },
  (width, height) =>
    ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }) as unknown as ImageData
);

/** 生成一张不透明纯色 PNG。 */
function solidPng(width: number, height: number, color: string) {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${color}"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** 生成一张透明背景、中心一个实心圆的 PNG(用于验证图层独立 alpha)。 */
function transparentCirclePng(size: number, color: string) {
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 3}" fill="${color}"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** 统计一个 PixelData(RGBA)里完全透明(alpha=0)的像素数。 */
function countTransparent(layer: { imageData?: { data: ArrayLike<number> } }) {
  const data = layer.imageData?.data;
  if (!data) return -1;
  let n = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) n += 1;
  }
  return n;
}

describe("assembleLayeredPsd", () => {
  it("把多张图层组装为真·分层、可读回的 PSD(层名/顺序/独立 alpha 正确)", async () => {
    const size = 256;
    const layers = [
      { name: "background", image: await solidPng(size, size, "#3366cc") },
      { name: "subject", image: await transparentCirclePng(size, "#ffcc00") },
      { name: "badge", image: await transparentCirclePng(size, "#cc0033") },
    ];

    const psdBuffer = await assembleLayeredPsd(layers, {
      width: size,
      height: size,
    });

    // 文件头魔数为 PSD。
    expect(psdBuffer.subarray(0, 4).toString("ascii")).toBe("8BPS");

    const parsed = readPsd(psdBuffer, { useImageData: true });
    expect(parsed.width).toBe(size);
    expect(parsed.height).toBe(size);
    expect(parsed.children?.length).toBe(3);
    expect(parsed.children?.map((c) => c.name)).toEqual([
      "background",
      "subject",
      "badge",
    ]);

    // 真·分层:background 全不透明;subject/badge 圆外应有大量透明像素(未被压平)。
    const [bg, subject, badge] = parsed.children ?? [];
    expect(countTransparent(bg!)).toBe(0);
    expect(countTransparent(subject!)).toBeGreaterThan(0);
    expect(countTransparent(badge!)).toBeGreaterThan(0);
  });

  it("空图层数组抛错", async () => {
    await expect(
      assembleLayeredPsd([], { width: 100, height: 100 })
    ).rejects.toThrow("至少需要一个图层");
  });

  it("非法画布尺寸抛错", async () => {
    const layers = [{ name: "bg", image: await solidPng(10, 10, "#000") }];
    await expect(
      assembleLayeredPsd(layers, { width: 0, height: 100 })
    ).rejects.toThrow("正整数");
  });
});
