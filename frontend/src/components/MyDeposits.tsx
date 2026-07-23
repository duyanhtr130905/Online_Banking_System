import { useEffect, useMemo, useState } from "react";
import { usePlansContext } from "../contexts/PlansContext";
import { useAccountDataContext } from "../contexts/AccountDataContext";
import { useWalletContext } from "../contexts/WalletContext";
import { DepositCard } from "./DepositCard";
import "./MyDeposits.css";

type DepositTab = "active" | "history";

export function MyDeposits() {
  const { activeDeposits, historicalDeposits, depositsLoading, depositsError, refreshDeposits, refreshBalance } = useAccountDataContext();
  const { plans } = usePlansContext();
  const { account, chainId } = useWalletContext();
  const [tab, setTab] = useState<DepositTab>("active");
  const [transferTxHash, setTransferTxHash] = useState<string | null>(null);

  const planMap = useMemo(() => new Map(plans.map((plan) => [plan.planId, plan])), [plans]);
  const visibleDeposits = tab === "active" ? activeDeposits : historicalDeposits;

  async function refreshAll() {
    await Promise.all([refreshDeposits(), refreshBalance()]);
  }

  useEffect(() => { setTransferTxHash(null); }, [account, chainId]);

  const etherscanUrl = transferTxHash && chainId === 11_155_111
    ? `https://sepolia.etherscan.io/tx/${transferTxHash}`
    : null;

  return (
    <section className="my-deposits-section">
      <div className="section-header">
        <h2 className="section-title">🏦 Các khoản tiết kiệm của tôi</h2>
        <button className="btn-refresh" onClick={refreshAll} disabled={depositsLoading}>
          {depositsLoading ? "Đang tải..." : "🔄 Làm mới"}
        </button>
      </div>

      <div className="deposit-tabs" role="tablist" aria-label="Danh sách khoản gửi">
        <button className={`deposit-tab ${tab === "active" ? "deposit-tab-active" : ""}`} onClick={() => setTab("active")} role="tab" aria-selected={tab === "active"}>
          Đang hoạt động ({activeDeposits.length})
        </button>
        <button className={`deposit-tab ${tab === "history" ? "deposit-tab-active" : ""}`} onClick={() => setTab("history")} role="tab" aria-selected={tab === "history"}>
          Lịch sử ({historicalDeposits.length})
        </button>
      </div>

      {depositsError && <p className="my-deposits-warning">{depositsError}</p>}
      {transferTxHash && <p className="my-deposits-success">Đã chuyển NFT chứng chỉ. Tx: {etherscanUrl ? <a href={etherscanUrl} target="_blank" rel="noreferrer">{transferTxHash.slice(0, 10)}...{transferTxHash.slice(-8)} trên Etherscan</a> : transferTxHash}</p>}
      {depositsLoading && visibleDeposits.length === 0 ? (
        <p className="my-deposits-empty">Đang tải dữ liệu...</p>
      ) : visibleDeposits.length === 0 ? (
        <p className="my-deposits-empty">
          {tab === "active" ? "Bạn chưa có khoản gửi đang hoạt động" : "Chưa có lịch sử khoản gửi"}
        </p>
      ) : (
        <div className="deposits-grid">
          {visibleDeposits.map((deposit) => (
            <DepositCard
              key={deposit.depositId.toString()}
              deposit={deposit}
              plan={planMap.get(Number(deposit.planId))}
              onActionSuccess={refreshAll}
              onTransferSuccess={setTransferTxHash}
            />
          ))}
        </div>
      )}
    </section>
  );
}
