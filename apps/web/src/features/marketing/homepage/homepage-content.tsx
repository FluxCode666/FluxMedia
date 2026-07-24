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

import { HOMEPAGE_ARTWORKS } from "./homepage-artworks";
import {
  HomepageFaq,
  type HomepageFaqItem,
  parseHomepageFaqItems,
} from "./homepage-faq";
import { HomepageFooter } from "./homepage-footer";
import { HomepageIntegration } from "./homepage-integration";
import {
  getHomepageVisibleModelCatalog,
  HomepageModelCatalog,
} from "./homepage-model-catalog";
import { HomepageMotion } from "./homepage-motion";
import type { HomepagePageData } from "./homepage-page-data";
import { HomepageReliability } from "./homepage-reliability";

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
  const visibleCatalog = getHomepageVisibleModelCatalog(data.catalog);

  return (
    <HomepageMotion>
      <section
        aria-labelledby="homepage-hero-title"
        className="relative isolate overflow-hidden border-b border-border px-4 py-12 sm:px-6 sm:py-16 lg:min-h-[calc(100svh-4rem)] lg:px-8 lg:py-20"
        data-homepage-motion="hero"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_86%_14%,color-mix(in_oklab,var(--destructive)_7%,transparent),transparent_28%),linear-gradient(to_bottom,color-mix(in_oklab,var(--muted)_35%,transparent),transparent_55%)]"
        />
        <div className="mx-auto w-full max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
            <div>
              <p
                className="font-mono text-xs uppercase tracking-[0.24em] text-destructive"
                data-homepage-motion="hero-copy"
              >
                {t("hero.eyebrow")}
              </p>
              <h1
                className="mt-5 max-w-4xl font-serif text-4xl font-medium leading-[1.02] tracking-[-0.03em] sm:text-5xl lg:text-5xl"
                data-homepage-motion="hero-copy"
                id="homepage-hero-title"
              >
                {t("hero.titleLead")}
                <span className="mt-1 block italic text-destructive">
                  {t("hero.titleAccent")}
                </span>
              </h1>
            </div>
            <p
              className="max-w-xl text-sm leading-7 text-muted-foreground lg:justify-self-end"
              data-homepage-motion="hero-copy"
            >
              {t("hero.description")}
            </p>
          </div>

          <figure
            className="relative mt-10 border border-border bg-muted/20 p-2 sm:p-3"
            data-homepage-motion="hero-artwork"
          >
            <div
              className="relative overflow-hidden"
              data-homepage-motion="hero-parallax"
            >
              <Image
                alt={t("artworks.alts.mountain")}
                className="aspect-[16/9] w-full object-cover sm:aspect-[16/7]"
                height={900}
                loading="eager"
                priority
                sizes="(max-width: 1280px) 94vw, 1216px"
                src="/cinema/wall/w02.webp"
                width={1600}
              />
              <figcaption className="relative mx-3 -mt-8 max-w-xl bg-[#11100f] p-5 text-[#f6f1e7] shadow-menu sm:absolute sm:inset-x-auto sm:bottom-6 sm:left-6 sm:m-0 sm:p-6 lg:max-w-2xl">
                <div className="flex items-center justify-between gap-4 font-mono text-[9px] uppercase tracking-[0.18em] text-white/45">
                  <span>{t("hero.promptLabel")} / 01</span>
                  <span>{t("hero.artworkFormat")}</span>
                </div>
                <p className="mt-5 font-serif text-xl leading-snug sm:text-2xl">
                  {t("hero.prompt")}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button
                    asChild
                    className="rounded-none bg-[#f6f1e7] text-[#11100f] hover:bg-white"
                    size="lg"
                  >
                    <Link href={data.ctaHref}>
                      {t("hero.cta")}
                      <ArrowUpRight className="size-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    className="rounded-none border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
                    size="lg"
                    variant="outline"
                  >
                    <Link href="/#work">
                      {t("hero.workLink")}
                      <ArrowDown className="size-4" />
                    </Link>
                  </Button>
                </div>
              </figcaption>
            </div>
          </figure>
        </div>
      </section>

      <div data-homepage-motion="model">
        <HomepageModelCatalog
          catalog={visibleCatalog}
          copy={{
            eyebrow: t("models.eyebrow"),
            title: t("models.title"),
            description: t("models.description"),
            previewLabel: t("models.previewLabel"),
            countLabel: t("models.countLabel"),
            unavailable: t("models.unavailable"),
            supportedLabel: t("models.supportedLabel"),
            image: {
              label: t("models.categories.image.label"),
              description: t("models.categories.image.description"),
              empty: t("models.categories.image.empty"),
            },
          }}
        />
      </div>

      <div data-homepage-motion="reveal">
        <HomepageIntegration catalog={visibleCatalog} locale={locale} />
      </div>

      <section
        aria-labelledby="homepage-work-title"
        className="scroll-mt-24 bg-[#11100f] px-4 py-20 text-[#f6f1e7] sm:px-6 lg:px-8 lg:py-24"
        id="work"
      >
        <div className="mx-auto w-full max-w-7xl">
          <div
            className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-end"
            data-homepage-motion="reveal"
          >
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/45">
                {t("artworks.eyebrow")}
              </p>
              <h2
                className="mt-4 max-w-3xl font-serif text-4xl font-medium leading-[1.04] tracking-[-0.025em] sm:text-5xl lg:text-6xl"
                id="homepage-work-title"
              >
                {t("artworks.title")}
              </h2>
            </div>
            <p className="max-w-2xl text-sm leading-7 text-white/55 lg:justify-self-end">
              {t("artworks.description")}
            </p>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-3 border-t border-white/25 pt-8 sm:grid-cols-3 lg:grid-cols-6 lg:gap-4">
            {HOMEPAGE_ARTWORKS.slice(0, 6).map((artwork) => (
              <figure
                className="group min-w-0 even:lg:translate-y-6"
                key={artwork.src}
              >
                <Image
                  alt={t(artwork.altKey)}
                  className="aspect-[3/4] w-full border border-white/15 object-cover grayscale-[0.18] transition-[filter,transform] duration-500 group-hover:-translate-y-1 group-hover:grayscale-0 motion-reduce:transition-none"
                  height={960}
                  sizes="(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 15vw"
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
