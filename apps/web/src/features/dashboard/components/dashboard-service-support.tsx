/**
 * 控制台首页的服务与支持入口展示区。
 *
 * DashboardPage 传入经 UOL 校验的支持配置。本组件不发起请求、不执行写操作；站内
 * 链接交给国际化路由，外链始终添加隔离属性。
 */
import type {
  DashboardSupportConfig,
  DashboardSupportServiceIcon,
} from "@repo/shared/support/dashboard-config";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import {
  ArrowUpRight,
  BookOpenText,
  Boxes,
  Globe2,
  Headphones,
  type LucideIcon,
  MessageCircle,
  MessageCircleMore,
  MessagesSquare,
  Send,
  Twitter,
} from "lucide-react";

import {
  getEnabledDashboardServices,
  selectDashboardSupportText,
} from "@/features/dashboard/dashboard-service-support-presenter";
import { Link } from "@/i18n/routing";

type DashboardServiceSupportProps = {
  configuration: DashboardSupportConfig;
  isZh: boolean;
};

type SupportActionProps = {
  href: string;
  label: string;
  variant?: "default" | "outline" | "ghost";
};

const SERVICE_ICONS: Record<DashboardSupportServiceIcon, LucideIcon> = {
  discord: MessageCircleMore,
  telegram: Send,
  qq: MessageCircle,
  wechat: MessagesSquare,
  twitter: Twitter,
  documentation: BookOpenText,
  models: Boxes,
  support: Headphones,
  website: Globe2,
};

const supportCardClass =
  "overflow-hidden transition-[border-color,box-shadow] duration-250 hover:border-foreground/20 hover:shadow-whisper motion-reduce:transition-none";

/** 判断配置链接是否应交给站内国际化路由。 */
function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.includes("\\");
}

/**
 * 渲染安全的站内或外部服务入口按钮。
 *
 * @param props 已通过共享 schema 校验的地址、按钮文案和视觉类型。
 * @returns 站内 Link 或带 noopener/noreferrer 的新窗口外链。
 */
function SupportAction({
  href,
  label,
  variant = "outline",
}: SupportActionProps) {
  if (isInternalHref(href)) {
    return (
      <Button asChild size="sm" variant={variant}>
        <Link href={href} prefetch={false}>
          {label}
          <ArrowUpRight />
        </Link>
      </Button>
    );
  }

  return (
    <Button asChild size="sm" variant={variant}>
      <a href={href} rel="noopener noreferrer" target="_blank">
        {label}
        <ArrowUpRight />
      </a>
    </Button>
  );
}

/**
 * 渲染启用的服务与支持入口。
 *
 * @param props 已校验的服务配置与页面语言。
 * @returns 无启用服务时不渲染；否则按管理员配置顺序展示入口。
 */
export function DashboardServiceSupport({
  configuration,
  isZh,
}: DashboardServiceSupportProps) {
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const services = getEnabledDashboardServices(configuration);

  if (services.length === 0) return null;

  return (
    <section
      aria-label={copy("Service and support", "服务与支持")}
      className="animate-in fade-in slide-in-from-bottom-2 delay-80 animation-duration-500 fill-mode-backwards motion-reduce:animate-none"
    >
      <Card className={supportCardClass}>
        <CardHeader className="border-b pb-4">
          <div className="space-y-1.5">
            <CardTitle className="font-serif text-lg font-medium tracking-tight">
              {copy("Service & Support", "服务与支持")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {copy(
                "Community, documentation, and direct support resources",
                "社区、文档与直接支持资源"
              )}
            </p>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 py-5 md:grid-cols-2">
          {services.map((service) => {
            const Icon = SERVICE_ICONS[service.icon];
            return (
              <article
                className="flex min-w-0 items-center gap-4 rounded-lg border bg-muted/10 p-4 transition-colors hover:bg-muted/25"
                key={service.id}
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-background">
                  <Icon className="size-4" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium">
                    {selectDashboardSupportText(service.title, isZh)}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {selectDashboardSupportText(service.description, isZh)}
                  </p>
                </div>
                <SupportAction
                  href={service.url}
                  label={selectDashboardSupportText(service.actionLabel, isZh)}
                  variant="ghost"
                />
              </article>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
}
