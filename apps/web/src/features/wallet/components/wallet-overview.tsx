/** 钱包资产概览：只展示余额和历史净消耗，不展示任何交易或退款列表。 */
import { formatCredits } from "@repo/shared/credits/format";
import type { WalletBalanceSnapshot } from "@repo/shared/credits/wallet-contract";
import type { WalletDataSection } from "../wallet-page-data";
import type { WalletCopy } from "./wallet-copy";

type WalletOverviewProps = {
  balance: WalletDataSection<WalletBalanceSnapshot>;
  copy: WalletCopy;
};

/** 根据余额读取状态渲染真实资产或明确失败提示，失败时绝不伪造零值。 */
export function WalletOverview({ balance, copy }: WalletOverviewProps) {
  if (balance.status === "error") {
    return (
      <section
        aria-label={copy.balance}
        className="rounded-xl border border-destructive/30 bg-destructive/5 p-5"
        role="alert"
      >
        <p className="text-sm text-destructive">{copy.overviewError}</p>
      </section>
    );
  }

  return (
    <section aria-label={copy.balance} className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">{copy.balance}</p>
        <p className="mt-3 font-serif text-3xl font-medium tabular-nums">
          {formatCredits(balance.data.balance)}
        </p>
      </div>
      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">{copy.netSpent}</p>
        <p className="mt-3 font-serif text-3xl font-medium tabular-nums">
          {formatCredits(balance.data.totalNetSpent)}
        </p>
      </div>
    </section>
  );
}
