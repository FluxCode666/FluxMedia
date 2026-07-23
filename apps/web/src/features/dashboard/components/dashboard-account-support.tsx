/**
 * 控制台首页的账户、官方支持与服务入口展示区。
 *
 * DashboardPage 传入当前会话身份、经 UOL 校验的支持配置与公告预览。本组件不发起
 * 请求、不执行写操作；站内链接交给国际化路由，外链始终添加隔离属性。
 */
import type {
  DashboardSupportConfig,
  DashboardSupportServiceIcon,
} from "@repo/shared/support/dashboard-config";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@repo/ui/components/avatar";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { cn } from "@repo/ui/utils";
import {
  ArrowUpRight,
  BookOpenText,
  Boxes,
  Globe2,
  Headphones,
  type LucideIcon,
  Megaphone,
  MessageCircle,
  MessageCircleMore,
  MessagesSquare,
  QrCode,
  Send,
  Settings2,
  Twitter,
  UsersRound,
} from "lucide-react";

import {
  getEnabledDashboardServices,
  presentDashboardAccount,
  selectDashboardSupportText,
} from "@/features/dashboard/dashboard-account-presenter";
import type { DashboardAnnouncement } from "@/features/dashboard/dashboard-support-data";
import { Link } from "@/i18n/routing";

type DashboardAccountSupportProps = {
  user: {
    name: string | null | undefined;
    email: string | null | undefined;
    imageUrl: string | undefined;
  };
  configuration: DashboardSupportConfig;
  isZh: boolean;
  announcements: DashboardAnnouncement[];
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
  team: UsersRound,
  documentation: BookOpenText,
  models: Boxes,
  support: Headphones,
  website: Globe2,
};

const supportCardClass =
  "overflow-hidden transition-[border-color,box-shadow] duration-250 hover:border-foreground/20 hover:shadow-whisper motion-reduce:transition-none";

/** 判断配置链接是否应交给站内国际化路由。 */
function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

/**
 * 渲染安全的站内或外部支持按钮。
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
 * 渲染账户身份、官方支持、启用的服务列表与公告预览。
 *
 * @param props 当前会话、支持配置、公告预览与页面语言。
 * @returns 账户始终展示；官方支持和服务项尊重各自 enabled 配置，公告失败时展示空态。
 */
export function DashboardAccountSupport({
  user,
  configuration,
  isZh,
  announcements,
}: DashboardAccountSupportProps) {
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  const account = presentDashboardAccount({
    name: user.name,
    email: user.email,
    isZh,
  });
  const officialSupport = configuration.officialSupport;
  const services = getEnabledDashboardServices(configuration);

  return (
    <section
      aria-label={copy("Account and support", "账户与支持")}
      className="space-y-4 animate-in fade-in slide-in-from-bottom-2 delay-80 animation-duration-500 fill-mode-backwards motion-reduce:animate-none"
    >
      <div
        className={cn(
          "grid gap-4",
          officialSupport.enabled && "lg:grid-cols-2"
        )}
      >
        <Card className={supportCardClass}>
          <CardHeader className="border-b pb-4">
            <CardTitle className="font-serif text-lg font-medium tracking-tight">
              {copy("Your Account", "你的账户")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 py-5 sm:flex-row sm:items-center">
            <Avatar className="size-20 border bg-muted/40">
              <AvatarImage
                alt={account.displayName}
                className="object-cover"
                src={user.imageUrl}
              />
              <AvatarFallback className="font-serif text-2xl font-medium">
                {account.initials}
              </AvatarFallback>
            </Avatar>
            <dl className="grid min-w-0 flex-1 gap-3 text-sm">
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  {copy("Name", "姓名")}
                </dt>
                <dd className="mt-1 truncate font-medium">
                  {account.displayName}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  {copy("Email", "邮箱")}
                </dt>
                <dd className="mt-1 truncate text-muted-foreground">
                  {account.displayEmail}
                </dd>
              </div>
            </dl>
            <Button asChild size="sm" variant="ghost">
              <Link href="/dashboard/settings" prefetch={false}>
                <Settings2 />
                {copy("Settings", "设置")}
              </Link>
            </Button>
          </CardContent>
        </Card>

        {officialSupport.enabled ? (
          <Card className={supportCardClass}>
            <CardHeader className="border-b pb-4">
              <CardTitle className="font-serif text-lg font-medium tracking-tight">
                {copy("Official Support", "官方支持")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 py-5 sm:flex-row sm:items-center">
              <Avatar className="size-24 rounded-lg border bg-muted/25">
                {officialSupport.qrCodeUrl ? (
                  <AvatarImage
                    alt={copy("Official support QR code", "官方支持二维码")}
                    className="rounded-lg object-cover"
                    src={officialSupport.qrCodeUrl}
                  />
                ) : null}
                <AvatarFallback className="rounded-lg">
                  <QrCode
                    className="size-9 text-muted-foreground"
                    strokeWidth={1.25}
                  />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="font-serif text-lg font-medium tracking-tight">
                  {selectDashboardSupportText(officialSupport.channel, isZh)}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {selectDashboardSupportText(
                    officialSupport.description,
                    isZh
                  )}
                </p>
                <div className="mt-4">
                  <SupportAction
                    href={officialSupport.actionUrl}
                    label={selectDashboardSupportText(
                      officialSupport.actionLabel,
                      isZh
                    )}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {services.length > 0 ? (
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
            <CardContent className="grid gap-3 py-5">
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
                      label={selectDashboardSupportText(
                        service.actionLabel,
                        isZh
                      )}
                      variant="ghost"
                    />
                  </article>
                );
              })}
            </CardContent>
          </Card>
        ) : null}

        <Card className={supportCardClass}>
          <CardHeader className="border-b pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <CardTitle className="font-serif text-lg font-medium tracking-tight">
                  {copy("System announcements", "系统公告")}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {copy(
                    "Latest updates, maintenance, and platform messages",
                    "最新的系统更新、维护与平台消息"
                  )}
                </p>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link href="/dashboard/announcements" prefetch={false}>
                  {copy("View all", "查看全部")}
                  <ArrowUpRight />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 py-5">
            {announcements.length > 0 ? (
              announcements.map((announcement) => (
                <Link
                  className={cn(
                    "block rounded-lg border bg-muted/10 p-4 transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    !announcement.isRead && "bg-muted/25"
                  )}
                  href="/dashboard/announcements"
                  key={announcement.id}
                  prefetch={false}
                >
                  <article className="flex min-w-0 gap-3">
                    <Megaphone
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      strokeWidth={1.5}
                    />
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium">
                        {announcement.title}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {announcement.content}
                      </p>
                    </div>
                  </article>
                </Link>
              ))
            ) : (
              <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/10 px-6 text-center">
                <Megaphone
                  className="size-5 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <div>
                  <p className="text-sm font-medium">
                    {copy("No active announcements", "暂无生效公告")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {copy(
                      "New notices will appear here when published.",
                      "有新公告发布后会显示在这里。"
                    )}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
