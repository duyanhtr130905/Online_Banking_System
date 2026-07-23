import { useState } from "react";
import { formatUnits } from "ethers";
import { useContracts } from "../hooks/useContracts";
import { useRole } from "../hooks/useRole";
import { useWalletContext } from "../contexts/WalletContext";
import { usePlansContext } from "../contexts/PlansContext";
import { extractError } from "../utils/errors";
import type { Plan } from "../types";
import "./PlanList.css";

/* ── Helpers hiển thị ── */
function fmtUsdc(value: bigint, zeroLabel: string): string {
  if (value === 0n) return zeroLabel;
  return `${formatUnits(value, 6)} USDC`;
}

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

/* ── Component ── */
export function PlanList() {
  const { plans, loading, error: refreshError, refresh } = usePlansContext();
  const contracts = useContracts();
  const { account } = useWalletContext();
  const { isAdmin, loading: roleLoading } = useRole(
    contracts?.savingCore ?? null,
    account,
  );
  const [pendingPlanId, setPendingPlanId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<"toggle" | "apr" | null>(null);
  const [aprDrafts, setAprDrafts] = useState<Record<number, string>>({});
  const [transactionStatus, setTransactionStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const showActions = isAdmin && !roleLoading;

  async function handlePlanToggle(plan: Plan) {
    if (!contracts || pendingPlanId !== null) return;

    if (plan.enabled) {
      const confirmed = window.confirm(
        "Đóng plan sẽ ngăn người dùng mở khoản gửi mới theo plan này. Các deposit đang hoạt động không bị ảnh hưởng.",
      );
      if (!confirmed) return;
    }

    setError(null);
    setSuccess(null);
    setPendingPlanId(plan.planId);
    setPendingAction("toggle");
    setTransactionStatus(`Đang chờ MetaMask xác nhận ${plan.enabled ? "đóng" : "mở lại"} plan...`);

    try {
      const tx = plan.enabled
        ? await contracts.savingCore.disablePlan(plan.planId)
        : await contracts.savingCore.enablePlan(plan.planId);
      setTransactionStatus("Đang chờ giao dịch được xác nhận trên blockchain...");
      await tx.wait();
      setSuccess(
        plan.enabled
          ? `Đã đóng plan #${plan.planId}.`
          : `Đã mở lại plan #${plan.planId}.`,
      );
      await refresh();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setPendingPlanId(null);
      setPendingAction(null);
      setTransactionStatus(null);
    }
  }

  async function handleAprUpdate(plan: Plan) {
    if (!contracts || pendingPlanId !== null) return;
    const nextApr = Number(aprDrafts[plan.planId] ?? plan.aprBps);
    if (!Number.isInteger(nextApr) || nextApr <= 0 || nextApr >= 10_000) {
      setError("APR phải là số nguyên từ 1 đến 9999 bps.");
      return;
    }
    setError(null);
    setSuccess(null);
    setPendingPlanId(plan.planId);
    setPendingAction("apr");
    setTransactionStatus("Đang chờ MetaMask xác nhận cập nhật APR...");
    try {
      const tx = await contracts.savingCore.updatePlan(plan.planId, nextApr);
      setTransactionStatus("Đang chờ giao dịch được xác nhận trên blockchain...");
      await tx.wait();
      setSuccess(`Đã cập nhật APR của plan #${plan.planId}. Deposit đã mở vẫn dùng APR snapshot cũ.`);
      await refresh();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setPendingPlanId(null);
      setPendingAction(null);
      setTransactionStatus(null);
    }
  }

  if (!contracts) {
    return (
      <section className="plan-section">
        <h2 className="section-title">📋 Danh sách gói tiết kiệm</h2>
        <p className="plan-empty">Đang chờ kết nối ví</p>
      </section>
    );
  }

  return (
    <section className="plan-section">
      <div className="section-header">
        <h2 className="section-title">📋 Danh sách gói tiết kiệm</h2>
        <button className="btn-refresh" onClick={refresh} disabled={loading}>
          {loading ? "Đang tải..." : "🔄 Làm mới"}
        </button>
      </div>

      {plans.length === 0 && !loading ? (
        <p className="plan-empty">Chưa có gói tiết kiệm nào</p>
      ) : (
        <div className="plan-table-wrapper">
          <table className="plan-table">
            <thead>
              <tr>
                <th>Plan ID</th>
                <th>Tenor (ngày)</th>
                <th>APR (%)</th>
                <th>Penalty (%)</th>
                <th>Min Deposit</th>
                <th>Max Deposit</th>
                <th>Trạng thái</th>
                {showActions && <th>Thao tác quản trị</th>}
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.planId} className={p.enabled ? "" : "row-disabled"}>
                  <td>{p.planId}</td>
                  <td>{p.tenorDays}</td>
                  <td>{bpsToPercent(p.aprBps)}%</td>
                  <td>{bpsToPercent(p.earlyWithdrawPenaltyBps)}%</td>
                  <td>{fmtUsdc(p.minDeposit, "Không có mức tối thiểu")}</td>
                  <td>{fmtUsdc(p.maxDeposit, "Không giới hạn")}</td>
                  <td>
                    <span className={`status-badge ${p.enabled ? "status-open" : "status-closed"}`}>
                      {p.enabled ? "Đang mở" : "Đã đóng"}
                    </span>
                  </td>
                  {showActions && (
                    <td>
                      <div className="plan-admin-actions">
                        <div className="plan-apr-editor">
                          <input
                            className="plan-apr-input"
                            type="number"
                            min="1"
                            max="9999"
                            value={aprDrafts[p.planId] ?? p.aprBps}
                            onChange={(event) => setAprDrafts((drafts) => ({
                              ...drafts,
                              [p.planId]: event.target.value,
                            }))}
                            disabled={pendingPlanId !== null}
                            aria-label={`APR mới cho plan ${p.planId} theo bps`}
                          />
                          <button
                            className="btn-plan-toggle btn-plan-apr"
                            onClick={() => handleAprUpdate(p)}
                            disabled={pendingPlanId !== null}
                          >
                            {pendingPlanId === p.planId && pendingAction === "apr"
                              ? "Đang cập nhật..."
                              : "Cập nhật APR"}
                          </button>
                        </div>
                        <button
                          className={`btn-plan-toggle ${p.enabled ? "btn-plan-close" : "btn-plan-open"}`}
                          onClick={() => handlePlanToggle(p)}
                          disabled={pendingPlanId !== null}
                        >
                          {pendingPlanId === p.planId && pendingAction === "toggle"
                            ? "Đang xử lý..."
                            : p.enabled
                              ? "Đóng plan"
                              : "Mở lại"}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="plan-message plan-error">{error}</p>}
      {refreshError && <p className="plan-message plan-error">{refreshError}</p>}
      {transactionStatus && <p className="plan-message plan-status">{transactionStatus}</p>}
      {success && <p className="plan-message plan-success">{success}</p>}
    </section>
  );
}
