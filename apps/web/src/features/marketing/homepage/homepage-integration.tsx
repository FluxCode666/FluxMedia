/**
 * 首页快速集成服务端展示组件。
 *
 * 使用方：首页连续内容编排；从 siteConfig 读取可信配置候选，不访问请求 Host 或转发
 * 头。组件始终输出三步与 API Docs/API Key 入口，仅在安全构建成功时输出 CodeBlock。
 */
import { siteConfig } from "@repo/shared/config";
import { Button } from "@repo/ui/components/button";
import { CodeBlock } from "@repo/ui/components/code-block";
import { ArrowUpRight, CircleCheck, KeyRound } from "lucide-react";

import { Link } from "@/i18n/routing";

import {
  buildHomepageIntegrationExample,
  getHomepageIntegrationContent,
  type HomepageIntegrationCatalogState,
} from "./integration-example";

/**
 * 渲染三步服务端集成说明、安全 cURL 示例和固定开发者入口。
 *
 * @param props - 当前语言与已由页面数据层收窄的平台图像模型目录状态。
 * @returns 无 JavaScript 也可阅读的三步说明；复制交互由共享 CodeBlock 渐进增强。
 * @sideEffects 无；不读取请求头、不发起目录请求，也不接收或渲染真实 API Key。
 * @failure 目录或 origin 不可用时显示对应说明，仍保留 API Docs 与 API Key 入口。
 */
export function HomepageIntegration({
  catalog,
  locale,
}: {
  catalog: HomepageIntegrationCatalogState;
  locale?: string;
}) {
  const content = getHomepageIntegrationContent(locale);
  const example = buildHomepageIntegrationExample({
    catalog,
    origin: siteConfig.url,
    runtime:
      process.env.NODE_ENV === "production" ? "production" : "development",
  });

  return (
    <section
      aria-labelledby="homepage-integration-title"
      className="scroll-mt-24 border-y border-border bg-muted/20 px-4 py-20 sm:px-6 lg:px-8 lg:py-28"
      id="integration"
    >
      <div className="mx-auto grid w-full max-w-7xl gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
            {content.eyebrow}
          </p>
          <h2
            className="mt-4 font-serif text-3xl font-medium tracking-tight sm:text-4xl"
            id="homepage-integration-title"
          >
            {content.title}
          </h2>
          <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
            {content.description}
          </p>

          <ol className="mt-8 space-y-6">
            {content.steps.map((step, index) => (
              <li className="flex gap-4" key={step.title}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background font-mono text-xs text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-medium">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <Link href={content.links.apiDocs}>
                {content.linkLabels.apiDocs}
                <ArrowUpRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={content.links.apiKeys}>
                <KeyRound className="size-4" />
                {content.linkLabels.apiKeys}
              </Link>
            </Button>
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-border bg-background p-4 shadow-whisper sm:p-6">
          {example.status === "available" ? (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <CircleCheck className="size-4" />
                  {content.modelLabel}
                </span>
                <code className="break-all font-mono text-foreground">
                  {example.modelId}
                </code>
              </div>
              <CodeBlock
                code={example.curl}
                labels={content.copyLabels}
                language="bash"
                showLineNumbers={false}
                title={content.exampleTitle}
              />
            </>
          ) : (
            <div className="flex min-h-72 flex-col justify-center rounded-xl border border-dashed border-border bg-muted/30 p-6">
              <h3 className="font-serif text-xl font-medium">
                {content.unavailableTitle}
              </h3>
              <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                {content.unavailableMessages[example.reason]}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
