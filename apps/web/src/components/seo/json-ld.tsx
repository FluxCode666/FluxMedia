/**
 * SEO JSON-LD 组件集合。
 *
 * 使用方：站点布局、博客与营销页面。依赖 lib/seo/json-ld 生成结构化数据，
 * 本文件只负责安全序列化并渲染 application/ld+json 脚本。
 */
import {
  type ArticleSchemaInput,
  type BreadcrumbItem,
  type FAQItem,
  generateArticleSchema,
  generateBreadcrumbSchema,
  generateFAQSchema,
  generateOrganizationSchema,
  generateSoftwareApplicationSchema,
  generateWebSiteSchema,
} from "@/lib/seo/json-ld";

type LocaleType = "en" | "zh";

/**
 * 将 JSON-LD 安全序列化为 script 文本。
 *
 * @param data - 由站内 schema 生成器构造的结构化数据。
 * @returns 已转义左尖括号的 JSON，避免数据闭合 script 标签。
 * @throws 数据无法序列化为 JSON 时抛出 TypeError。
 */
function serializeJsonLd(data: object) {
  const serialized = JSON.stringify(data);
  if (serialized === undefined) {
    throw new TypeError("JSON-LD 数据无法序列化");
  }
  return serialized.replace(/</g, "\\u003c");
}

/**
 * 渲染单个 JSON-LD 脚本。
 *
 * @param data - 待嵌入页面的结构化数据。
 * @returns application/ld+json script；除渲染输出外无副作用。
 * @throws data 无法序列化时透传 TypeError。
 */
function JsonLdScript({ data }: { data: object }) {
  return <script type="application/ld+json">{serializeJsonLd(data)}</script>;
}

/**
 * 渲染站点与组织结构化数据。
 *
 * @param locale - 当前页面语言。
 * @returns 两个 JSON-LD 脚本；无外部副作用。
 */
export function SiteJsonLd({ locale }: { locale: LocaleType }) {
  return (
    <>
      <JsonLdScript data={generateWebSiteSchema(locale)} />
      <JsonLdScript data={generateOrganizationSchema()} />
    </>
  );
}

/**
 * 渲染文章结构化数据。
 *
 * @param props - 文章 schema 输入。
 * @returns 文章 JSON-LD 脚本；无外部副作用。
 */
export function ArticleJsonLd(props: ArticleSchemaInput) {
  return <JsonLdScript data={generateArticleSchema(props)} />;
}

/**
 * 渲染 FAQ 结构化数据。
 *
 * @param faqs - FAQ 条目；空数组不输出脚本。
 * @returns FAQ JSON-LD 脚本或 null；无外部副作用。
 */
export function FAQJsonLd({ faqs }: { faqs: readonly FAQItem[] }) {
  if (!faqs || faqs.length === 0) return null;
  return <JsonLdScript data={generateFAQSchema(faqs)} />;
}

/**
 * 渲染面包屑结构化数据。
 *
 * @param items - 面包屑条目；空数组不输出脚本。
 * @returns 面包屑 JSON-LD 脚本或 null；无外部副作用。
 */
export function BreadcrumbJsonLd({ items }: { items: BreadcrumbItem[] }) {
  if (!items || items.length === 0) return null;
  return <JsonLdScript data={generateBreadcrumbSchema(items)} />;
}

/**
 * 渲染软件产品结构化数据。
 *
 * @param locale - 当前页面语言。
 * @returns 软件产品 JSON-LD 脚本；无外部副作用。
 */
export function SoftwareAppJsonLd({ locale }: { locale: LocaleType }) {
  return <JsonLdScript data={generateSoftwareApplicationSchema(locale)} />;
}

/**
 * 组合首页所需的全部结构化数据。
 *
 * @param locale - 当前页面语言。
 * @param faqs - 可选 FAQ 条目；为空时不输出 FAQ schema。
 * @returns 首页 JSON-LD 组件组；无外部副作用。
 */
export function HomePageJsonLd({
  locale,
  faqs,
}: {
  locale: LocaleType;
  faqs?: readonly FAQItem[];
}) {
  return (
    <>
      <SiteJsonLd locale={locale} />
      <SoftwareAppJsonLd locale={locale} />
      {faqs && faqs.length > 0 && <FAQJsonLd faqs={faqs} />}
    </>
  );
}
