"use client";

/**
 * 公开 API 文档的响应式滚动电梯。
 *
 * 桌面端固定在内容左侧，窄屏退化为顶栏下方的横向导航；滚动和窗口尺寸变化通过
 * requestAnimationFrame 合帧，避免长文档高频读取布局造成抖动。
 */
import { cn } from "@repo/ui/utils";
import { useEffect, useState } from "react";

import { resolveActiveElevatorSection } from "./api-docs-elevator-core";
import type { ApiIntegrationEndpoint } from "./api-integration-docs-data";

type ElevatorEndpoint = Pick<
  ApiIntegrationEndpoint,
  "category" | "id" | "method" | "path"
>;

const MOBILE_ACTIVATION_LINE = 144;
// 章节使用 scroll-mt-32（128px）；激活线需略低于锚点落位，否则点击电梯后会
// 因章节顶部仍高于激活线而回退高亮上一项。
const DESKTOP_ACTIVATION_LINE = 144;

/**
 * 渲染随滚动高亮的章节导航。
 *
 * @param ariaLabel - 导航区域的无障碍名称。
 * @param endpoints - 当前公开且按页面顺序排列的端点。
 * @returns 响应式 aside；没有端点时不渲染。
 * @sideEffects 监听 window scroll、resize 与 hashchange，并读取章节矩形。
 */
export function ApiDocsElevator({
  ariaLabel,
  endpoints,
}: {
  ariaLabel: string;
  endpoints: readonly ElevatorEndpoint[];
}) {
  const firstEndpointId = endpoints[0]?.id ?? "";
  const [activeId, setActiveId] = useState(firstEndpointId);
  const endpointIdsKey = endpoints.map((endpoint) => endpoint.id).join("\n");

  useEffect(() => {
    const endpointIds = endpointIdsKey.split("\n").filter(Boolean);
    if (endpointIds.length === 0) return;

    let frameId: number | null = null;

    /** 在同一动画帧读取所有章节位置并更新一次高亮状态。 */
    const measure = () => {
      frameId = null;
      const sections = endpointIds.flatMap((id) => {
        const element = document.getElementById(id);
        return element
          ? [{ id, top: element.getBoundingClientRect().top }]
          : [];
      });
      const documentHeight = document.documentElement.scrollHeight;
      const isAtPageEnd =
        window.scrollY + window.innerHeight >= documentHeight - 2;
      const activationLine =
        window.innerWidth < 1024
          ? MOBILE_ACTIVATION_LINE
          : DESKTOP_ACTIVATION_LINE;
      const nextActiveId = resolveActiveElevatorSection(
        sections,
        activationLine,
        isAtPageEnd
      );

      if (nextActiveId) {
        setActiveId((currentId) =>
          currentId === nextActiveId ? currentId : nextActiveId
        );
      }
    };

    /** 把多个连续浏览器事件合并为一次布局读取。 */
    const scheduleMeasure = () => {
      if (frameId === null) {
        frameId = window.requestAnimationFrame(measure);
      }
    };

    scheduleMeasure();
    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("hashchange", scheduleMeasure);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("hashchange", scheduleMeasure);
    };
  }, [endpointIdsKey]);

  if (endpoints.length === 0) return null;

  return (
    <aside className="sticky top-16 z-20 -mx-4 self-start border-y border-border/60 bg-background/95 px-4 py-2 shadow-whisper backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:top-24 lg:z-10 lg:mx-0 lg:rounded-lg lg:border lg:p-2">
      <nav aria-label={ariaLabel}>
        <p className="hidden px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70 lg:block">
          {ariaLabel}
        </p>
        <div className="flex gap-1 overflow-x-auto lg:block lg:space-y-1 lg:overflow-visible">
          {endpoints.map((endpoint, index) => {
            const isActive = activeId === endpoint.id;
            return (
              <a
                aria-current={isActive ? "location" : undefined}
                className={cn(
                  "group flex shrink-0 items-start gap-2.5 rounded-md border border-transparent px-3 py-2 text-left transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:w-full",
                  isActive
                    ? "border-border bg-muted font-medium text-foreground shadow-xs lg:border-l-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
                href={`#${endpoint.id}`}
                key={endpoint.id}
                onClick={() => setActiveId(endpoint.id)}
              >
                <span className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 whitespace-nowrap text-xs">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 shrink-0 rounded-full border",
                        isActive
                          ? "border-foreground bg-foreground"
                          : "border-muted-foreground/50 bg-transparent"
                      )}
                    />
                    {endpoint.category}
                  </span>
                  <code className="mt-1 hidden truncate font-mono text-[10px] font-normal text-muted-foreground lg:block">
                    {endpoint.method} {endpoint.path}
                  </code>
                </span>
              </a>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
