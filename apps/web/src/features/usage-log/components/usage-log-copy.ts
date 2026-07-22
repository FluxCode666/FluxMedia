/**
 * 使用日志页面的中英文文案契约。
 *
 * 使用方：usage-log 服务端页面按 locale 选择文案，再通过 props 传给客户端组件；
 * 本期不新增 messages key，避免与导航迁移并行修改翻译文件。
 */

import type {
  UsageBusinessType,
  UsageFailureCode,
  UsageLogRange,
  UsageSourceChannel,
  UsageStatus,
} from "@repo/shared/credits/usage-log-contract";

/** 页面全部可见文案，枚举映射必须覆盖共享机器契约。 */
export type UsageLogCopy = {
  businessTypes: Record<UsageBusinessType, string>;
  description: string;
  detail: {
    actualUsage: string;
    completedAt: string;
    createdAt: string;
    failure: string;
    fields: {
      grossConsumed: string;
      modelOrEndpoint: string;
      netConsumed: string;
      originalRequest: string;
      refundId: string;
      refunded: string;
      requestId: string;
      source: string;
      status: string;
    };
    hide: string;
    images: string;
    loadError: string;
    loading: string;
    retry: string;
    seconds: string;
    show: string;
  };
  empty: {
    filteredDescription: string;
    filteredTitle: string;
    firstDescription: string;
    firstTitle: string;
  };
  failureCodes: Record<UsageFailureCode, string>;
  filters: {
    allStatuses: string;
    allTypes: string;
    apply: string;
    businessType: string;
    range: string;
    status: string;
  };
  pagination: {
    back: string;
    next: string;
  };
  pricing: {
    description: string;
    error: string;
    hide: string;
    retry: string;
    show: string;
    title: string;
  };
  queryError: {
    description: string;
    retry: string;
    title: string;
  };
  ranges: Record<UsageLogRange, string>;
  resultAnnouncement: string;
  sourceChannels: Record<UsageSourceChannel, string>;
  statuses: Record<UsageStatus, string>;
  table: {
    businessType: string;
    credits: string;
    refundDirection: string;
    source: string;
    spendDirection: string;
    status: string;
    summary: string;
    time: string;
    title: string;
  };
  title: string;
  unknownTime: string;
  waiting: {
    description: string;
    retry: string;
    title: string;
  };
};

/**
 * 按当前 locale 创建完整页面文案。
 *
 * @param isZh 是否使用简体中文。
 * @returns 可序列化、可传给 Client Component 的文案对象。
 * @sideEffects 无。
 */
export function createUsageLogCopy(isZh: boolean): UsageLogCopy {
  const copy = (en: string, zh: string) => (isZh ? zh : en);
  return {
    businessTypes: {
      historical: copy("Historical", "历史记录"),
      image: copy("Image", "生图"),
      refund: copy("Refund", "退款"),
      video: copy("Video", "生视频"),
    },
    description: copy(
      "Review request activity, credit changes, and safe failure details.",
      "核对业务请求、积分变化和安全的失败说明。"
    ),
    detail: {
      actualUsage: copy("Actual usage", "实际用量"),
      completedAt: copy("Completed", "完成时间"),
      createdAt: copy("Created", "创建时间"),
      failure: copy("Failure reason", "失败原因"),
      fields: {
        grossConsumed: copy("Gross consumed", "原始消耗"),
        modelOrEndpoint: copy("Model or endpoint", "模型或接口"),
        netConsumed: copy("Net consumed", "净消耗"),
        originalRequest: copy("Original request", "原请求"),
        refundId: copy("Refund ID", "退款 ID"),
        refunded: copy("Refunded", "已退款"),
        requestId: copy("Request ID", "请求 ID"),
        source: copy("Source", "来源"),
        status: copy("Status", "状态"),
      },
      hide: copy("Collapse details", "收起详情"),
      images: copy("images", "张图片"),
      loadError: copy(
        "Details could not be loaded. The list is unchanged.",
        "详情加载失败，列表内容未受影响。"
      ),
      loading: copy("Loading details", "正在加载详情"),
      retry: copy("Retry details", "重试详情"),
      seconds: copy("seconds", "秒"),
      show: copy("Expand details", "展开详情"),
    },
    empty: {
      filteredDescription: copy(
        "Try another time range, business type, or status.",
        "可以尝试调整时间范围、业务类型或状态。"
      ),
      filteredTitle: copy("No matching activity", "没有符合筛选条件的记录"),
      firstDescription: copy(
        "Image and video requests will appear here after activity begins.",
        "开始生图或生视频后，相关记录会显示在这里。"
      ),
      firstTitle: copy("No usage activity yet", "暂无使用记录"),
    },
    failureCodes: {
      moderation_blocked: copy(
        "The request did not pass content review.",
        "请求未通过内容审核。"
      ),
      processing_failed: copy(
        "The request could not be completed.",
        "请求未能完成。"
      ),
      provider_unavailable: copy(
        "The generation service was temporarily unavailable.",
        "生成服务暂时不可用。"
      ),
      timeout: copy("The request timed out.", "请求处理超时。"),
    },
    filters: {
      allStatuses: copy("All statuses", "全部状态"),
      allTypes: copy("All business types", "全部业务类型"),
      apply: copy("Apply filters", "应用筛选"),
      businessType: copy("Business type", "业务类型"),
      range: copy("Time range", "时间范围"),
      status: copy("Status", "状态"),
    },
    pagination: {
      back: copy("Back to latest", "返回最新记录"),
      next: copy("Next page", "下一页"),
    },
    pricing: {
      description: copy(
        "View the existing image credit pricing curve and examples.",
        "查看现有生图积分价格曲线与计算示例。"
      ),
      error: copy(
        "Pricing trends are temporarily unavailable. Usage logs are unaffected.",
        "价格趋势暂时不可用，使用日志不受影响。"
      ),
      hide: copy("Collapse pricing trends", "收起价格趋势"),
      retry: copy("Retry pricing trends", "重试价格趋势"),
      show: copy("Expand pricing trends", "展开价格趋势"),
      title: copy("Pricing trends", "价格趋势"),
    },
    queryError: {
      description: copy(
        "Usage activity could not be loaded. Your filters have been preserved.",
        "使用记录加载失败，当前筛选条件已保留。"
      ),
      retry: copy("Retry", "重试"),
      title: copy("Usage activity is unavailable", "使用记录暂时不可用"),
    },
    ranges: {
      "7d": copy("Last 7 days", "最近 7 天"),
      "30d": copy("Last 30 days", "最近 30 天"),
      "90d": copy("Last 90 days", "最近 90 天"),
    },
    resultAnnouncement: copy(
      "{count} usage events shown.",
      "已显示 {count} 条使用记录。"
    ),
    sourceChannels: {
      api: "API",
      unknown: copy("Unknown source", "来源未知"),
      web: "Web",
    },
    statuses: {
      failed: copy("Failed", "失败"),
      processing: copy("Processing", "处理中"),
      refund: copy("Refunded", "已退款"),
      succeeded: copy("Succeeded", "成功"),
      unknown: copy("Unknown", "未知"),
    },
    table: {
      businessType: copy("Business type", "业务类型"),
      credits: copy("Credit change", "积分变化"),
      refundDirection: copy("returned", "退回"),
      source: copy("Source", "来源"),
      spendDirection: copy("consumed", "消耗"),
      status: copy("Status", "状态"),
      summary: copy("Summary", "摘要"),
      time: copy("Time", "时间"),
      title: copy("Activity results", "使用记录结果"),
    },
    title: copy("Usage log", "使用日志"),
    unknownTime: copy("Unknown time", "时间未知"),
    waiting: {
      description: copy(
        "Your usage history is being prepared. Please try again shortly.",
        "使用历史正在准备中，请稍后重试。"
      ),
      retry: copy("Check again", "重新检查"),
      title: copy("Usage log is being prepared", "使用日志正在准备中"),
    },
  };
}
