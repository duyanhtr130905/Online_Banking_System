import { useEffect, useRef, useState } from "react";
import { formatUnits } from "ethers";
import { useContracts } from "../hooks/useContracts";
import { useRole } from "../hooks/useRole";
import { useWalletContext } from "../contexts/WalletContext";
import { usePlansContext } from "../contexts/PlansContext";
import { extractError } from "../utils/errors";
import type { Plan } from "../types";
import "./PlanList.css";

type PlanAction = "toggle" | "apr";
type PlanFeedback = { kind: "status" | "success" | "error"; message: string };

function fmtUsdc(value: bigint, zeroLabel: string): string {
  return value === 0n ? zeroLabel : `${formatUnits(value, 6)} USDC`;
}

export function PlanList() {
  const { plans, loading, error: refreshError, refresh } = usePlansContext();
  const contracts = useContracts();
  const { account } = useWalletContext();
  const { isAdmin, loading: roleLoading } = useRole(contracts?.savingCore ?? null, account);
  const [loadingByPlan, setLoadingByPlan] = useState<Record<number, PlanAction | undefined>>({});
  const [aprDrafts, setAprDrafts] = useState<Record<number, string>>({});
  const [feedbackByPlan, setFeedbackByPlan] = useState<Record<number, PlanFeedback | undefined>>({});
  const feedbackTimersRef = useRef(new Map<number, number>());
  const showActions = isAdmin && !roleLoading;

  useEffect(() => () => {
    feedbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    feedbackTimersRef.current.clear();
  }, []);

  function setFeedback(planId: number, feedback: PlanFeedback, autoHide = false) {
    const existingTimer = feedbackTimersRef.current.get(planId);
    if (existingTimer) window.clearTimeout(existingTimer);
    setFeedbackByPlan((current) => ({ ...current, [planId]: feedback }));
    if (!autoHide) return;
    const timer = window.setTimeout(() => {
      setFeedbackByPlan((current) => ({ ...current, [planId]: undefined }));
      feedbackTimersRef.current.delete(planId);
    }, 4_500);
    feedbackTimersRef.current.set(planId, timer);
  }

  function setPlanLoading(planId: number, action: PlanAction | undefined) {
    setLoadingByPlan((current) => ({ ...current, [planId]: action }));
  }

  async function handlePlanToggle(plan: Plan) {
    if (!contracts || loadingByPlan[plan.planId]) return;
    if (plan.enabled && !window.confirm("Đóng plan sẽ ngăn người dùng mở khoản gửi mới theo plan này. Các deposit đang hoạt động không bị ảnh hưởng.")) return;
    setPlanLoading(plan.planId, "toggle");
    setFeedback(plan.planId, { kind: "status", message: `Đang chờ MetaMask xác nhận ${plan.enabled ? "đóng" : "mở lại"} plan #${plan.planId}...` });
    try {
      const tx = plan.enabled
        ? await contracts.savingCore.disablePlan(plan.planId)
        : await contracts.savingCore.enablePlan(plan.planId);
      setFeedback(plan.planId, { kind: "status", message: "Đang chờ giao dịch được xác nhận trên blockchain..." });
      await tx.wait();
      setFeedback(plan.planId, {
        kind: "success",
        message: plan.enabled ? `Đã đóng plan #${plan.planId}` : `Đã mở lại plan #${plan.planId}`,
      }, true);
      await refresh();
    } catch (err) {
      setFeedback(plan.planId, { kind: "error", message: extractError(err) }, true);
    } finally {
      setPlanLoading(plan.planId, undefined);
    }
  }

  async function handleAprUpdate(plan: Plan) {
    if (!contracts || loadingByPlan[plan.planId]) return;
    if (!plan.enabled) {
      setFeedback(plan.planId, { kind: "error", message: "Chỉ có thể cập nhật APR khi plan đang mở." }, true);
      return;
    }
    const nextApr = Number(aprDrafts[plan.planId] ?? plan.aprBps);
    if (!Number.isInteger(nextApr) || nextApr <= 0 || nextApr >= 10_000) {
      setFeedback(plan.planId, { kind: "error", message: "APR phải là số nguyên từ 1 đến 9999 bps." }, true);
      return;
    }
    setPlanLoading(plan.planId, "apr");
    setFeedback(plan.planId, { kind: "status", message: `Đang chờ MetaMask xác nhận cập nhật APR plan #${plan.planId}...` });
    try {
      const tx = await contracts.savingCore.updatePlan(plan.planId, nextApr);
      setFeedback(plan.planId, { kind: "status", message: "Đang chờ giao dịch được xác nhận trên blockchain..." });
      await tx.wait();
      setFeedback(plan.planId, { kind: "success", message: `Đã cập nhật APR plan #${plan.planId}` }, true);
      await refresh();
    } catch (err) {
      setFeedback(plan.planId, { kind: "error", message: extractError(err) }, true);
    } finally {
      setPlanLoading(plan.planId, undefined);
    }
  }

  if (!contracts) return <section className="plan-section"><h2 className="section-title">📋 Danh sách gói tiết kiệm</h2><p className="plan-empty">Đang chờ kết nối ví</p></section>;

  return (
    <section className="plan-section">
      <div className="section-header"><h2 className="section-title">📋 Danh sách gói tiết kiệm</h2><button className="btn-refresh" onClick={refresh} disabled={loading}>{loading ? "Đang tải..." : "🔄 Làm mới"}</button></div>
      {plans.length === 0 && !loading ? <p className="plan-empty">Chưa có gói tiết kiệm nào</p> : (
        <div className="plan-table-wrapper"><table className={`plan-table ${showActions ? "plan-table-admin" : ""}`}>
          <thead><tr><th>Plan ID</th><th>Tenor</th><th>APR</th><th>Penalty</th><th>Min Deposit</th><th>Max Deposit</th><th>Trạng thái plan</th>
            {showActions && <><th>APR mới (bps)</th><th>Cập nhật APR</th><th>Đóng / Mở lại</th><th>Thông báo</th></>}
          </tr></thead>
          <tbody>{plans.map((plan) => {
            const pendingAction = loadingByPlan[plan.planId];
            const feedback = feedbackByPlan[plan.planId];
            return <PlanRow key={plan.planId} plan={plan} showActions={showActions} pendingAction={pendingAction} feedback={feedback} aprDraft={aprDrafts[plan.planId] ?? String(plan.aprBps)} onAprChange={(value) => setAprDrafts((current) => ({ ...current, [plan.planId]: value }))} onUpdateApr={() => handleAprUpdate(plan)} onToggle={() => handlePlanToggle(plan)} />;
          })}</tbody>
        </table></div>
      )}
      {refreshError && <p className="plan-message plan-error">{refreshError}</p>}
    </section>
  );
}

function PlanRow({ plan, showActions, pendingAction, feedback, aprDraft, onAprChange, onUpdateApr, onToggle }: { plan: Plan; showActions: boolean; pendingAction: PlanAction | undefined; feedback: PlanFeedback | undefined; aprDraft: string; onAprChange: (value: string) => void; onUpdateApr: () => void; onToggle: () => void }) {
  return <tr className={plan.enabled ? "" : "row-disabled"}>
    <td>{plan.planId}</td><td>{plan.tenorDays} ngày</td><td>{(plan.aprBps / 100).toFixed(2)}%</td><td>{(plan.earlyWithdrawPenaltyBps / 100).toFixed(2)}%</td><td>{fmtUsdc(plan.minDeposit, "Không có mức tối thiểu")}</td><td>{fmtUsdc(plan.maxDeposit, "Không giới hạn")}</td>
    <td><span className={`status-badge ${plan.enabled ? "status-open" : "status-closed"}`}>{plan.enabled ? "Đang mở" : "Đã đóng"}</span></td>
    {showActions && <>
      <td><input className="plan-apr-input" type="number" min="1" max="9999" value={aprDraft} onChange={(event) => onAprChange(event.target.value)} disabled={!plan.enabled || !!pendingAction} aria-label={`APR mới cho plan ${plan.planId} theo bps`} /></td>
      <td><button className="btn-plan-toggle btn-plan-apr" onClick={onUpdateApr} disabled={!plan.enabled || !!pendingAction}>{pendingAction === "apr" ? "Đang cập nhật..." : "Cập nhật APR"}</button></td>
      <td><button className={`btn-plan-toggle ${plan.enabled ? "btn-plan-close" : "btn-plan-open"}`} onClick={onToggle} disabled={!!pendingAction}>{pendingAction === "toggle" ? "Đang xử lý..." : plan.enabled ? "Đóng plan" : "Mở lại"}</button></td>
      <td className="plan-feedback-cell">{feedback && <span className={`plan-row-feedback plan-row-${feedback.kind}`}>{feedback.message}</span>}</td>
    </>}
  </tr>;
}
