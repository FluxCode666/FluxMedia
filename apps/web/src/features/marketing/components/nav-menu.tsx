/**
 * 营销 Header 的桌面导航菜单。
 *
 * 使用方：`header.tsx`；导航数据由 Header 同时传给本组件与移动 Sheet。
 * 关键依赖：next-intl 路由、NavigationMenu 与 Framer Motion 悬停反馈。
 */
"use client";

import type { MarketingHeaderNavigation } from "@repo/shared/config";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@repo/ui/components/navigation-menu";
import { cn } from "@repo/ui/utils";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link, usePathname } from "@/i18n/routing";

/**
 * Products 下拉菜单翻译映射 key
 * 用 i18n key 映射标题和描述
 */
const productsTitleMap: Record<string, string> = {
  "Core features": "productsMenu.core.title",
  "Chat to Image": "productsMenu.core.chatToImage",
  Gallery: "productsMenu.core.gallery",
  "Batch Generation": "productsMenu.core.batch",
};

const productsDescMap: Record<string, string> = {
  "Chat to Image": "productsMenu.core.chatToImageDesc",
  Gallery: "productsMenu.core.galleryDesc",
  "Batch Generation": "productsMenu.core.batchDesc",
};

/**
 * 导航菜单组件。
 *
 * @param navigation - 与移动 Sheet 共用的导航项和产品分组。
 * @returns 可键盘到达的桌面导航，并在当前首页内平滑滚动到目标区块。
 * @sideEffects 管理悬停态、Products 展开态和延迟关闭计时器。
 */
export function NavMenu({
  navigation,
}: {
  navigation: MarketingHeaderNavigation;
}) {
  const pathname = usePathname();
  const t = useTranslations("Navigation");
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [productsOpen, setProductsOpen] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const navTitleMap: Record<string, string> = {
    Models: t("models"),
    "Quick Integration": t("integration"),
    Work: t("work"),
    "Start Creating": t("create"),
    Docs: t("docs"),
    Blog: t("blog"),
  };

  /** 判断非锚点链接是否命中当前本地化路由。 */
  const isActive = (href: string) => {
    if (href.startsWith("/#")) return false;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  /** 在首页内就地滚动；跨路由时保留 i18n Link 的正常导航。 */
  const handleClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string
  ) => {
    if (href.startsWith("/#")) {
      const anchor = href.substring(2);
      if (pathname === "/") {
        e.preventDefault();
        const element = document.getElementById(anchor);
        if (element) {
          element.scrollIntoView({ behavior: "smooth" });
        }
      }
    }
  };

  /** 取消待执行的关闭并展开 Products 菜单。 */
  const handleProductsEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setProductsOpen(true);
  };

  /** 给指针跨越菜单间隙保留短暂缓冲，随后关闭 Products。 */
  const handleProductsLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setProductsOpen(false);
    }, 150);
  };

  return (
    <NavigationMenu onMouseLeave={() => setHoveredItem(null)}>
      <NavigationMenuList className="gap-0">
        {/* Products 下拉菜单 */}
        {navigation.productGroups.length > 0 && (
          <NavigationMenuItem
            className="relative"
            onMouseEnter={handleProductsEnter}
            onMouseLeave={handleProductsLeave}
          >
            <button
              type="button"
              aria-controls="marketing-products-menu"
              aria-expanded={productsOpen}
              className={cn(
                "relative inline-flex h-9 items-center justify-center gap-1 px-4 py-2 text-sm font-medium transition-colors",
                productsOpen
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setProductsOpen((open) => !open)}
              onMouseEnter={() => setHoveredItem("products")}
            >
              {hoveredItem === "products" && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 -z-10 rounded-md bg-muted"
                  transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                />
              )}
              {t("products")}
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200",
                  productsOpen && "rotate-180"
                )}
              />
            </button>

            {/* Dropdown panel */}
            <AnimatePresence>
              {productsOpen && (
                <motion.div
                  id="marketing-products-menu"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2"
                  onMouseEnter={handleProductsEnter}
                  onMouseLeave={handleProductsLeave}
                >
                  <div className="w-[320px] rounded-lg border border-border bg-popover p-4 shadow-menu">
                    <div className="grid grid-cols-1 gap-4">
                      {navigation.productGroups.map((group) => (
                        <div key={group.title}>
                          <h4 className="mb-3 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            {t(productsTitleMap[group.title] || group.title)}
                          </h4>
                          <div className="space-y-1">
                            {group.items.map((item) => {
                              const Icon = item.icon;
                              return (
                                <Link
                                  key={item.title}
                                  href={item.href}
                                  onClick={() => setProductsOpen(false)}
                                  className="flex items-start gap-3 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-muted"
                                >
                                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                                  <div>
                                    <div className="text-sm font-medium">
                                      {t(
                                        productsTitleMap[item.title] ||
                                          item.title
                                      )}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {t(
                                        productsDescMap[item.title] ||
                                          item.title
                                      )}
                                    </div>
                                  </div>
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </NavigationMenuItem>
        )}

        {/* 普通导航链接 */}
        {navigation.items.map((item) => {
          const active = isActive(item.href);
          return (
            <NavigationMenuItem key={item.href}>
              <NavigationMenuLink asChild>
                <Link
                  href={item.href}
                  onClick={(e) => handleClick(e, item.href)}
                  onMouseEnter={() => setHoveredItem(item.href)}
                  className={cn(
                    "relative inline-flex h-9 items-center justify-center px-4 py-2 text-sm font-medium transition-colors",
                    active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {hoveredItem === item.href && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 -z-10 rounded-md bg-muted"
                      transition={{
                        type: "spring",
                        bounce: 0,
                        duration: 0.3,
                      }}
                    />
                  )}
                  {/* 当前路由静态底色:无动画诉求,用普通元素即可 */}
                  {active && !hoveredItem && (
                    <span className="absolute inset-0 -z-10 rounded-md bg-muted/50" />
                  )}
                  {navTitleMap[item.title] || item.title}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          );
        })}
      </NavigationMenuList>
    </NavigationMenu>
  );
}
