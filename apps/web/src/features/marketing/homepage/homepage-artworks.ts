/**
 * 官网首页真实作品清单。
 *
 * 使用方：首页作品墙和首屏；所有路径都指向已存在的 `public/cinema` 资产，alt 文案由
 * Homepage i18n 命名空间按稳定 key 提供，避免复制旧 Cinema 的章节结构。
 */

/** 首页单件作品的公开展示字段。 */
export type HomepageArtwork = {
  src: string;
  altKey: `artworks.alts.${
    | "bamboo"
    | "mountain"
    | "plum"
    | "waterfall"
    | "carp"
    | "lotus"
    | "bridge"
    | "rain"
    | "circle"}`;
  layout: "portrait" | "landscape" | "square";
};

/** 作品墙使用的真实样张；顺序决定正常文档流中的视觉节奏。 */
export const HOMEPAGE_ARTWORKS: readonly HomepageArtwork[] = [
  {
    src: "/cinema/wall/w01.webp",
    altKey: "artworks.alts.bamboo",
    layout: "portrait",
  },
  {
    src: "/cinema/wall/w02.webp",
    altKey: "artworks.alts.mountain",
    layout: "landscape",
  },
  {
    src: "/cinema/wall/w04.webp",
    altKey: "artworks.alts.plum",
    layout: "square",
  },
  {
    src: "/cinema/wall/w07.webp",
    altKey: "artworks.alts.waterfall",
    layout: "portrait",
  },
  {
    src: "/cinema/wall/w09.webp",
    altKey: "artworks.alts.carp",
    layout: "square",
  },
  {
    src: "/cinema/wall/w12.webp",
    altKey: "artworks.alts.lotus",
    layout: "portrait",
  },
  {
    src: "/cinema/wall/w13.webp",
    altKey: "artworks.alts.bridge",
    layout: "landscape",
  },
  {
    src: "/cinema/wall/w14.webp",
    altKey: "artworks.alts.rain",
    layout: "square",
  },
  {
    src: "/cinema/artwork-hero.webp",
    altKey: "artworks.alts.circle",
    layout: "portrait",
  },
] as const;
