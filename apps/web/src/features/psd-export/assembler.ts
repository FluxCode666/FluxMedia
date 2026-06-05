/**
 * 服务端分层 PSD 组装器。
 *
 * 职责:把多张图层位图(各自带 alpha 通道)组装成一个真·分层、Photoshop 可打开的 .psd。
 * 使用方:PSD 导出流程——按元素分别生成透明图层后,在服务端拼成 PSD 供用户下载。
 * 关键依赖:sharp(把各图层解码为 raw RGBA,并合成扁平预览)、ag-psd(写出 PSD 字节)。
 *
 * 设计:纯函数,无 DB / 网络副作用,便于 DB-free 单测。图层数量不限;数组顺序为"底层在前"。
 * WHY 用 PixelData 而非 canvas:ag-psd 写 PSD 时每个图层只需 {data,width,height} 像素,
 * Node 端无需任何 canvas 库;sharp 的 raw RGBA 直接喂入即可。
 */
import { type Layer, type Psd, writePsdBuffer } from "ag-psd";
import sharp from "sharp";

/** 单个图层输入。 */
export type PsdLayerInput = {
  /** 图层名(Photoshop 图层面板显示)。 */
  name: string;
  /** 图层位图字节(PNG 等 sharp 可解码格式),透明通道会被保留。 */
  image: Buffer;
  /** 图层左上角在画布中的 x,默认 0。 */
  left?: number;
  /** 图层左上角在画布中的 y,默认 0。 */
  top?: number;
  /** 不透明度 0-255,默认 255。 */
  opacity?: number;
  /** 是否默认隐藏,默认 false。 */
  hidden?: boolean;
};

/** 画布尺寸。 */
export type AssembleLayeredPsdOptions = {
  width: number;
  height: number;
};

/** 用 sharp 把图层位图解码为 raw RGBA;拷贝为 Uint8ClampedArray,避免共享 sharp 池化 buffer。 */
async function toRawRgba(image: Buffer) {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height,
  };
}

/**
 * 把若干图层组装为分层 PSD,返回 .psd 文件字节。
 *
 * @param layers 图层数组,顺序为"底层在前、顶层在后",至少一层。
 * @param options 画布宽高(正整数)。
 * @returns PSD 文件字节(Buffer)。
 * @throws 图层为空、或画布尺寸非法时抛错。
 */
export async function assembleLayeredPsd(
  layers: PsdLayerInput[],
  options: AssembleLayeredPsdOptions
): Promise<Buffer> {
  if (layers.length === 0) {
    throw new Error("assembleLayeredPsd: 至少需要一个图层");
  }
  const { width, height } = options;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("assembleLayeredPsd: 画布宽高必须为正整数");
  }

  const children: Layer[] = [];
  const overlays: sharp.OverlayOptions[] = [];

  for (const layer of layers) {
    const raw = await toRawRgba(layer.image);
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    children.push({
      name: layer.name,
      left,
      top,
      right: left + raw.width,
      bottom: top + raw.height,
      opacity: layer.opacity ?? 255,
      hidden: layer.hidden ?? false,
      imageData: { data: raw.data, width: raw.width, height: raw.height },
    });
    overlays.push({ input: layer.image, left, top });
  }

  // 文档合成预览:非 Photoshop 查看器与缩略图依赖它显示效果。把各图层按位置叠到透明画布。
  const flattened = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(overlays)
    .png()
    .toBuffer();
  const flatRaw = await toRawRgba(flattened);

  const psd: Psd = {
    width,
    height,
    children,
    imageData: {
      data: flatRaw.data,
      width: flatRaw.width,
      height: flatRaw.height,
    },
  };

  return Buffer.from(writePsdBuffer(psd));
}
