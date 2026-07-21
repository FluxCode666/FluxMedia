/**
 * Dashboard 客户端错误文案映射的 DB-free 回归测试。
 *
 * 确保数据库超时在中英文界面都显示用户提示，而非服务端代码或 SQL 细节。
 */
import {
  DATABASE_QUERY_TIMEOUT_MESSAGE,
  DATABASE_QUERY_UNAVAILABLE_MESSAGE,
} from "@repo/shared/database-error-messages";
import { describe, expect, it } from "vitest";

import { getDashboardActionErrorMessage } from "./dashboard-error-message";

describe("dashboard action error messages", () => {
  it("localizes database timeout errors", () => {
    expect(
      getDashboardActionErrorMessage(
        DATABASE_QUERY_TIMEOUT_MESSAGE,
        true,
        "fallback"
      )
    ).toBe("数据查询超时，请稍后重试");
    expect(
      getDashboardActionErrorMessage(
        DATABASE_QUERY_TIMEOUT_MESSAGE,
        false,
        "fallback"
      )
    ).toBe("Data query timed out. Please try again.");
  });

  it("localizes temporarily unavailable errors", () => {
    expect(
      getDashboardActionErrorMessage(
        DATABASE_QUERY_UNAVAILABLE_MESSAGE,
        true,
        "fallback"
      )
    ).toBe("数据暂时不可用，请稍后重试");
    expect(
      getDashboardActionErrorMessage(
        DATABASE_QUERY_UNAVAILABLE_MESSAGE,
        false,
        "fallback"
      )
    ).toBe("Data is temporarily unavailable. Please try again.");
  });

  it("does not expose unknown server error strings", () => {
    expect(
      getDashboardActionErrorMessage(
        'Failed query: select "secret"; params: private-user-id',
        true,
        "fallback"
      )
    ).toBe("fallback");
    expect(
      getDashboardActionErrorMessage("未知内部错误", true, "fallback")
    ).toBe("fallback");
    expect(
      getDashboardActionErrorMessage({ code: 500 }, true, "fallback")
    ).toBe("fallback");
  });
});
