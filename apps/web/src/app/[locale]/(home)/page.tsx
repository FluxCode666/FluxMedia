/**
 * FluxMedia 本地化官网首页路由。
 *
 * 使用方：`/[locale]` 首页；专属 Route Group 保证布局不附加营销共享 Footer。
 * 关键依赖：首页安全数据装配器与连续 Server Component 内容。
 */
import { siteConfig } from "@repo/shared/config";
import type { Metadata } from "next";
import { SiteJsonLd, SoftwareAppJsonLd } from "@/components/seo/json-ld";
import { HomepageContent } from "@/features/marketing/homepage/homepage-content";
import { loadHomepagePageData } from "@/features/marketing/homepage/homepage-page-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** 生成当前首页 Metadata。 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";

  const title = isZh
    ? "FluxMedia - AI 对话生图平台"
    : "FluxMedia - AI Chat-to-Image Generation Platform";

  const description = isZh
    ? "通过自然对话将你的想法转化为精美视觉图片。由最先进的 AI 模型驱动，支持批量生成、画廊管理与灵活积分系统。"
    : "Transform your ideas into stunning visuals through natural conversation. Powered by state-of-the-art AI models with batch generation, gallery management, and flexible credits.";

  return {
    title,
    description,
    keywords: [
      "AI image generation",
      "chat to image",
      "text to image",
      "AI art",
      "FluxMedia",
      "image generation API",
      "creative AI",
      ...(isZh ? ["AI图像生成", "对话生图", "文字转图片", "AI艺术"] : []),
    ],
    openGraph: {
      title,
      description,
      type: "website",
      url: `${siteConfig.url}/${locale}`,
      siteName: siteConfig.name,
      images: [
        {
          url: `${siteConfig.url}${siteConfig.ogImage}`,
          width: 1200,
          height: 630,
          alt: siteConfig.name,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${siteConfig.url}${siteConfig.ogImage}`],
    },
  };
}

/** 读取已收窄首页数据并服务端输出连续双语页面。 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const pageData = await loadHomepagePageData();

  return (
    <>
      {/* JSON-LD Structured Data */}
      <SiteJsonLd locale={locale as "en" | "zh"} />
      <SoftwareAppJsonLd locale={locale as "en" | "zh"} />

      <HomepageContent data={pageData} locale={locale} />
    </>
  );
}
