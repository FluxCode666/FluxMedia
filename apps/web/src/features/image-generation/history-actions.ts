"use server";

/**
 * 统一生成历史 Server Action 薄传输适配器。
 *
 * 使用方：历史记录页面与客户端分页。这里只校验机器输入、构造当前会话 Principal 并
 * 调用 UOL；时区解析、主体隔离、cursor 与数据库查询全部留在统一接口层绑定中。
 */

import { getUserRoleById } from "@repo/shared/auth/role-server";
import {
  type HistoryListOutput,
  historyListInputSchema,
} from "@repo/shared/image-generation/history-contract";
import { protectedAction } from "@repo/shared/safe-action";
import { invokeOperation } from "@repo/shared/uol";

import { ensureUolInitialized } from "@/server/uol-init";

/** 读取当前登录用户的一页图片/视频统一历史。 */
export const getMyHistoryRecordsAction = protectedAction
  .metadata({ action: "image.listMyHistoryRecords" })
  .schema(historyListInputSchema)
  .action(async ({ parsedInput, ctx }): Promise<HistoryListOutput> => {
    await ensureUolInitialized();
    const role = await getUserRoleById(ctx.userId);
    return invokeOperation<HistoryListOutput>(
      "image.listMyHistoryRecords",
      parsedInput,
      { type: "user", userId: ctx.userId, role }
    );
  });
