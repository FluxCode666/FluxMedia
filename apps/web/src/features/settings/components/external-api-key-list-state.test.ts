/**
 * API 密钥摘要列表纯状态测试。
 *
 * 覆盖独立展开、按行操作锁、操作结果归并，以及删除后的键盘焦点目标，
 * 保证这些交互规则不依赖 React 或数据库即可验证。
 */
import { describe, expect, it, vi } from "vitest";

import {
  canApplyExternalApiKeyFullListLoad,
  createExternalApiKeyActivityState,
  createExternalApiKeyListState,
  finishExternalApiKeyFullListLoad,
  finishExternalApiKeyMutation,
  getExternalApiKeyDeleteFocusTarget,
  isExternalApiKeyRowLocked,
  reduceExternalApiKeyListState,
  restoreExternalApiKeyDeleteFocus,
  tryStartExternalApiKeyFullListLoad,
  tryStartExternalApiKeyMutation,
} from "./external-api-key-list-state";

type TestKey = {
  id: string;
  name: string;
  isActive: boolean;
  creditLimit: number | null;
};

const keys: readonly [TestKey, TestKey, TestKey] = [
  { id: "key-a", name: "A", isActive: true, creditLimit: 100 },
  { id: "key-b", name: "B", isActive: true, creditLimit: 200 },
  { id: "key-c", name: "C", isActive: false, creditLimit: null },
];

type Deferred<TValue> = {
  readonly promise: Promise<TValue>;
  readonly resolve: (value: TValue) => void;
};

/** 创建可由测试显式决定完成顺序的 Promise。 */
function createDeferred<TValue>(): Deferred<TValue> {
  let resolvePromise: (value: TValue) => void = () => {
    throw new Error("Deferred Promise 尚未初始化");
  };
  const promise = new Promise<TValue>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe("API 密钥列表状态", () => {
  it("允许多行独立展开，并仅切换目标行", () => {
    const initialState = createExternalApiKeyListState(keys);
    const withFirstExpanded = reduceExternalApiKeyListState(initialState, {
      type: "toggle-expanded",
      keyId: "key-a",
    });
    const withTwoExpanded = reduceExternalApiKeyListState(withFirstExpanded, {
      type: "toggle-expanded",
      keyId: "key-b",
    });

    expect(withTwoExpanded.expandedKeyIds).toEqual(["key-a", "key-b"]);

    const withFirstCollapsed = reduceExternalApiKeyListState(withTwoExpanded, {
      type: "toggle-expanded",
      keyId: "key-a",
    });

    expect(withFirstCollapsed.expandedKeyIds).toEqual(["key-b"]);
    expect(withFirstCollapsed.items).toEqual(keys);
  });

  it("操作期间仅锁定对应行，并允许其他行独立操作", () => {
    const initialState = createExternalApiKeyListState(keys);
    const withFirstPending = reduceExternalApiKeyListState(initialState, {
      type: "mutation-started",
      keyId: "key-a",
      operation: "update-quota",
    });

    expect(isExternalApiKeyRowLocked(withFirstPending, "key-a")).toBe(true);
    expect(isExternalApiKeyRowLocked(withFirstPending, "key-b")).toBe(false);

    const withTwoPending = reduceExternalApiKeyListState(withFirstPending, {
      type: "mutation-started",
      keyId: "key-b",
      operation: "revoke",
    });

    expect(withTwoPending.pendingByKeyId).toEqual({
      "key-a": "update-quota",
      "key-b": "revoke",
    });

    const ignoredSecondOperation = reduceExternalApiKeyListState(
      withTwoPending,
      {
        type: "mutation-started",
        keyId: "key-a",
        operation: "delete",
      }
    );

    expect(ignoredSecondOperation).toBe(withTwoPending);
  });

  it("成功时只合并 operation 返回行并清理该行状态", () => {
    const withPending = reduceExternalApiKeyListState(
      createExternalApiKeyListState(keys),
      {
        type: "mutation-started",
        keyId: "key-a",
        operation: "update-quota",
      }
    );
    const returnedKey: TestKey = {
      ...keys[0],
      creditLimit: 350,
    };

    const succeeded = reduceExternalApiKeyListState(withPending, {
      type: "mutation-succeeded",
      keyId: "key-a",
      operation: "update-quota",
      item: returnedKey,
    });

    expect(succeeded.items).toEqual([returnedKey, keys[1], keys[2]]);
    expect(succeeded.pendingByKeyId).toEqual({});
    expect(succeeded.errorsByKeyId).toEqual({});
  });

  it("失败时用刷新后的真实行归并，保留行错误且不影响其他行", () => {
    const withFirstPending = reduceExternalApiKeyListState(
      createExternalApiKeyListState(keys),
      {
        type: "mutation-started",
        keyId: "key-a",
        operation: "revoke",
      }
    );
    const withTwoPending = reduceExternalApiKeyListState(withFirstPending, {
      type: "mutation-started",
      keyId: "key-b",
      operation: "delete",
    });
    const refreshedKey: TestKey = {
      ...keys[0],
      isActive: false,
    };

    const failed = reduceExternalApiKeyListState(withTwoPending, {
      type: "mutation-failed",
      keyId: "key-a",
      operation: "revoke",
      error: "密钥已被其他请求撤销",
      refreshedItem: refreshedKey,
    });

    expect(failed.items).toEqual([refreshedKey, keys[1], keys[2]]);
    expect(failed.pendingByKeyId).toEqual({ "key-b": "delete" });
    expect(failed.errorsByKeyId).toEqual({
      "key-a": {
        operation: "revoke",
        message: "密钥已被其他请求撤销",
      },
    });
    expect(isExternalApiKeyRowLocked(failed, "key-a")).toBe(false);
    expect(isExternalApiKeyRowLocked(failed, "key-b")).toBe(true);
  });

  it("删除成功时移除行并清理展开、待处理和错误状态", () => {
    const initialState = createExternalApiKeyListState(keys);
    const expanded = reduceExternalApiKeyListState(initialState, {
      type: "toggle-expanded",
      keyId: "key-c",
    });
    const pending = reduceExternalApiKeyListState(expanded, {
      type: "mutation-started",
      keyId: "key-c",
      operation: "delete",
    });

    const deleted = reduceExternalApiKeyListState(pending, {
      type: "mutation-succeeded",
      keyId: "key-c",
      operation: "delete",
    });

    expect(deleted.items).toEqual([keys[0], keys[1]]);
    expect(deleted.expandedKeyIds).toEqual([]);
    expect(deleted.pendingByKeyId).toEqual({});
    expect(deleted.errorsByKeyId).toEqual({});
  });
});

describe("完整列表加载与 mutation 协调", () => {
  it("刷新先开始时拒绝 mutation，并允许当前刷新响应落状态", async () => {
    const activity = createExternalApiKeyActivityState();
    const refreshResponse = createDeferred<readonly TestKey[]>();
    const refreshToken = tryStartExternalApiKeyFullListLoad(activity);
    if (!refreshToken) {
      throw new Error("首次刷新应成功取得活动令牌");
    }
    const appliedResponse = refreshResponse.promise.then((items) => ({
      items,
      canApply: canApplyExternalApiKeyFullListLoad(activity, refreshToken),
    }));

    expect(tryStartExternalApiKeyMutation(activity)).toBe(false);
    refreshResponse.resolve(keys);

    await expect(appliedResponse).resolves.toEqual({
      items: keys,
      canApply: true,
    });
    finishExternalApiKeyFullListLoad(activity, refreshToken);
  });

  it("mutation 先开始时拒绝刷新，mutation 返回后才允许新刷新", async () => {
    const activity = createExternalApiKeyActivityState();
    const mutationResponse = createDeferred<TestKey>();
    expect(tryStartExternalApiKeyMutation(activity)).toBe(true);
    const completedMutation = mutationResponse.promise.then((item) => {
      finishExternalApiKeyMutation(activity);
      return item;
    });

    expect(tryStartExternalApiKeyFullListLoad(activity)).toBeNull();
    mutationResponse.resolve(keys[0]);
    await expect(completedMutation).resolves.toEqual(keys[0]);

    const refreshToken = tryStartExternalApiKeyFullListLoad(activity);
    expect(refreshToken).not.toBeNull();
    if (refreshToken) {
      expect(canApplyExternalApiKeyFullListLoad(activity, refreshToken)).toBe(
        true
      );
      finishExternalApiKeyFullListLoad(activity, refreshToken);
    }
  });

  it("拒绝已被后续 mutation revision 淘汰的刷新响应", async () => {
    const activity = createExternalApiKeyActivityState();
    const staleRefreshResponse = createDeferred<readonly TestKey[]>();
    const staleToken = tryStartExternalApiKeyFullListLoad(activity);
    if (!staleToken) {
      throw new Error("首次刷新应成功取得活动令牌");
    }
    finishExternalApiKeyFullListLoad(activity, staleToken);
    expect(tryStartExternalApiKeyMutation(activity)).toBe(true);
    finishExternalApiKeyMutation(activity);

    const appliedResponse = staleRefreshResponse.promise.then(() =>
      canApplyExternalApiKeyFullListLoad(activity, staleToken)
    );
    staleRefreshResponse.resolve(keys);

    await expect(appliedResponse).resolves.toBe(false);
  });
});

describe("删除后的焦点目标", () => {
  it("删除首行或中间行后聚焦下一行", () => {
    expect(getExternalApiKeyDeleteFocusTarget(keys, "key-a")).toEqual({
      type: "row",
      keyId: "key-b",
    });
    expect(getExternalApiKeyDeleteFocusTarget(keys, "key-b")).toEqual({
      type: "row",
      keyId: "key-c",
    });
  });

  it("删除末行后聚焦上一行", () => {
    expect(getExternalApiKeyDeleteFocusTarget(keys, "key-c")).toEqual({
      type: "row",
      keyId: "key-b",
    });
  });

  it("删除唯一一行后聚焦创建区", () => {
    expect(getExternalApiKeyDeleteFocusTarget([keys[0]], "key-a")).toEqual({
      type: "create",
    });
  });

  it("并发删除卸载预选相邻行后回退聚焦创建区", () => {
    const focusTarget = getExternalApiKeyDeleteFocusTarget(keys, "key-a");
    const focusCreate = vi.fn();
    const rowTargets = new Map<string, { focus: () => void }>([
      ["key-b", { focus: vi.fn() }],
    ]);
    rowTargets.delete("key-b");

    restoreExternalApiKeyDeleteFocus(focusTarget, rowTargets, {
      focus: focusCreate,
    });

    expect(focusCreate).toHaveBeenCalledOnce();
  });
});
