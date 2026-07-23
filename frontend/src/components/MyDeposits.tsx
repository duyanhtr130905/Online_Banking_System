import { useMemo, useState } from "react";
import { usePlansContext } from "../contexts/PlansContext";
import { useAccountDataContext } from "../contexts/AccountDataContext";
import { DepositCard } from "./DepositCard";
import "./MyDeposits.css";

type DepositTab = "active" | "history";

export function MyDeposits() {
  const { activeDeposits, historicalDeposits, depositsLoading, depositsError, refreshDeposits, refreshBalance } = useAccountDataContext();
  const { plans } = usePlansContext();
  const [tab, setTab] = useState<DepositTab>("active");

  const planMap = useMemo(() => new Map(plans.map((plan) => [plan.planId, plan])), [plans]);
  const visibleDeposits = tab === "active" ? activeDeposits : historicalDeposits;

  async function refreshAll() {
    await Promise.all([refreshDeposits(), refreshBalance()]);
  }

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
            />
          ))}
        </div>
      )}
    </section>
  );
}
