/**
 * 官网首页连续服务端内容编排。
 *
 * 使用方：首页路由；按首屏、模型、快速集成、作品、可靠性、FAQ、合层结尾的正常
 * 文档流组合各区块。全部核心内容默认可见，不依赖固定画布、长滚动或客户端脚本。
 */
import { Button } from "@repo/ui/components/button";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/routing";

import { HOMEPAGE_ARTWORKS, type HomepageArtwork } from "./homepage-artworks";
import {
  HomepageFaq,
  type HomepageFaqItem,
  parseHomepageFaqItems,
} from "./homepage-faq";
import { HomepageFooter } from "./homepage-footer";
import { HomepageIntegration } from "./homepage-integration";
import { HomepageModelCatalog } from "./homepage-model-catalog";
import { HomepageMotion } from "./homepage-motion";
import type { HomepagePageData } from "./homepage-page-data";
import { HomepageReliability } from "./homepage-reliability";

/** 根据作品比例返回静态 Tailwind 尺寸，避免运行时拼接无法被构建器识别的类名。 */
function getArtworkAspectClassName(layout: HomepageArtwork["layout"]): string {
  switch (layout) {
    case "landscape":
      return "aspect-[4/3]";
    case "square":
      return "aspect-square";
    case "portrait":
      return "aspect-[3/4]";
  }
}

/**
 * 渲染双语、作品主导的完整首页。
 *
 * @param props - 当前 locale 与已在服务端收窄的页面数据。
 * @returns 正常文档流中的所有首页区块；首尾 CTA 复用同一 href。
 */
export async function HomepageContent({
  locale,
  data,
  faqItems,
}: {
  locale: string;
  data: HomepagePageData;
  faqItems?: readonly HomepageFaqItem[];
}) {
  const t = await getTranslations({ locale, namespace: "Homepage" });
  const visibleFaqItems = faqItems ?? parseHomepageFaqItems(t.raw("faq.items"));
  const integrationCatalog =
    data.catalog.status === "ready"
      ? { status: "ready" as const, image: data.catalog.image }
      : { status: "unavailable" as const };

  return (
    <HomepageMotion>
      <section
        aria-labelledby="homepage-hero-title"
        className="relative isolate overflow-hidden border-b border-border px-4 py-14 sm:px-6 sm:py-20 lg:min-h-[calc(100svh-4rem)] lg:px-8 lg:py-24"
        data-homepage-motion="hero"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_78%_22%,color-mix(in_oklab,var(--destructive)_9%,transparent),transparent_32%),linear-gradient(to_bottom,color-mix(in_oklab,var(--muted)_35%,transparent),transparent_55%)]"
        />
        <div className="mx-auto grid w-full max-w-7xl gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div className="relative z-10 lg:py-10">
            <p
              className="font-mono text-xs uppercase tracking-[0.24em] text-destructive"
              data-homepage-motion="hero-copy"
            >
              {t("hero.eyebrow")}
            </p>
            <h1
              className="mt-6 max-w-3xl font-serif text-5xl font-medium leading-[0.98] tracking-[-0.035em] sm:text-6xl lg:text-7xl xl:text-8xl"
              data-homepage-motion="hero-copy"
              id="homepage-hero-title"
            >
              {t("hero.titleLead")}
              <span className="mt-1 block italic text-destructive">
                {t("hero.titleAccent")}
              </span>
            </h1>
            <p
              className="mt-7 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg"
              data-homepage-motion="hero-copy"
            >
              {t("hero.description")}
            </p>
            <div
              className="mt-9 flex flex-wrap gap-3"
              data-homepage-motion="hero-copy"
            >
              <Button asChild className="rounded-none" size="lg">
                <Link href={data.ctaHref}>
                  {t("hero.cta")}
                  <ArrowUpRight className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                className="rounded-none"
                size="lg"
                variant="outline"
              >
                <Link href="/#work">
                  {t("hero.workLink")}
                  <ArrowDown className="size-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div
            className="relative mx-auto w-full max-w-3xl pb-8 pl-6 sm:pl-12 lg:pb-12"
            data-homepage-motion="hero-artwork"
          >
            <div className="absolute -left-2 top-10 hidden w-[28%] -rotate-3 border border-border bg-background p-2 shadow-whisper sm:block">
              <Image
                alt={t("hero.draftAlt")}
                className="aspect-[3/4] w-full object-cover grayscale"
                height={720}
                sizes="(max-width: 1024px) 20vw, 12vw"
                src="/cinema/artwork-hero-draft.webp"
                width={540}
              />
              <p className="px-1 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t("hero.draftLabel")}
              </p>
            </div>
            <figure
              className="relative ml-auto w-[84%] border border-border bg-background p-3 shadow-menu sm:w-[78%]"
              data-homepage-motion="hero-parallax"
            >
              <Image
                alt={t("hero.mainAlt")}
                className="aspect-[3/4] w-full object-cover"
                height={1280}
                loading="eager"
                priority
                sizes="(max-width: 640px) 82vw, (max-width: 1024px) 66vw, 42vw"
                src="/cinema/artwork-hero.webp"
                width={960}
              />
              <figcaption className="flex items-center justify-between gap-4 px-1 pb-1 pt-3">
                <span className="font-serif text-sm italic">
                  {t("hero.artworkCaption")}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-destructive">
                  {t("hero.artworkFormat")}
                </span>
              </figcaption>
            </figure>
            <div className="absolute bottom-0 right-0 w-[30%] rotate-2 border border-border bg-background p-2 shadow-whisper sm:right-3">
              <Image
                alt={t("hero.depthAlt")}
                className="aspect-square w-full object-cover grayscale"
                height={480}
                sizes="(max-width: 1024px) 24vw, 15vw"
                src="/cinema/artwork-hero-depth.webp"
                width={480}
              />
            </div>
          </div>
        </div>
      </section>

      <div data-homepage-motion="model">
        <HomepageModelCatalog
          catalog={data.catalog}
          copy={{
            eyebrow: t("models.eyebrow"),
            title: t("models.title"),
            description: t("models.description"),
            previewLabel: t("models.previewLabel"),
            countLabel: t("models.countLabel"),
            unavailable: t("models.unavailable"),
            supportedLabel: t("models.supportedLabel"),
            categories: {
              image: {
                label: t("models.categories.image.label"),
                description: t("models.categories.image.description"),
                empty: t("models.categories.image.empty"),
              },
              video: {
                label: t("models.categories.video.label"),
                description: t("models.categories.video.description"),
                empty: t("models.categories.video.empty"),
              },
              conversation: {
                label: t("models.categories.conversation.label"),
                description: t("models.categories.conversation.description"),
                empty: t("models.categories.conversation.empty"),
              },
            },
          }}
        />
      </div>

      <div data-homepage-motion="reveal">
        <HomepageIntegration catalog={integrationCatalog} locale={locale} />
      </div>

      <section
        aria-labelledby="homepage-work-title"
        className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8 lg:py-28"
        id="work"
      >
        <div className="mx-auto w-full max-w-7xl">
          <div
            className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-end"
            data-homepage-motion="reveal"
          >
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
                {t("artworks.eyebrow")}
              </p>
              <h2
                className="mt-4 font-serif text-3xl font-medium tracking-tight sm:text-5xl"
                id="homepage-work-title"
              >
                {t("artworks.title")}
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground lg:justify-self-end">
              {t("artworks.description")}
            </p>
          </div>

          <div className="mt-14 columns-2 gap-3 sm:columns-3 lg:columns-4 lg:gap-4">
            {HOMEPAGE_ARTWORKS.map((artwork) => (
              <figure
                className="mb-3 break-inside-avoid border border-border bg-muted/20 p-2 lg:mb-4"
                key={artwork.src}
              >
                <Image
                  alt={t(artwork.altKey)}
                  className={`${getArtworkAspectClassName(artwork.layout)} w-full object-cover grayscale-[0.18] transition-[filter] duration-300 hover:grayscale-0 motion-reduce:transition-none`}
                  height={960}
                  sizes="(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 22vw"
                  src={artwork.src}
                  width={720}
                />
              </figure>
            ))}
          </div>
        </div>
      </section>

      <HomepageReliability
        canToggle={data.canToggleSlaStatus}
        copy={{
          eyebrow: t("reliability.eyebrow"),
          title: t("reliability.title"),
          description: t("reliability.description"),
          availability: t("reliability.availability"),
          sample: t("reliability.sample"),
          completed: t("reliability.completed"),
          platformErrors: t("reliability.platformErrors"),
          insufficient: t("reliability.insufficient"),
          unavailable: t("reliability.unavailable"),
          hiddenTitle: t("reliability.hiddenTitle"),
          hiddenDescription: t("reliability.hiddenDescription"),
        }}
        locale={locale}
        state={data.reliability}
      />

      <HomepageFaq
        description={t("faq.description")}
        eyebrow={t("faq.eyebrow")}
        items={visibleFaqItems}
        title={t("faq.title")}
      />

      <HomepageFooter
        copy={{
          eyebrow: t("footer.eyebrow"),
          title: t("footer.title"),
          description: t("footer.description"),
          cta: t("footer.cta"),
          brandDescription: t("footer.brandDescription"),
          siteLabel: t("footer.siteLabel"),
          legalLabel: t("footer.legalLabel"),
          docs: t("footer.docs"),
          contact: t("footer.contact"),
          terms: t("footer.terms"),
          privacy: t("footer.privacy"),
          cookie: t("footer.cookie"),
          copyright: t("footer.copyright"),
        }}
        ctaHref={data.ctaHref}
      />
    </HomepageMotion>
  );
}
