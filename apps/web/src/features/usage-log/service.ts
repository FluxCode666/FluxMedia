/**
 * 使用日志应用服务。
 *
 * 使用方：UOL binding。职责是 readiness 门禁、自然日范围、签名分页和详情隔离；
 * 数据库实现通过 UsageLogRepository 注入，使核心行为可在无数据库环境单测。
 */

import {
  type UsageBusinessType,
  type UsageEventDetail,
  type UsageLogCursorFilters,
  type UsageStatus,
  usageEventDetailSchema,
  usageEventListOutputSchema,
  usageLogListInputSchema,
} from "@repo/shared/credits/usage-log-contract";
import {
  decodeUsageEventRef,
  decodeUsageLogCursor,
  encodeUsageLogCursor,
} from "@repo/shared/credits/usage-log-token";
import {
  formatDateInputInTimeZone,
  parseDateInputInTimeZone,
} from "@repo/shared/time-zone";

import {
  adaptRefundDetailRow,
  adaptRequestDetailRow,
  adaptUsageListRow,
  type UsageLogListRow,
  type UsageRefundDetailRow,
  type UsageRequestDetailRow,
} from "./row-adapters";
import {
  isUsageLogStableRankValid,
  parseUsageLogStableId,
  type UsageLogStableId,
} from "./stable-id";

/** 查询 SQL 所需的稳定筛选和分支上限。 */
export interface UsageLogListQuery {
  userId: string;
  start: Date;
  end: Date;
  asOf: Date;
  businessType: UsageBusinessType | null;
  status: UsageStatus | null;
  cursor: {
    eventAt: Date;
    eventKindRank: number;
    stableId: string;
    stableKey: UsageLogStableId;
  } | null;
  branchLimit: number;
}

/** 使用日志仓储；列表主数据必须由一次有界读取返回。 */
export interface UsageLogRepository {
  readCreditUsageState(): Promise<{
    version: number;
    status: string;
  } | null>;
  readListRows(query: UsageLogListQuery): Promise<UsageLogListRow[]>;
  readRequestDetail(input: {
    userId: string;
    businessType: UsageBusinessType;
    stableId: string;
  }): Promise<UsageRequestDetailRow | null>;
  readRefundDetail(input: {
    userId: string;
    stableId: string;
  }): Promise<UsageRefundDetailRow | null>;
}

/** 服务层稳定错误；message 不包含 token、eventRef 或业务 ID。 */
export class UsageLogServiceError extends Error {
  /** 创建不泄露资源存在性的稳定服务错误。 */
  constructor(
    readonly code: "not_ready" | "not_found" | "validation_error",
    message: string
  ) {
    super(message);
    this.name = "UsageLogServiceError";
  }
}

/** 版本 1 credit_usage 未 ready 时拒绝历史读取，避免退化为全账本扫描。 */
async function assertCreditUsageReady(
  repository: UsageLogRepository
): Promise<void> {
  const state = await repository.readCreditUsageState();
  if (state?.version !== 1 || state.status !== "ready") {
    throw new UsageLogServiceError(
      "not_ready",
      "Usage data is still being prepared"
    );
  }
}

/** 对 YYYY-MM-DD 做日历天位移，不把 24 小时误当成 DST 自然日。 */
function shiftIsoDate(dateInput: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
  if (!match) throw new RangeError("Invalid date input");
  const [, year, month, day] = match;
  const shifted = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day) + days)
  );
  return shifted.toISOString().slice(0, 10);
}

/** 解析 7/30/90 个自然日的半开 UTC 范围，正确覆盖 DST 23/25 小时日。 */
export function resolveUsageLogNaturalRange(input: {
  range: "7d" | "30d" | "90d";
  timeZone: string;
  asOf: Date;
}): { start: Date; end: Date } {
  const today = formatDateInputInTimeZone(input.asOf, input.timeZone);
  const days = Number.parseInt(input.range, 10);
  const start = parseDateInputInTimeZone(shiftIsoDate(today, 1 - days), {
    timeZone: input.timeZone,
  });
  const end = parseDateInputInTimeZone(shiftIsoDate(today, 1), {
    timeZone: input.timeZone,
  });
  if (!start || !end) {
    throw new UsageLogServiceError(
      "validation_error",
      "Unable to resolve usage range"
    );
  }
  return { start, end };
}

/**
 * 读取当前用户的一页使用日志。
 *
 * @param request 已认证主体、时区、外部输入和可注入时钟。
 * @param dependencies 仓储与可选测试密钥。
 * @returns 经共享 schema parse 的列表；不查询总数。
 */
export async function loadUsageEvents(
  request: {
    userId: string;
    timeZone: string;
    input: unknown;
    now?: Date;
  },
  dependencies: {
    repository: UsageLogRepository;
    tokenSecret?: string;
  }
) {
  const parsed = usageLogListInputSchema.parse(request.input);
  await assertCreditUsageReady(dependencies.repository);
  const serverNow = request.now ?? new Date();
  const filters: UsageLogCursorFilters = {
    range: parsed.range,
    businessType: parsed.businessType,
    status: parsed.status,
  };
  let asOf = serverNow;
  let cursor: UsageLogListQuery["cursor"] = null;
  if (parsed.cursor) {
    try {
      const decoded = decodeUsageLogCursor(
        parsed.cursor,
        {
          userId: request.userId,
          filters,
          asOfNotAfter: serverNow.toISOString(),
        },
        dependencies.tokenSecret
      );
      asOf = new Date(decoded.asOf);
      const stableKey = parseUsageLogStableId(decoded.sortKey.stableId);
      if (
        !stableKey ||
        !isUsageLogStableRankValid(stableKey, decoded.sortKey.eventKindRank)
      ) {
        throw new UsageLogServiceError(
          "validation_error",
          "Invalid usage log cursor"
        );
      }
      cursor = {
        eventAt: new Date(decoded.sortKey.eventAt),
        eventKindRank: decoded.sortKey.eventKindRank,
        stableId: decoded.sortKey.stableId,
        stableKey,
      };
    } catch {
      throw new UsageLogServiceError(
        "validation_error",
        "Invalid usage log cursor"
      );
    }
  }
  const range = resolveUsageLogNaturalRange({
    range: parsed.range,
    timeZone: request.timeZone,
    asOf,
  });
  // HMAC 只证明载荷由服务端签发；仍需验证排序键属于同一快照和自然日窗口，
  // 防止旧版本或异常签发的 cursor 扩大 SQL keyset 边界。
  if (
    cursor &&
    (cursor.eventAt > asOf ||
      cursor.eventAt < range.start ||
      cursor.eventAt >= range.end)
  ) {
    throw new UsageLogServiceError(
      "validation_error",
      "Invalid usage log cursor"
    );
  }
  const rows = await dependencies.repository.readListRows({
    userId: request.userId,
    start: range.start,
    end: range.end,
    asOf,
    businessType: parsed.businessType,
    status: parsed.status,
    cursor,
    branchLimit: parsed.limit + 1,
  });
  const pageRows = rows.slice(0, parsed.limit);
  const events = pageRows.map((row) =>
    adaptUsageListRow(row, {
      userId: request.userId,
      tokenSecret: dependencies.tokenSecret,
    })
  );
  const last = rows.length > parsed.limit ? pageRows.at(-1) : null;
  const nextCursor = last
    ? encodeUsageLogCursor(
        {
          userId: request.userId,
          filters,
          asOf: asOf.toISOString(),
          sortKey: {
            eventAt:
              last.eventAt instanceof Date
                ? last.eventAt.toISOString()
                : new Date(last.eventAt).toISOString(),
            eventKindRank: last.eventKindRank,
            stableId: last.stableId,
          },
        },
        dependencies.tokenSecret
      )
    : null;
  return usageEventListOutputSchema.parse({
    asOf: asOf.toISOString(),
    events,
    nextCursor,
  });
}

/**
 * 读取当前用户单条使用日志详情。
 *
 * @param request 已认证主体和不可信 eventRef。
 * @param dependencies 仓储与可选测试密钥。
 * @returns request/refund 详情；外部 token 与不存在统一 not_found。
 */
export async function loadUsageEventDetail(
  request: { userId: string; eventRef: string },
  dependencies: {
    repository: UsageLogRepository;
    tokenSecret?: string;
  }
): Promise<UsageEventDetail> {
  await assertCreditUsageReady(dependencies.repository);
  let decoded: ReturnType<typeof decodeUsageEventRef>;
  try {
    decoded = decodeUsageEventRef(
      request.eventRef,
      { userId: request.userId },
      dependencies.tokenSecret
    );
  } catch {
    throw new UsageLogServiceError("not_found", "Usage event not found");
  }
  const detail =
    decoded.eventKind === "refund"
      ? await dependencies.repository
          .readRefundDetail({
            userId: request.userId,
            stableId: decoded.stableId,
          })
          .then((row) =>
            row
              ? adaptRefundDetailRow(row, {
                  userId: request.userId,
                  tokenSecret: dependencies.tokenSecret,
                })
              : null
          )
      : await dependencies.repository
          .readRequestDetail({
            userId: request.userId,
            businessType: decoded.businessType,
            stableId: decoded.stableId,
          })
          .then((row) => (row ? adaptRequestDetailRow(row) : null));
  if (!detail) {
    throw new UsageLogServiceError("not_found", "Usage event not found");
  }
  return usageEventDetailSchema.parse(detail);
}
