/**
 * CodeBlock 复制反馈的组件级竞态测试。
 *
 * 通过 React DOM 挂载共享 UI 组件，并用可控 Clipboard Promise 验证逆序完成与卸载
 * 边界；测试不访问数据库或真实系统剪贴板。
 */
// @vitest-environment jsdom

import { CodeBlock } from "@repo/ui/components/code-block";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Deferred = {
  promise: Promise<void>;
  reject: (reason: unknown) => void;
  resolve: () => void;
};

type MountedCodeBlock = {
  button: HTMLButtonElement;
  container: HTMLDivElement;
  root: Root;
};

const mountedCodeBlocks: MountedCodeBlock[] = [];

/**
 * 创建由测试显式完成的 Promise。
 *
 * @returns Promise 及其 resolve、reject 控制器。
 * @sideEffects 无；控制器仅改变返回 Promise 的完成状态。
 * @failure 初始化器未同步设置控制器时抛错，表示测试运行时行为异常。
 */
function createDeferred(): Deferred {
  let rejectPromise: ((reason: unknown) => void) | null = null;
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  return {
    promise,
    reject(reason) {
      if (!rejectPromise) {
        throw new Error("Deferred reject controller is unavailable");
      }
      rejectPromise(reason);
    },
    resolve() {
      if (!resolvePromise) {
        throw new Error("Deferred resolve controller is unavailable");
      }
      resolvePromise();
    },
  };
}

/**
 * 安装可控的测试 Clipboard API。
 *
 * @param writeText - 代替浏览器剪贴板写入的异步函数。
 * @returns 无。
 * @sideEffects 覆盖当前 jsdom navigator.clipboard，测试结束时由环境销毁。
 * @failure 属性不可配置时由 Object.defineProperty 抛错并使测试失败。
 */
function installClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

/**
 * 在 React 19 Strict Mode 中挂载 CodeBlock。
 *
 * @returns 根节点、容器和可点击的复制按钮。
 * @sideEffects 向 document.body 添加一个容器并执行组件 effect。
 * @failure 组件未渲染复制按钮时抛错，避免测试在错误 DOM 上继续。
 */
function mountCodeBlock(): MountedCodeBlock {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(CodeBlock, {
          code: "const answer = 42;",
          labels: {
            copy: "复制",
            copied: "已复制",
            copyFailed: "复制失败",
          },
        })
      )
    );
  });

  const button = container.querySelector<HTMLButtonElement>("button");
  if (!button) {
    root.unmount();
    container.remove();
    throw new Error("CodeBlock copy button was not rendered");
  }

  const mounted = { button, container, root };
  mountedCodeBlocks.push(mounted);
  return mounted;
}

/**
 * 卸载一个测试 CodeBlock 并移除容器。
 *
 * @param mounted - mountCodeBlock 返回的挂载句柄。
 * @returns 无。
 * @sideEffects 执行组件 cleanup，并从 document.body 移除容器。
 * @failure React cleanup 抛错时直接使测试失败。
 */
function unmountCodeBlock(mounted: MountedCodeBlock): void {
  if (!mounted.container.isConnected) {
    return;
  }

  act(() => mounted.root.unmount());
  mounted.container.remove();
}

/**
 * 触发复制按钮的真实 DOM click 事件。
 *
 * @param button - CodeBlock 的复制按钮。
 * @returns 无。
 * @sideEffects 启动一次 Clipboard Promise 和组件反馈流程。
 * @failure 事件处理器抛出同步异常时由 React 测试环境报告失败。
 */
function clickCopy(button: HTMLButtonElement): void {
  act(() => button.click());
}

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
});

afterEach(() => {
  for (const mounted of mountedCodeBlocks.splice(0)) {
    unmountCodeBlock(mounted);
  }
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  vi.restoreAllMocks();
});

describe("CodeBlock clipboard lifecycle", () => {
  it("忽略晚于最新请求完成的旧复制结果", async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    const requests = [firstRequest, secondRequest];
    const writeText = vi.fn((_text: string) => {
      const request = requests.shift();
      if (!request) {
        return Promise.reject(new Error("Unexpected clipboard request"));
      }
      return request.promise;
    });
    installClipboard(writeText);
    const mounted = mountCodeBlock();

    clickCopy(mounted.button);
    clickCopy(mounted.button);
    expect(writeText).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondRequest.resolve();
      await secondRequest.promise;
    });
    expect(mounted.button.getAttribute("aria-label")).toBe("已复制");
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      firstRequest.reject(new Error("Older clipboard request failed"));
      await firstRequest.promise.catch(() => undefined);
    });
    expect(mounted.button.getAttribute("aria-label")).toBe("已复制");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("卸载后忽略 pending 请求且不创建反馈计时器", async () => {
    const request = createDeferred();
    const writeText = vi.fn((_text: string) => request.promise);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    installClipboard(writeText);
    const mounted = mountCodeBlock();

    clickCopy(mounted.button);
    expect(writeText).toHaveBeenCalledTimes(1);
    unmountCodeBlock(mounted);

    await act(async () => {
      request.resolve();
      await request.promise;
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("已排队的旧回调不会抹掉新反馈计时器句柄", async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    const requests = [firstRequest, secondRequest];
    const writeText = vi.fn((_text: string) => {
      const request = requests.shift();
      if (!request) {
        return Promise.reject(new Error("Unexpected clipboard request"));
      }
      return request.promise;
    });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    installClipboard(writeText);
    const mounted = mountCodeBlock();

    clickCopy(mounted.button);
    await act(async () => {
      firstRequest.resolve();
      await firstRequest.promise;
    });
    const oldTimerCallback = setTimeoutSpy.mock.calls[0]?.[0];
    const oldTimer = setTimeoutSpy.mock.results[0]?.value;
    expect(typeof oldTimerCallback).toBe("function");
    expect(oldTimer).toBeDefined();

    clickCopy(mounted.button);
    expect(clearTimeoutSpy).toHaveBeenLastCalledWith(oldTimer);
    await act(async () => {
      secondRequest.resolve();
      await secondRequest.promise;
    });
    const newTimer = setTimeoutSpy.mock.results[1]?.value;
    expect(newTimer).toBeDefined();

    act(() => {
      if (typeof oldTimerCallback === "function") {
        oldTimerCallback();
      }
    });
    unmountCodeBlock(mounted);

    expect(clearTimeoutSpy).toHaveBeenLastCalledWith(newTimer);
    expect(vi.getTimerCount()).toBe(0);
  });
});
