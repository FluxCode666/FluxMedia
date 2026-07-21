/**
 * 图片成功产物数量的 DB-free 证据解析器。
 *
 * 在线双写与历史回填共用同一优先级：可计费多图数量、当前 storageKey、保留清理证据。
 * completed 行证据全缺不会静默计零，而是返回显式不足，供回填阻断启用。
 */

export type ImageOutputCountResult =
  | {
      status: "counted";
      count: number;
      evidence: "billableImageOutputCount" | "storageKey" | "photoRetention";
    }
  | {
      status: "notCounted";
      count: 0;
      reason: "notCompleted" | "nonPositiveBillableCount" | "chatTextOnly";
    }
  | {
      status: "insufficientEvidence";
      count: null;
      reason: "completedWithoutOutputEvidence";
    };

type ImageOutputCountInput = {
  status: string;
  storageKey?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * 将未知 JSON 值收窄为普通对象。
 *
 * @param value 数据库 JSON 子节点。
 * @returns 非数组对象或 null；无外部副作用。
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 从成功 generation 行解析可计费图片产物数量及证据。
 *
 * @param input generation 的 status、顶层 storageKey 与 metadata。
 * @returns 计数、明确不计数或证据不足三态；不修改输入且无外部副作用。
 */
export function resolveImageOutputCount(
  input: ImageOutputCountInput
): ImageOutputCountResult {
  if (input.status !== "completed") {
    return { status: "notCounted", count: 0, reason: "notCompleted" };
  }
  const outputImage = asRecord(input.metadata?.outputImage);
  const billableCount = outputImage?.billableImageOutputCount;
  if (typeof billableCount === "number" && Number.isFinite(billableCount)) {
    if (!Number.isInteger(billableCount) || billableCount <= 0) {
      return {
        status: "notCounted",
        count: 0,
        reason: "nonPositiveBillableCount",
      };
    }
    return {
      status: "counted",
      count: billableCount,
      evidence: "billableImageOutputCount",
    };
  }
  if (input.storageKey?.trim()) {
    return { status: "counted", count: 1, evidence: "storageKey" };
  }
  if (asRecord(outputImage?.photoRetention)) {
    return { status: "counted", count: 1, evidence: "photoRetention" };
  }
  // Chat 纯文本会合法地把 generation 标为 completed，但它不是图片产物。只有明确的
  // chatTextOnlyCharge 标记可以归零；其他 completed 无证据行仍须阻断历史回填。
  if (asRecord(input.metadata?.chatTextOnlyCharge)) {
    return { status: "notCounted", count: 0, reason: "chatTextOnly" };
  }
  return {
    status: "insufficientEvidence",
    count: null,
    reason: "completedWithoutOutputEvidence",
  };
}
