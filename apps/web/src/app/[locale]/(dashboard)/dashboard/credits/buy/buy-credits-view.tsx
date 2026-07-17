"use client";

/**
 * 购买积分套餐视图组件
 *
 * 展示积分套餐列表，允许用户选择并购买
 * 设计风格：GPT2IMAGE 黑白简约
 */

import {
  createCreditsPurchaseCheckout,
  getCreditPackages,
} from "@repo/shared/credits/actions";
import { getCurrencyMinorUnitExponent } from "@repo/shared/credits/top-up";
import {
  CREDIT_PACKAGES,
  isCreditPackageVisible,
} from "@repo/shared/credits/config";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Separator } from "@repo/ui/components/separator";
import { cn } from "@repo/ui/utils";
import { ArrowLeft, Check, Loader2, Minus, Plus } from "lucide-react";
import { useLocale } from "next-intl";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";

import {
  createCreditTopUpCheckoutAction,
  getCreditTopUpOptionsAction,
  getCreditTopUpOrderStatusAction,
} from "@/features/payment/credit-top-up-actions";

type CreditPackageCard = {
  id: string;
  name: string;
  credits: number;
  price: number;
  currency: string;
  description: string;
  popular: boolean;
  allowQuantity?: boolean;
  maxQuantity?: number;
};

const FALLBACK_PACKAGES: CreditPackageCard[] = CREDIT_PACKAGES.filter(
  isCreditPackageVisible
).map((pkg) => ({
  id: pkg.id,
  name: pkg.name,
  credits: pkg.credits,
  price: pkg.price,
  currency:
    "currency" in pkg && typeof pkg.currency === "string"
      ? pkg.currency
      : "CNY",
  description: pkg.description,
  popular: "popular" in pkg ? pkg.popular : false,
  allowQuantity: "allowQuantity" in pkg ? Boolean(pkg.allowQuantity) : false,
  maxQuantity:
    "maxQuantity" in pkg && typeof pkg.maxQuantity === "number"
      ? pkg.maxQuantity
      : 1,
}));

const PACKAGE_NAMES_ZH: Record<string, string> = {
  payg_starter: "按量付费",
  enterprise_resource: "企业资源包",
};

const PACKAGE_DESCRIPTIONS_ZH: Record<string, string> = {
  payg_starter: "与入门版同价同积分的一次性积分包",
  enterprise_resource: "企业版专属资源包，可按数量购买",
  lite: "少量补充，适合临时生成几张图片",
  standard: "适合日常使用的高性价比选择",
  pro: "更多积分，更适合高频创作",
};

const DEFAULT_MAX_PACKAGE_QUANTITY = 999;

type CreditTopUpCurrency = {
  currency: string;
  creditsPerMajorUnit: number;
  minAmountMinor: number;
  maxAmountMinor: number;
  providers: Array<"alipay_f2f">;
};

type CreditTopUpOrder = {
  orderId: string;
  status: string;
  currency: string;
  amount: number;
  amountMinor: number;
  creditsAmount: number;
  qrCode: string | null;
  expiresAt: string | null;
};

type CreditTopUpRequest = {
  quoteKey: string;
  clientRequestId: string;
};

function parseAmountMinor(value: string, currency: string): number | null {
  const exponent = getCurrencyMinorUnitExponent(currency);
  const expression = new RegExp(`^\\d+(?:\\.\\d{1,${exponent}})?$`);
  const normalized = value.trim();
  if (!expression.test(normalized)) return null;
  const amount = Number(normalized);
  const amountMinor = Math.round(amount * 10 ** exponent);
  return Number.isSafeInteger(amountMinor) && amountMinor > 0
    ? amountMinor
    : null;
}

function formatCurrency(amount: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount);
}

function submitEpayForm(url: string, params: Record<string, string>) {
  const form = document.createElement("form");
  form.action = url;
  form.method = "POST";
  form.style.display = "none";

  for (const [key, value] of Object.entries(params)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

/**
 * 购买积分套餐视图
 */
export function BuyCreditPackagesView() {
  const locale = useLocale();
  const isZh = locale === "zh";
  const router = useRouter();
  const searchParams = useSearchParams();
  const canceled = searchParams.get("canceled");
  const copy = useCallback(
    (en: string, zh: string) => (isZh ? zh : en),
    [isZh]
  );
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [topUpCurrency, setTopUpCurrency] = useState("CNY");
  const [topUpAmount, setTopUpAmount] = useState("10");
  const [topUpOrder, setTopUpOrder] = useState<CreditTopUpOrder | null>(null);
  const [topUpQrDataUrl, setTopUpQrDataUrl] = useState<string | null>(null);
  const topUpRequestRef = useRef<CreditTopUpRequest | null>(null);
  const {
    execute: fetchPackages,
    result: packagesResult,
    isPending: isPackagesLoading,
  } = useAction(getCreditPackages);
  const {
    execute: fetchTopUpOptions,
    result: topUpOptionsResult,
    isPending: isTopUpOptionsLoading,
  } = useAction(getCreditTopUpOptionsAction);
  const { execute: createTopUpCheckout, isPending: isTopUpPending } = useAction(
    createCreditTopUpCheckoutAction,
    {
      onSuccess: ({ data }) => {
        if (data) {
          setTopUpOrder(data);
        }
      },
      onError: ({ error }) => {
        toast.error(
          error.serverError ??
            copy("Failed to create top-up order", "创建充值订单失败")
        );
      },
    }
  );
  const { execute: fetchTopUpOrderStatus, result: topUpOrderStatusResult } =
    useAction(getCreditTopUpOrderStatusAction);

  // 创建 Checkout Session
  const { execute, isPending } = useAction(createCreditsPurchaseCheckout, {
    onSuccess: ({ data }) => {
      if (data?.url) {
        if (data.method === "POST" && data.params) {
          submitEpayForm(data.url, data.params);
        } else {
          window.location.href = data.url;
        }
      }
    },
    onError: ({ error }) => {
      toast.error(
        error.serverError ??
          copy("Failed to create checkout session", "创建支付订单失败")
      );
    },
  });

  useEffect(() => {
    fetchPackages();
    fetchTopUpOptions();
  }, [fetchPackages, fetchTopUpOptions]);

  useEffect(() => {
    const defaultCurrency = topUpOptionsResult.data?.defaultCurrency;
    if (defaultCurrency) setTopUpCurrency(defaultCurrency);
  }, [topUpOptionsResult.data?.defaultCurrency]);

  useEffect(() => {
    const qrCode = topUpOrder?.qrCode;
    if (!qrCode) {
      setTopUpQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(qrCode, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    })
      .then((dataUrl) => {
        if (!cancelled) setTopUpQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(
            copy("Failed to render payment QR code", "生成支付二维码失败")
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [copy, topUpOrder?.qrCode]);

  useEffect(() => {
    if (!topUpOrder || topUpOrder.status === "fulfilled") return;
    fetchTopUpOrderStatus({ orderId: topUpOrder.orderId });
    const timer = window.setInterval(() => {
      fetchTopUpOrderStatus({ orderId: topUpOrder.orderId });
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [fetchTopUpOrderStatus, topUpOrder]);

  useEffect(() => {
    const status = topUpOrderStatusResult.data;
    if (!status) return;
    setTopUpOrder((current) => {
      if (!current || current.orderId !== status.orderId) return current;
      if (current.status !== "fulfilled" && status.status === "fulfilled") {
        toast.success(copy("Credits have been added", "积分已到账"));
      }
      return {
        ...current,
        status: status.status,
        currency: status.currency,
        amount: status.amount,
        creditsAmount: status.creditsAmount,
        qrCode: status.qrCode,
        expiresAt: status.expiresAt,
      };
    });
  }, [copy, topUpOrderStatusResult.data]);

  // 显示取消提示
  useEffect(() => {
    if (canceled) {
      toast.info(copy("Payment canceled", "支付已取消"));
      router.replace(`/${locale}/dashboard/credits/buy`);
    }
  }, [canceled, copy, locale, router]);

  /**
   * 处理购买按钮点击
   */
  const handlePurchase = (packageId: string) => {
    execute({
      packageId,
      quantity: packages.find((pkg) => pkg.id === packageId)?.allowQuantity
        ? (quantities[packageId] ?? 1)
        : 1,
    });
  };

  const packages = (packagesResult.data ??
    FALLBACK_PACKAGES) as CreditPackageCard[];
  const topUpOptions = topUpOptionsResult.data;
  const topUpCurrencies = topUpOptions?.currencies ?? [];
  const selectedTopUpCurrency = topUpCurrencies.find(
    (item) => item.currency === topUpCurrency
  ) as CreditTopUpCurrency | undefined;
  const topUpAmountMinor = selectedTopUpCurrency
    ? parseAmountMinor(topUpAmount, selectedTopUpCurrency.currency)
    : null;
  const topUpCredits =
    selectedTopUpCurrency && topUpAmountMinor
      ? (topUpAmountMinor /
          10 ** getCurrencyMinorUnitExponent(selectedTopUpCurrency.currency)) *
        selectedTopUpCurrency.creditsPerMajorUnit
      : 0;
  const canCreateTopUp =
    Boolean(selectedTopUpCurrency && topUpAmountMinor) &&
    Boolean(
      topUpAmountMinor &&
        selectedTopUpCurrency &&
        topUpAmountMinor >= selectedTopUpCurrency.minAmountMinor &&
        topUpAmountMinor <= selectedTopUpCurrency.maxAmountMinor
    );
  const normalizedQuantities = useMemo(
    () =>
      Object.fromEntries(
        packages.map((pkg) => [
          pkg.id,
          Math.min(
            pkg.maxQuantity ?? DEFAULT_MAX_PACKAGE_QUANTITY,
            Math.max(1, Math.trunc(quantities[pkg.id] ?? 1))
          ),
        ])
      ) as Record<string, number>,
    [packages, quantities]
  );
  const setPackageQuantity = (packageId: string, value: number) => {
    setQuantities((current) => ({
      ...current,
      [packageId]: Math.min(
        packages.find((pkg) => pkg.id === packageId)?.maxQuantity ??
          DEFAULT_MAX_PACKAGE_QUANTITY,
        Math.max(1, Math.trunc(Number.isFinite(value) ? value : 1))
      ),
    }));
  };
  const handleTopUp = () => {
    if (!selectedTopUpCurrency || !topUpAmountMinor) return;
    const quoteKey = `${selectedTopUpCurrency.currency}:${topUpAmountMinor}`;
    const currentRequest = topUpRequestRef.current;
    const clientRequestId =
      currentRequest?.quoteKey === quoteKey
        ? currentRequest.clientRequestId
        : crypto.randomUUID();
    // 浏览器在提交后丢失响应时，用户再次点击必须复用同一幂等键；只有报价变更时
    // 才建立新订单，避免为同一金额生成多张可付款二维码。
    topUpRequestRef.current = { quoteKey, clientRequestId };
    createTopUpCheckout({
      clientRequestId,
      currency: selectedTopUpCurrency.currency,
      amountMinor: topUpAmountMinor,
      provider: "alipay_f2f",
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
      {/* 页面标题 */}
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-medium tracking-tight">
          {copy("Buy Credits", "购买积分")}
        </h1>
        <p className="text-muted-foreground">
          {copy(
            "One-time credit packages. No subscription required. Credits follow the issued batch expiry shown on your usage page.",
            "一次性积分包，无需订阅。积分按发放批次有效期计算，可在用量页查看到期时间。"
          )}
        </p>
      </div>

      <Separator />

      {topUpOptions?.enabled && selectedTopUpCurrency && (
        <Card className="mx-auto max-w-xl border-foreground/20 shadow-whisper">
          <CardHeader className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[1.2px] text-muted-foreground">
              {copy("Pay as you go", "按金额充值")}
            </p>
            <CardTitle className="font-serif text-2xl font-medium">
              {copy("Recharge exactly what you need", "按需充值所需积分")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              {copy(
                `${selectedTopUpCurrency.creditsPerMajorUnit} credits per ${selectedTopUpCurrency.currency} 1.`,
                `每 1 ${selectedTopUpCurrency.currency} 可兑换 ${selectedTopUpCurrency.creditsPerMajorUnit} 积分。`
              )}
            </p>
            <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
              <select
                aria-label={copy("Top-up currency", "充值币种")}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={selectedTopUpCurrency.currency}
                disabled={isTopUpPending || isTopUpOptionsLoading}
                onChange={(event) => setTopUpCurrency(event.target.value)}
              >
                {topUpCurrencies.map((item) => (
                  <option key={item.currency} value={item.currency}>
                    {item.currency}
                  </option>
                ))}
              </select>
              <Input
                inputMode="decimal"
                value={topUpAmount}
                disabled={isTopUpPending || isTopUpOptionsLoading}
                onChange={(event) => setTopUpAmount(event.target.value)}
                aria-label={copy("Top-up amount", "充值金额")}
                placeholder={copy("Amount", "金额")}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {topUpAmountMinor && canCreateTopUp
                ? copy(
                    `${formatCurrency(topUpAmountMinor / 10 ** getCurrencyMinorUnitExponent(selectedTopUpCurrency.currency), selectedTopUpCurrency.currency, locale)} → ${topUpCredits.toLocaleString()} credits`,
                    `${formatCurrency(topUpAmountMinor / 10 ** getCurrencyMinorUnitExponent(selectedTopUpCurrency.currency), selectedTopUpCurrency.currency, locale)} 可得 ${topUpCredits.toLocaleString()} 积分`
                  )
                : copy(
                    `Enter an amount between ${formatCurrency(selectedTopUpCurrency.minAmountMinor / 10 ** getCurrencyMinorUnitExponent(selectedTopUpCurrency.currency), selectedTopUpCurrency.currency, locale)} and ${formatCurrency(selectedTopUpCurrency.maxAmountMinor / 10 ** getCurrencyMinorUnitExponent(selectedTopUpCurrency.currency), selectedTopUpCurrency.currency, locale)}.`,
                    `请输入 ${formatCurrency(selectedTopUpCurrency.minAmountMinor / 10 ** getCurrencyMinorUnitExponent(selectedTopUpCurrency.currency), selectedTopUpCurrency.currency, locale)} 到 ${formatCurrency(selectedTopUpCurrency.maxAmountMinor / 10 ** getCurrencyMinorUnitExponent(selectedTopUpCurrency.currency), selectedTopUpCurrency.currency, locale)} 之间的金额。`
                  )}
            </p>
            {topUpOrder?.qrCode && topUpQrDataUrl && (
              <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-muted/30 p-4 text-center">
                <Image
                  src={topUpQrDataUrl}
                  width={256}
                  height={256}
                  alt={copy("Alipay payment QR code", "支付宝支付二维码")}
                  unoptimized
                />
                <p className="text-sm text-muted-foreground">
                  {topUpOrder.status === "fulfilled"
                    ? copy(
                        "Payment confirmed. Credits have been added.",
                        "支付已确认，积分已到账。"
                      )
                    : copy(
                        "Scan with Alipay. Credits are issued after payment confirmation.",
                        "请使用支付宝扫码，支付确认后积分将自动到账。"
                      )}
                </p>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              disabled={!canCreateTopUp || isTopUpPending}
              onClick={handleTopUp}
            >
              {isTopUpPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {copy("Creating order...", "正在创建订单...")}
                </>
              ) : (
                copy("Pay with Alipay", "支付宝扫码充值")
              )}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* 套餐列表 */}
      <div
        className={cn(
          "grid gap-6",
          packages.length === 1
            ? "mx-auto max-w-md"
            : "sm:grid-cols-2 lg:grid-cols-3"
        )}
      >
        {packages.map((pkg, index) => {
          const isPopular = pkg.popular;
          const allowQuantity = Boolean(pkg.allowQuantity);
          const quantity = normalizedQuantities[pkg.id] ?? 1;
          const totalCredits = pkg.credits * quantity;
          const totalPrice = pkg.price * quantity;
          const perCredit = (pkg.price / pkg.credits).toFixed(4);

          return (
            // 套餐卡：hover 统一抬升（-translate-y-0.5 + whisper 阴影），入场按索引
            // 50ms 错峰；入场时长走内联属性（400ms），不影响 hover 过渡 duration-250。
            <Card
              key={pkg.id}
              className={cn(
                "relative flex flex-col rounded-lg border transition-[border-color,box-shadow,translate] duration-250 hover:-translate-y-0.5 hover:shadow-whisper motion-reduce:transition-none animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none",
                isPopular
                  ? "border-foreground shadow-whisper"
                  : "border-border hover:border-foreground/30"
              )}
              style={{
                animationDelay: `${(index % 12) * 50}ms`,
                animationDuration: "400ms",
                animationFillMode: "backwards",
              }}
            >
              {/* 热门标签 */}
              {isPopular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-foreground text-background text-[10px] uppercase tracking-wider">
                  {copy("Best Value", "最划算")}
                </Badge>
              )}

              <CardHeader className="pb-3 pt-6 text-center">
                <p className="text-xs font-medium uppercase tracking-[1.2px] text-muted-foreground">
                  {isZh ? (PACKAGE_NAMES_ZH[pkg.id] ?? pkg.name) : pkg.name}
                </p>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col items-center space-y-4 px-6">
                {/* 积分数量 */}
                <div className="text-center">
                  <span className="font-serif text-5xl font-medium tracking-tight">
                    {totalCredits.toLocaleString()}
                  </span>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {allowQuantity
                      ? copy(
                          `${pkg.credits.toLocaleString()} credits x ${quantity}`,
                          `${pkg.credits.toLocaleString()} 积分 x ${quantity}`
                        )
                      : copy("credits", "积分")}
                  </p>
                </div>

                <Separator />

                {/* 价格 */}
                <div className="text-center">
                  <span className="font-serif text-3xl font-medium">
                    {formatCurrency(totalPrice, pkg.currency, locale)}
                  </span>
                  <span className="ml-1 text-sm text-muted-foreground">
                    {pkg.currency}
                  </span>
                </div>

                {allowQuantity && (
                  <div className="w-full space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{copy("Quantity", "购买数量")}</span>
                      <span>
                        {copy(
                          `${quantity} pack${quantity > 1 ? "s" : ""}`,
                          `${quantity} 份`
                        )}
                      </span>
                    </div>
                    <div className="flex h-9 items-center overflow-hidden rounded-md border border-border">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-none"
                        disabled={
                          quantity <= 1 || isPending || isPackagesLoading
                        }
                        onClick={() => setPackageQuantity(pkg.id, quantity - 1)}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <Input
                        type="number"
                        min={1}
                        max={pkg.maxQuantity ?? DEFAULT_MAX_PACKAGE_QUANTITY}
                        value={quantity}
                        className="h-8 border-0 text-center shadow-none focus-visible:ring-0"
                        disabled={isPending || isPackagesLoading}
                        onChange={(event) =>
                          setPackageQuantity(pkg.id, Number(event.target.value))
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-none"
                        disabled={
                          quantity >=
                            (pkg.maxQuantity ?? DEFAULT_MAX_PACKAGE_QUANTITY) ||
                          isPending ||
                          isPackagesLoading
                        }
                        onClick={() => setPackageQuantity(pkg.id, quantity + 1)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* 描述 + 每积分价格 */}
                <p className="text-center text-xs text-muted-foreground">
                  {isZh
                    ? (PACKAGE_DESCRIPTIONS_ZH[pkg.id] ?? pkg.description)
                    : pkg.description}
                </p>

                {/* 特性列表 */}
                <ul className="w-full space-y-2 text-sm">
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />
                    {copy("Instant delivery", "立即到账")}
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />
                    {copy(
                      "Batch expiry shown in Usage",
                      "有效期可在用量页查看"
                    )}
                  </li>
                  <li className="flex items-center gap-2 text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />
                    {copy(
                      `${perCredit} ${pkg.currency} per credit`,
                      `每积分 ${perCredit} ${pkg.currency}`
                    )}
                  </li>
                </ul>
              </CardContent>

              <CardFooter className="px-6 pb-6 pt-2">
                <Button
                  className="w-full"
                  variant={isPopular ? "default" : "outline"}
                  disabled={isPending || isPackagesLoading}
                  onClick={() => handlePurchase(pkg.id)}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {copy("Processing...", "处理中...")}
                    </>
                  ) : (
                    copy(
                      `Buy ${totalCredits.toLocaleString()} Credits`,
                      `购买 ${totalCredits.toLocaleString()} 积分`
                    )
                  )}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* 返回链接 */}
      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => router.push(`/${locale}/dashboard/billing`)}
        >
          <ArrowLeft className="h-4 w-4" />
          {copy("Back to Billing & Usage", "返回账单与用量")}
        </Button>
      </div>
    </div>
  );
}
