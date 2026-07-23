/**
 * API 密钥摘要列表的纯交互状态。
 *
 * 设置页组件使用这些 reducer 与查询函数管理行展开、按行操作锁、服务端
 * 返回值归并和删除后焦点恢复；本文件不依赖 React、DOM 或数据库。
 */

/** 列表状态可接收的最小 API 密钥摘要形状。 */
export type ExternalApiKeyListItem = {
  readonly id: string;
};

/** 会锁定单个摘要行的 API 密钥操作。 */
export type ExternalApiKeyRowMutation =
  | "update-group"
  | "update-quota"
  | "revoke"
  | "delete";

/** 单行最近一次失败的可展示信息。 */
export type ExternalApiKeyRowError = {
  readonly operation: ExternalApiKeyRowMutation;
  readonly message: string;
};

/** API 密钥摘要列表的全部纯状态。 */
export type ExternalApiKeyListState<TItem extends ExternalApiKeyListItem> = {
  readonly items: readonly TItem[];
  readonly expandedKeyIds: readonly string[];
  readonly pendingByKeyId: Readonly<Record<string, ExternalApiKeyRowMutation>>;
  readonly errorsByKeyId: Readonly<Record<string, ExternalApiKeyRowError>>;
};

type NonDeleteExternalApiKeyRowMutation = Exclude<
  ExternalApiKeyRowMutation,
  "delete"
>;

/** reducer 支持的展开和行操作事件。 */
export type ExternalApiKeyListAction<TItem extends ExternalApiKeyListItem> =
  | {
      readonly type: "toggle-expanded";
      readonly keyId: string;
    }
  | {
      readonly type: "mutation-started";
      readonly keyId: string;
      readonly operation: ExternalApiKeyRowMutation;
    }
  | {
      readonly type: "mutation-succeeded";
      readonly keyId: string;
      readonly operation: NonDeleteExternalApiKeyRowMutation;
      readonly item: TItem;
    }
  | {
      readonly type: "mutation-succeeded";
      readonly keyId: string;
      readonly operation: "delete";
    }
  | {
      readonly type: "mutation-failed";
      readonly keyId: string;
      readonly operation: ExternalApiKeyRowMutation;
      readonly error: string;
      readonly refreshedItem?: TItem;
    };

/** 删除成功后组件应恢复到的焦点位置。 */
export type ExternalApiKeyDeleteFocusTarget =
  | {
      readonly type: "row";
      readonly keyId: string;
    }
  | {
      readonly type: "create";
    };

/** 同步协调完整列表加载与 mutation 的可变活动状态。 */
export type ExternalApiKeyActivityState = {
  fullListLoadGeneration: number;
  activeFullListLoadGeneration: number | null;
  mutationRevision: number;
  activeMutationCount: number;
};

/** 单次完整列表加载携带的响应有效性快照。 */
export type ExternalApiKeyFullListLoadToken = {
  readonly generation: number;
  readonly mutationRevision: number;
};

/** 可接受程序化焦点恢复的最小目标。 */
export type ExternalApiKeyFocusable = {
  readonly focus: () => void;
};

/**
 * 创建组件级活动协调器。
 *
 * @returns 尚无加载或 mutation，世代与 revision 均从零开始的可变状态。
 */
export function createExternalApiKeyActivityState(): ExternalApiKeyActivityState {
  return {
    fullListLoadGeneration: 0,
    activeFullListLoadGeneration: null,
    mutationRevision: 0,
    activeMutationCount: 0,
  };
}

/**
 * 尝试同步取得完整列表加载权。
 *
 * 完整列表响应会重建所有行，因此任何 mutation 存在时都拒绝开始；世代和
 * mutation revision 会随令牌返回，用于阻止过期响应覆盖后续状态。
 *
 * @param activity 组件 ref 持有的可变活动状态。
 * @returns 成功时返回响应令牌；已有加载或 mutation 时返回 null。
 * @sideEffect 成功时递增加载世代并标记该世代为活动加载。
 */
export function tryStartExternalApiKeyFullListLoad(
  activity: ExternalApiKeyActivityState
): ExternalApiKeyFullListLoadToken | null {
  if (
    activity.activeFullListLoadGeneration !== null ||
    activity.activeMutationCount > 0
  ) {
    return null;
  }

  activity.fullListLoadGeneration += 1;
  activity.activeFullListLoadGeneration = activity.fullListLoadGeneration;
  return {
    generation: activity.fullListLoadGeneration,
    mutationRevision: activity.mutationRevision,
  };
}

/**
 * 判断完整列表响应是否仍可安全重建客户端状态。
 *
 * @param activity 当前活动状态。
 * @param token 请求开始时取得的世代与 mutation revision。
 * @returns 仅当前活动请求且其后没有 mutation 时返回 true。
 */
export function canApplyExternalApiKeyFullListLoad(
  activity: ExternalApiKeyActivityState,
  token: ExternalApiKeyFullListLoadToken
): boolean {
  return (
    activity.activeFullListLoadGeneration === token.generation &&
    activity.mutationRevision === token.mutationRevision &&
    activity.activeMutationCount === 0
  );
}

/**
 * 结束指定完整列表加载。
 *
 * @param activity 当前活动状态。
 * @param token 待释放的加载令牌。
 * @sideEffect 仅令牌仍对应当前活动世代时清除加载标记；过期令牌无效。
 */
export function finishExternalApiKeyFullListLoad(
  activity: ExternalApiKeyActivityState,
  token: ExternalApiKeyFullListLoadToken
): void {
  if (activity.activeFullListLoadGeneration === token.generation) {
    activity.activeFullListLoadGeneration = null;
  }
}

/**
 * 尝试同步登记一次创建或行 mutation。
 *
 * @param activity 当前活动状态。
 * @returns 完整列表加载中返回 false；否则登记成功并返回 true。
 * @sideEffect 成功时递增 mutation revision 与活动 mutation 计数。
 */
export function tryStartExternalApiKeyMutation(
  activity: ExternalApiKeyActivityState
): boolean {
  if (activity.activeFullListLoadGeneration !== null) return false;
  activity.mutationRevision += 1;
  activity.activeMutationCount += 1;
  return true;
}

/**
 * 结束一次已登记的创建或行 mutation。
 *
 * @param activity 当前活动状态。
 * @sideEffect 活动计数大于零时减一；重复释放不会产生负数。
 */
export function finishExternalApiKeyMutation(
  activity: ExternalApiKeyActivityState
): void {
  if (activity.activeMutationCount > 0) {
    activity.activeMutationCount -= 1;
  }
}

/**
 * 创建列表初始状态。
 *
 * @param items 首次加载完成的 API 密钥摘要，顺序即页面展示顺序。
 * @returns 不共享可变数组、尚无展开行或行操作的列表状态。
 */
export function createExternalApiKeyListState<
  TItem extends ExternalApiKeyListItem,
>(items: readonly TItem[]): ExternalApiKeyListState<TItem> {
  return {
    items: [...items],
    expandedKeyIds: [],
    pendingByKeyId: {},
    errorsByKeyId: {},
  };
}

/**
 * 判断指定行是否正执行 mutation。
 *
 * @param state 当前列表状态。
 * @param keyId 待查询的密钥 ID。
 * @returns 仅当该行存在未完成操作时返回 true；其他行不会被连带锁定。
 */
export function isExternalApiKeyRowLocked<TItem extends ExternalApiKeyListItem>(
  state: ExternalApiKeyListState<TItem>,
  keyId: string
): boolean {
  return state.pendingByKeyId[keyId] !== undefined;
}

/**
 * 归并一次列表交互或服务端 operation 结果。
 *
 * 成功结果只替换对应行；失败结果可带回重新读取的真实行，并保留行级错误。
 * 同一行已有操作时拒绝开始第二个操作，避免响应乱序覆盖较新的状态。
 *
 * @param state 当前列表状态。
 * @param action 展开、操作开始或操作完成事件。
 * @returns 新状态；未知行、重复开始或过期完成事件返回原状态。
 */
export function reduceExternalApiKeyListState<
  TItem extends ExternalApiKeyListItem,
>(
  state: ExternalApiKeyListState<TItem>,
  action: ExternalApiKeyListAction<TItem>
): ExternalApiKeyListState<TItem> {
  if (!hasItem(state.items, action.keyId)) {
    return state;
  }

  if (action.type === "toggle-expanded") {
    const isExpanded = state.expandedKeyIds.includes(action.keyId);
    return {
      ...state,
      expandedKeyIds: isExpanded
        ? state.expandedKeyIds.filter((keyId) => keyId !== action.keyId)
        : [...state.expandedKeyIds, action.keyId],
    };
  }

  if (action.type === "mutation-started") {
    if (isExternalApiKeyRowLocked(state, action.keyId)) {
      return state;
    }
    return {
      ...state,
      pendingByKeyId: {
        ...state.pendingByKeyId,
        [action.keyId]: action.operation,
      },
      errorsByKeyId: omitRecordKey(state.errorsByKeyId, action.keyId),
    };
  }

  if (state.pendingByKeyId[action.keyId] !== action.operation) {
    return state;
  }

  if (action.type === "mutation-succeeded") {
    if (action.operation === "delete") {
      return {
        items: state.items.filter((item) => item.id !== action.keyId),
        expandedKeyIds: state.expandedKeyIds.filter(
          (keyId) => keyId !== action.keyId
        ),
        pendingByKeyId: omitRecordKey(state.pendingByKeyId, action.keyId),
        errorsByKeyId: omitRecordKey(state.errorsByKeyId, action.keyId),
      };
    }

    if (action.item.id !== action.keyId) {
      return state;
    }

    return {
      ...state,
      items: replaceItem(state.items, action.item),
      pendingByKeyId: omitRecordKey(state.pendingByKeyId, action.keyId),
      errorsByKeyId: omitRecordKey(state.errorsByKeyId, action.keyId),
    };
  }

  const refreshedItems =
    action.refreshedItem?.id === action.keyId
      ? replaceItem(state.items, action.refreshedItem)
      : state.items;
  return {
    ...state,
    items: refreshedItems,
    pendingByKeyId: omitRecordKey(state.pendingByKeyId, action.keyId),
    errorsByKeyId: {
      ...state.errorsByKeyId,
      [action.keyId]: {
        operation: action.operation,
        message: action.error,
      },
    },
  };
}

/**
 * 根据删除前的展示顺序选择删除后的焦点目标。
 *
 * @param items 删除发生前的有序摘要列表。
 * @param deletedKeyId 已成功删除的密钥 ID。
 * @returns 优先下一行，其次上一行；无相邻行或 ID 已失效时返回创建区。
 */
export function getExternalApiKeyDeleteFocusTarget<
  TItem extends ExternalApiKeyListItem,
>(
  items: readonly TItem[],
  deletedKeyId: string
): ExternalApiKeyDeleteFocusTarget {
  const deletedIndex = items.findIndex((item) => item.id === deletedKeyId);
  if (deletedIndex < 0) {
    return { type: "create" };
  }

  const nextItem = items[deletedIndex + 1];
  if (nextItem) {
    return { type: "row", keyId: nextItem.id };
  }

  const previousItem = items[deletedIndex - 1];
  if (previousItem) {
    return { type: "row", keyId: previousItem.id };
  }

  return { type: "create" };
}

/**
 * 恢复删除后的键盘焦点，并处理并发删除卸载预选行的情况。
 *
 * @param target 删除前根据列表顺序选出的目标。
 * @param rowTargets 当前仍挂载的行触发器。
 * @param createTarget 创建区焦点目标；页面卸载时可以为 null。
 * @sideEffect 聚焦仍存在的目标行；目标行已卸载时回退聚焦创建区。
 */
export function restoreExternalApiKeyDeleteFocus(
  target: ExternalApiKeyDeleteFocusTarget,
  rowTargets: ReadonlyMap<string, ExternalApiKeyFocusable>,
  createTarget: ExternalApiKeyFocusable | null
): void {
  if (target.type === "row") {
    const rowTarget = rowTargets.get(target.keyId);
    if (rowTarget) {
      rowTarget.focus();
      return;
    }
  }
  createTarget?.focus();
}

/** 判断有序摘要中是否存在目标密钥。 */
function hasItem<TItem extends ExternalApiKeyListItem>(
  items: readonly TItem[],
  keyId: string
): boolean {
  return items.some((item) => item.id === keyId);
}

/** 用 operation 返回的真实摘要替换对应行，并保持原有顺序。 */
function replaceItem<TItem extends ExternalApiKeyListItem>(
  items: readonly TItem[],
  replacement: TItem
): readonly TItem[] {
  return items.map((item) => (item.id === replacement.id ? replacement : item));
}

/** 从只读字典移除单个行状态，不修改调用方传入对象。 */
function omitRecordKey<TValue>(
  record: Readonly<Record<string, TValue>>,
  keyToOmit: string
): Readonly<Record<string, TValue>> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== keyToOmit)
  );
}
