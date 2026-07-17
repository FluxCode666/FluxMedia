/**
 * API 后端请求参数映射。
 *
 * 职责：校验管理端保存的映射规则，并在请求即将发送至上游时安全地复制或重命名字段。
 * 使用方：图像后端池的 API 配置、图像请求发送层与 UOL 操作 schema。
 * 关键依赖：Zod；本模块不依赖数据库或网络，可在服务端与客户端复用。
 */
import { z } from "zod";

const PARAMETER_PATH_SEGMENT = /^[A-Za-z_][A-Za-z0-9_-]*(?:\[\])?$/;
const ARRAY_INDEX_SEGMENT = /^(0|[1-9][0-9]*)$/;
const BLOCKED_PARAMETER_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** 参数映射模式：复制保留原参数，重命名会移除原参数。 */
export const REQUEST_PARAMETER_MAPPING_MODES = ["copy", "move"] as const;

export type RequestParameterMappingMode =
  (typeof REQUEST_PARAMETER_MAPPING_MODES)[number];

/** 单条上游请求参数映射。 */
export type RequestParameterMapping = {
  source: string;
  target: string;
  mode: RequestParameterMappingMode;
};

/**
 * 判断点路径是否只由安全对象键和数组下标构成。
 *
 * @param value - 管理端输入的路径，例如 `model` 或 `tools.0.model`。
 * @returns 路径可用于读写普通请求对象时返回 true。
 */
export function isSafeRequestParameterPath(value: string): boolean {
  const segments = value.split(".");
  return (
    segments.length > 0 &&
    segments.every((segment) => {
      const objectKey = segment.endsWith("[]") ? segment.slice(0, -2) : segment;
      return (
        !BLOCKED_PARAMETER_PATH_SEGMENTS.has(objectKey) &&
        (PARAMETER_PATH_SEGMENT.test(segment) ||
          ARRAY_INDEX_SEGMENT.test(segment))
      );
    })
  );
}

/** 管理端、UOL 与运行时共用的单条映射输入 schema。 */
export const requestParameterMappingSchema = z.object({
  source: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine(isSafeRequestParameterPath, "来源路径不合法"),
  target: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine(isSafeRequestParameterPath, "目标路径不合法"),
  mode: z.enum(REQUEST_PARAMETER_MAPPING_MODES),
});

/** 一组映射上限为 50 条，避免配置意外放大单次请求复杂度。 */
export const requestParameterMappingsSchema = z
  .array(requestParameterMappingSchema)
  .max(50)
  .superRefine((mappings, context) => {
    const sourceIndexes = new Map<string, number>();
    const targetIndexes = new Map<string, number>();
    for (const [index, mapping] of mappings.entries()) {
      const previousSource = sourceIndexes.get(mapping.source);
      if (previousSource !== undefined) {
        context.addIssue({
          code: "custom",
          path: [index, "source"],
          message: `来源路径与第 ${previousSource + 1} 条重复`,
        });
      } else {
        sourceIndexes.set(mapping.source, index);
      }
      const previousTarget = targetIndexes.get(mapping.target);
      if (previousTarget !== undefined) {
        context.addIssue({
          code: "custom",
          path: [index, "target"],
          message: `目标路径与第 ${previousTarget + 1} 条重复`,
        });
      } else {
        targetIndexes.set(mapping.target, index);
      }
    }
  });

type RequestPayload = Record<string, unknown>;

/**
 * 判断值是否为可安全遍历的普通记录对象。
 *
 * @param value - 待判断的未知值。
 * @returns 值为普通对象时返回 true，Blob/File 等对象会保持为原子值。
 */
function isPlainRecord(value: unknown): value is RequestPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 深复制请求载荷的容器结构，同时保留 Blob、File 等非普通对象的引用。
 *
 * @param value - 原始请求值。
 * @returns 可被映射过程安全修改的副本。
 */
function cloneRequestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneRequestValue);
  if (!isPlainRecord(value)) return value;
  const result: RequestPayload = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = cloneRequestValue(child);
  }
  return result;
}

/**
 * 把已验证的点路径拆成段。
 *
 * @param path - 经过 schema 校验的路径。
 * @returns 路径段数组。
 */
function splitPath(path: string): string[] {
  return path.split(".");
}

/**
 * 从对象或数组读取一个自有字段值。
 *
 * @param payload - 请求载荷。
 * @param path - 已校验的来源路径。
 * @returns 找到时返回 `{ found: true, value }`，缺失时不写入目标字段。
 */
function getPathValue(
  payload: RequestPayload,
  path: string
): { found: boolean; value?: unknown } {
  let current: unknown = payload;
  for (const segment of splitPath(path)) {
    if (Array.isArray(current)) {
      if (!ARRAY_INDEX_SEGMENT.test(segment)) return { found: false };
      const index = Number(segment);
      if (!(index in current)) return { found: false };
      current = current[index];
      continue;
    }
    if (!isPlainRecord(current) || !Object.hasOwn(current, segment)) {
      return { found: false };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

/**
 * 在对象或数组中创建中间容器并写入目标值。
 *
 * @param payload - 将被修改的请求载荷副本。
 * @param path - 已校验的目标路径。
 * @param value - 从原始请求载荷读取的值。
 */
function setPathValue(payload: RequestPayload, path: string, value: unknown) {
  const segments = splitPath(path);
  let current: RequestPayload | unknown[] = payload;
  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1;
    if (isLast) {
      if (Array.isArray(current)) {
        if (!ARRAY_INDEX_SEGMENT.test(segment)) return;
        current[Number(segment)] = value;
      } else {
        current[segment] = value;
      }
      return;
    }

    const nextSegment = segments[index + 1];
    const nextIsArray = Boolean(
      nextSegment && ARRAY_INDEX_SEGMENT.test(nextSegment)
    );
    if (Array.isArray(current) && !ARRAY_INDEX_SEGMENT.test(segment)) return;
    const nextValue: unknown = Array.isArray(current)
      ? current[Number(segment)]
      : current[segment];
    if (!Array.isArray(nextValue) && !isPlainRecord(nextValue)) {
      const container: RequestPayload | unknown[] = nextIsArray ? [] : {};
      if (Array.isArray(current)) {
        if (!ARRAY_INDEX_SEGMENT.test(segment)) return;
        current[Number(segment)] = container;
      } else {
        current[segment] = container;
      }
      current = container;
    } else {
      current = nextValue;
    }
  }
}

/**
 * 从对象或数组删除一个自有字段。
 *
 * @param payload - 将被修改的请求载荷副本。
 * @param path - 已校验的来源路径。
 * @returns 成功删除时返回 true，路径不存在时不影响请求。
 */
function deletePathValue(payload: RequestPayload, path: string): boolean {
  const segments = splitPath(path);
  const lastSegment = segments.pop();
  if (!lastSegment) return false;
  let current: unknown = payload;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!ARRAY_INDEX_SEGMENT.test(segment)) return false;
      current = current[Number(segment)];
      continue;
    }
    if (!isPlainRecord(current) || !Object.hasOwn(current, segment)) {
      return false;
    }
    current = current[segment];
  }
  if (Array.isArray(current)) {
    if (!ARRAY_INDEX_SEGMENT.test(lastSegment)) return false;
    const index = Number(lastSegment);
    if (!(index in current)) return false;
    delete current[index];
    return true;
  }
  if (!isPlainRecord(current) || !Object.hasOwn(current, lastSegment)) {
    return false;
  }
  delete current[lastSegment];
  return true;
}

/**
 * 清洗来自数据库的映射配置。
 *
 * @param value - 数据库 JSON 或其他不可信输入。
 * @returns 仅包含完整、无冲突且安全映射的数组；非法配置退化为空数组。
 */
export function normalizeRequestParameterMappings(
  value: unknown
): RequestParameterMapping[] {
  const parsed = requestParameterMappingsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * 以配置规则变换即将发送的上游请求载荷。
 *
 * 来源值一律从原始快照读取，因此多条映射可以共享同一来源。`move` 会在写入所有
 * 目标前删除来源字段，既支持 `model → model_id`，也避免移动时覆盖另一个目标值。
 * 找不到来源字段时跳过该条规则，不会向上游发送 `undefined`。
 *
 * @param payload - 标准化完成、尚未发送的请求对象。
 * @param mappings - 管理端保存的映射规则或不可信数据库 JSON。
 * @returns 独立的请求对象副本；不会修改调用方传入的 payload。
 */
export function applyRequestParameterMappings(
  payload: RequestPayload,
  mappings: unknown
): RequestPayload {
  const normalizedMappings = normalizeRequestParameterMappings(mappings);
  const snapshot = cloneRequestValue(payload) as RequestPayload;
  const result = cloneRequestValue(payload) as RequestPayload;
  const resolvedMappings = normalizedMappings.flatMap((mapping) => {
    const source = getPathValue(snapshot, mapping.source);
    return source.found
      ? [{ ...mapping, value: cloneRequestValue(source.value) }]
      : [];
  });

  for (const mapping of resolvedMappings) {
    if (mapping.mode === "move" && mapping.source !== mapping.target) {
      deletePathValue(result, mapping.source);
    }
  }
  for (const mapping of resolvedMappings) {
    setPathValue(result, mapping.target, mapping.value);
  }
  return result;
}
