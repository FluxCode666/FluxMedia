/**
 * 持久化成功产物的事务读模型写入服务。
 *
 * 图片与视频完成路径通过本模块在同一数据库事务中更新权威任务、插入唯一事件，并且
 * 只在事件真实插入时原子递增用户汇总。读模型失败会回滚 completed 更新，不做降级吞错。
 */
import { db } from "@repo/database";
import {
  generation,
  userOutputUsageEvent,
  userUsageSummary,
  videoGeneration,
} from "@repo/database/schema";
import { and, eq, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

/** 成功产物事件；两个数值字段保持互斥，便于数据库使用窄列聚合。 */
export type OutputUsageEvent =
  | {
      outputKind: "image";
      sourceTaskId: string;
      userId: string;
      operationCreatedAt: Date;
      imageCount: number;
      videoSeconds: 0;
    }
  | {
      outputKind: "video";
      sourceTaskId: string;
      userId: string;
      operationCreatedAt: Date;
      imageCount: 0;
      videoSeconds: number;
    };

/**
 * 事件与汇总写入所需的最小事务接口。
 *
 * 测试使用内存实现；生产实现的两个方法闭包捕获同一个 Drizzle transaction。
 */
export interface OutputUsageEventStore {
  insertEvent: (event: OutputUsageEvent) => Promise<boolean>;
  incrementSummary: (event: OutputUsageEvent) => Promise<void>;
}

/** 权威完成写入的统一结果，供重复回调与正常完成使用同一语义。 */
export type OutputUsageCompletionResult = {
  completed: boolean;
  eventInserted: boolean;
};

/**
 * 校验事件运行时不变量，防止绕过 TypeScript 的回填或外部数据写入非法计数。
 *
 * @param event 待写入的图片或视频事件。
 * @throws RangeError 当 ID、时间、正值或互斥字段非法；无数据库副作用。
 */
function assertValidOutputUsageEvent(event: OutputUsageEvent): void {
  if (!event.sourceTaskId.trim() || !event.userId.trim()) {
    throw new RangeError("产物事件必须包含任务 ID 和用户 ID");
  }
  if (Number.isNaN(event.operationCreatedAt.getTime())) {
    throw new RangeError("产物事件创建时间无效");
  }
  if (event.outputKind === "image") {
    if (!Number.isInteger(event.imageCount) || event.imageCount <= 0) {
      throw new RangeError("图片产物数量必须是正整数");
    }
    if (event.videoSeconds !== 0) {
      throw new RangeError("图片事件不能包含视频秒数");
    }
    return;
  }
  if (!Number.isInteger(event.videoSeconds) || event.videoSeconds <= 0) {
    throw new RangeError("视频秒数必须是正整数");
  }
  if (event.imageCount !== 0) {
    throw new RangeError("视频事件不能包含图片数量");
  }
}

/**
 * 应用一条成功产物事件，并仅在唯一事件插入成功时递增累计汇总。
 *
 * @param store 同一事务内的事件与汇总存储。
 * @param event 已从权威任务完成行构造的事件。
 * @returns inserted 表示本次是否首次应用；冲突回放返回 false。
 * @throws 校验或任一存储写入错误，调用方事务必须整体回滚。
 */
export async function applyOutputUsageEvent(
  store: OutputUsageEventStore,
  event: OutputUsageEvent
): Promise<{ inserted: boolean }> {
  assertValidOutputUsageEvent(event);
  const inserted = await store.insertEvent(event);
  if (inserted) {
    await store.incrementSummary(event);
  }
  return { inserted };
}

/**
 * 在当前 Drizzle 事务上构造读模型存储。
 *
 * @param tx 图片或视频权威完成事务。
 * @returns 捕获该事务的最小存储；所有写入随 completed 更新一起提交或回滚。
 */
export function createOutputUsageEventStore(
  tx: Pick<typeof db, "insert">
): OutputUsageEventStore {
  return {
    async insertEvent(event) {
      const inserted = await tx
        .insert(userOutputUsageEvent)
        .values(event)
        .onConflictDoNothing({
          target: [
            userOutputUsageEvent.outputKind,
            userOutputUsageEvent.sourceTaskId,
          ],
        })
        .returning({ sourceTaskId: userOutputUsageEvent.sourceTaskId });
      return inserted.length === 1;
    },
    async incrementSummary(event) {
      const imageIncrement = event.imageCount;
      const videoIncrement = event.videoSeconds;
      await tx
        .insert(userUsageSummary)
        .values({
          userId: event.userId,
          totalImageCount: imageIncrement,
          totalVideoSeconds: videoIncrement,
        })
        .onConflictDoUpdate({
          target: userUsageSummary.userId,
          set: {
            totalImageCount: sql`${userUsageSummary.totalImageCount} + ${imageIncrement}`,
            totalVideoSeconds: sql`${userUsageSummary.totalVideoSeconds} + ${videoIncrement}`,
            updatedAt: new Date(),
          },
        });
    },
  };
}

type CompleteImageGenerationInput = {
  generationId: string;
  update: Omit<PgUpdateSetSource<typeof generation>, "status">;
  output:
    | { kind: "image"; imageCount: number }
    | {
        kind: "none";
        reason: "chatTextOnly" | "noBillableImageOutput";
      };
};

/**
 * 完成一条图片 generation，并在有持久化图片时写入用量事件。
 *
 * @param input completed 字段、明确图片计数或合法零产物原因。
 * @returns 是否首次从 pending 完成，以及是否插入事件。
 * @throws 权威更新或读模型写入失败；事务整体回滚。
 */
export async function completeImageGenerationWithUsage(
  input: CompleteImageGenerationInput
): Promise<OutputUsageCompletionResult> {
  return db.transaction(async (tx) => {
    const [completed] = await tx
      .update(generation)
      .set({ ...input.update, status: "completed" })
      .where(
        and(
          eq(generation.id, input.generationId),
          eq(generation.status, "pending")
        )
      )
      .returning({
        id: generation.id,
        userId: generation.userId,
        createdAt: generation.createdAt,
      });
    if (!completed) {
      return { completed: false, eventInserted: false };
    }
    if (input.output.kind === "none") {
      return { completed: true, eventInserted: false };
    }
    const event = {
      outputKind: "image",
      sourceTaskId: completed.id,
      userId: completed.userId,
      operationCreatedAt: completed.createdAt,
      imageCount: input.output.imageCount,
      videoSeconds: 0,
    } satisfies OutputUsageEvent;
    const result = await applyOutputUsageEvent(
      createOutputUsageEventStore(tx),
      event
    );
    return { completed: true, eventInserted: result.inserted };
  });
}

type CompleteVideoGenerationInput = {
  videoGenerationId: string;
  storageKey: string;
  completedAt: Date;
};

/**
 * 完成一条已持久化视频任务并记录成功秒数。
 *
 * @param input running 视频 ID、已落对象存储的 key 与完成时间。
 * @returns 是否首次从 running 完成，以及是否插入事件。
 * @throws 非正时长或任一数据库写入失败；completed 与读模型会一起回滚。
 */
export async function completeVideoGenerationWithUsage(
  input: CompleteVideoGenerationInput
): Promise<OutputUsageCompletionResult> {
  return db.transaction(async (tx) => {
    const [completed] = await tx
      .update(videoGeneration)
      .set({
        status: "completed",
        storageKey: input.storageKey,
        completedAt: input.completedAt,
        updatedAt: input.completedAt,
      })
      .where(
        and(
          eq(videoGeneration.id, input.videoGenerationId),
          eq(videoGeneration.status, "running")
        )
      )
      .returning({
        id: videoGeneration.id,
        userId: videoGeneration.userId,
        createdAt: videoGeneration.createdAt,
        durationSeconds: videoGeneration.durationSeconds,
      });
    if (!completed) {
      return { completed: false, eventInserted: false };
    }
    const event = {
      outputKind: "video",
      sourceTaskId: completed.id,
      userId: completed.userId,
      operationCreatedAt: completed.createdAt,
      imageCount: 0,
      videoSeconds: completed.durationSeconds,
    } satisfies OutputUsageEvent;
    const result = await applyOutputUsageEvent(
      createOutputUsageEventStore(tx),
      event
    );
    return { completed: true, eventInserted: result.inserted };
  });
}
