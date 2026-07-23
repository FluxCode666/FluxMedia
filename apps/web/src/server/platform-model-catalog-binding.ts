/**
 * 平台公开模型目录的 UOL late binding。
 *
 * 使用方：uol-bindings 启动桶与聚焦集成测试；负责把 web 运行时目录显式映射为
 * shared 严格 DTO，再注册为 system-only operation 的真实执行体。
 */

import {
  bindExecute,
  type OperationContext,
  type Principal,
} from "@repo/shared/uol";
import { platformModelCatalogOutputSchema } from "@repo/shared/uol/operations";
import type { PlatformModelCatalog } from "@/features/external-api/platform-model-catalog";
import { loadPlatformModelCatalog } from "@/features/external-api/platform-model-catalog-service";

/** late binding 可注入的目录读取依赖。 */
export type PlatformModelCatalogBindingDependencies = {
  loadCatalog: () => Promise<PlatformModelCatalog>;
};

const defaultDependencies: PlatformModelCatalogBindingDependencies = {
  loadCatalog: loadPlatformModelCatalog,
};

/**
 * 绑定首页平台公开模型目录的真实执行体。
 *
 * @param dependencies - 目录读取器；生产使用运行时服务，测试可注入带 canary 的结果。
 * @returns 无返回值；副作用是替换 registry 中对应 operation 的 execute。
 * @remarks 逐项白名单映射后仍执行 strict parse，保证输出约束位于 binding 边界。
 */
export function bindPlatformModelCatalogOperation(
  dependencies: PlatformModelCatalogBindingDependencies = defaultDependencies
): void {
  bindExecute(
    "externalApi.getPlatformModelCatalog",
    async (
      _input: Record<string, never>,
      _principal: Principal,
      _ctx: OperationContext
    ) => {
      const catalog = await dependencies.loadCatalog();
      return platformModelCatalogOutputSchema.parse({
        image: catalog.image.map((model) => ({ id: model.id })),
        video: catalog.video.map((model) => ({ id: model.id })),
        conversation: catalog.conversation.map((model) => ({ id: model.id })),
      });
    }
  );
}
