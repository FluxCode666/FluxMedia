/**
 * 官网首页 FAQ 的可见内容与结构校验。
 *
 * 使用方：首页 SSR 与后续 JSON-LD；问答数据来自同一 i18n 数组并经 strict schema
 * 校验，原生 details 确保无 JavaScript 时问题和答案仍完整可读。
 */
import { z } from "zod";

/** 单条 FAQ 只包含可见问题和答案。 */
export const homepageFaqItemSchema = z
  .object({
    question: z.string().trim().min(1),
    answer: z.string().trim().min(1),
  })
  .strict();

/** 首页 FAQ 的共享结构，U8 JSON-LD 必须复用这一解析结果。 */
export const homepageFaqItemsSchema = z.array(homepageFaqItemSchema).min(1);

/** 首页 FAQ 的安全可见 DTO。 */
export type HomepageFaqItem = z.infer<typeof homepageFaqItemSchema>;

/**
 * 校验本地化消息中的 FAQ 数组。
 *
 * @param value - `Homepage.faq.items` 的未知原始值。
 * @returns 仅含 question/answer 的严格列表。
 * @throws 本地化资源缺失或夹带额外字段时抛出 ZodError，使构建期尽早失败。
 */
export function parseHomepageFaqItems(value: unknown): HomepageFaqItem[] {
  return homepageFaqItemsSchema.parse(value);
}

/**
 * 服务端渲染首页问答。
 *
 * @param props - 区块标题、说明和已校验问答。
 * @returns 原生 details 列表；答案直接存在于 SSR HTML。
 */
export function HomepageFaq({
  eyebrow,
  title,
  description,
  items,
}: {
  eyebrow: string;
  title: string;
  description: string;
  items: readonly HomepageFaqItem[];
}) {
  return (
    <section
      aria-labelledby="homepage-faq-title"
      className="bg-background px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10"
      id="faq"
    >
      <div className="mx-auto grid w-full max-w-7xl gap-10 rounded-[2rem] border border-border/80 bg-card/60 px-6 py-12 shadow-whisper sm:px-10 sm:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:px-12 lg:py-20">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
            {eyebrow}
          </p>
          <h2
            className="mt-4 max-w-lg font-serif text-3xl font-medium tracking-tight sm:text-4xl"
            id="homepage-faq-title"
          >
            {title}
          </h2>
          <p className="mt-4 max-w-md text-base leading-7 text-muted-foreground">
            {description}
          </p>
        </div>

        <div className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-background">
          {items.map((item) => (
            <details className="group px-5 py-5 sm:px-6" key={item.question}>
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 font-medium marker:content-none">
                <span>{item.question}</span>
                <span
                  aria-hidden="true"
                  className="font-mono text-sm text-destructive transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
                >
                  +
                </span>
              </summary>
              <p className="max-w-2xl pt-4 text-sm leading-7 text-muted-foreground">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
