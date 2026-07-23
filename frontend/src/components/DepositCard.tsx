import { useState, useEffect, useRef, useMemo } from "react";
import { formatUnits } from "ethers";
import { useContracts } from "../hooks/useContracts";
import { useWalletContext } from "../contexts/WalletContext";
import { usePlansContext } from "../contexts/PlansContext";
import { extractError } from "../utils/errors";
import { DepositStatus } from "../types";
import type { Deposit, Plan } from "../types";
import "./DepositCard.css";

interface DepositCardProps {
  deposit: Deposit;
  plan: Plan | undefined;
  onActionSuccess: () => Promise<void>;
}

const statusLabels: Record<DepositStatus, string> = {
  [DepositStatus.Active]: "Đang hoạt động",
  [DepositStatus.Withdrawn]: "Đã rút",
  [DepositStatus.ManualRenewed]: "Đã gia hạn thủ công",
  [DepositStatus.AutoRenewed]: "Đã tự động gia hạn",
};

export function DepositCard({ deposit, plan, onActionSuccess }: DepositCardProps) {
  const contracts = useContracts();
  const { provider } = useWalletContext();
  const { plans } = usePlansContext();
  const [now, setNow] = useState(0);
  const [gracePeriodSeconds, setGracePeriodSeconds] = useState<bigint | null>(null);
  const [interest, setInterest] = useState<bigint | null>(null);
  const [penalty, setPenalty] = useState<bigint | null>(null);
  const [valuesError, setValuesError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renewPlanId, setRenewPlanId] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const enabledPlans = useMemo(() => plans.filter((item) => item.enabled), [plans]);
  const isActive = deposit.status === DepositStatus.Active && deposit.isCurrentOwner;
  const maturityAt = Number(deposit.maturityAt);
  const tenorSeconds = plan ? plan.tenorDays * 86_400 : 0;
  const openedAt = tenorSeconds > 0 ? maturityAt - tenorSeconds : maturityAt;
  const totalDuration = maturityAt - openedAt;
  const elapsed = now > 0 && totalDuration > 0
    ? Math.min(100, Math.max(0, ((now - openedAt) / totalDuration) * 100))
    : 0;
  const markerPosition = elapsed <= 8 ? "marker-near-start" : elapsed >= 92 ? "marker-near-end" : "marker-middle";
  const isMatured = isActive && now > 0 && now >= maturityAt;
  const graceDuration = gracePeriodSeconds === null ? null : Number(gracePeriodSeconds);
  const gracePeriodEnd = graceDuration === null ? null : maturityAt + graceDuration;
  const isInGracePeriod = isMatured && gracePeriodEnd !== null && now < gracePeriodEnd;
  const isAfterGracePeriod = isMatured && gracePeriodEnd !== null && now >= gracePeriodEnd;
  const gracePercent = isInGracePeriod && graceDuration && graceDuration > 0
    ? Math.min(100, ((now - maturityAt) / graceDuration) * 100)
    : 0;

  useEffect(() => {
    if (!provider) return;
    let cancelled = false;
    const fetchTime = async () => {
      try {
        const block = await provider.getBlock("latest");
        if (!cancelled && block) setNow(block.timestamp);
      } catch {
        // Không thay thế thời gian on-chain bằng thời gian máy khi RPC tạm lỗi.
      }
    };
    fetchTime();
    intervalRef.current = setInterval(fetchTime, 15_000);
    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [provider]);

  useEffect(() => {
    if (!contracts) return;
    let cancelled = false;
    contracts.savingCore.gracePeriodSeconds()
      .then((value: bigint) => { if (!cancelled) setGracePeriodSeconds(BigInt(value)); })
      .catch(() => { if (!cancelled) setGracePeriodSeconds(null); });
    return () => { cancelled = true; };
  }, [contracts]);

  useEffect(() => {
    if (!contracts) return;
    let cancelled = false;
    Promise.all([
      contracts.savingCore.calculateInterest(deposit.depositId),
      contracts.savingCore.calculatePenalty(deposit.depositId),
    ])
      .then(([nextInterest, nextPenalty]) => {
        if (!cancelled) {
          setInterest(BigInt(nextInterest));
          setPenalty(BigInt(nextPenalty));
          setValuesError(null);
        }
      })
      .catch(() => { if (!cancelled) setValuesError("Không thể tải lãi/phạt dự kiến từ contract."); });
    return () => { cancelled = true; };
  }, [contracts, deposit.depositId]);

  async function completeAction(action: () => Promise<{ wait: () => Promise<unknown> }>, waitingWallet: string, waitingChain: string, successMessage: string) {
    if (!contracts || submitting) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      setActionStatus(waitingWallet);
      const tx = await action();
      setActionStatus(waitingChain);
      await tx.wait();
      setSuccess(successMessage);
      setActionStatus(null);
      await onActionSuccess();
    } catch (err) {
      setActionStatus(null);
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWithdraw() {
    if (!contracts || !isActive) return;
    if (!isMatured) {
      let currentPenalty = penalty;
      if (currentPenalty === null) {
        try {
          currentPenalty = BigInt(await contracts.savingCore.calculatePenalty(deposit.depositId));
        } catch (err) {
          setError(extractError(err));
          return;
        }
      }
      const payout = deposit.principal - currentPenalty;
      const confirmed = window.confirm(
        `Rút sớm deposit #${deposit.depositId}\n\nGốc: ${formatUnits(deposit.principal, 6)} USDC\nPhạt: ${formatUnits(currentPenalty, 6)} USDC\nNhận dự kiến: ${formatUnits(payout, 6)} USDC\n\nBạn sẽ không nhận lãi khi rút sớm.`,
      );
      if (!confirmed) return;
    }
    await completeAction(
      () => isMatured
        ? contracts.savingCore.withdrawAtMaturity(deposit.depositId)
        : contracts.savingCore.earlyWithdraw(deposit.depositId),
      "Đang chờ MetaMask xác nhận rút tiền...",
      "Đang chờ giao dịch rút tiền được xác nhận...",
      isMatured ? "Đã rút tiền đúng hạn." : "Đã rút tiền sớm.",
    );
  }

  async function handleRenew() {
    if (!contracts || !renewPlanId || !isActive) return;
    await completeAction(
      () => contracts.savingCore.renewDeposit(deposit.depositId, Number(renewPlanId)),
      "Đang chờ MetaMask xác nhận gia hạn...",
      "Đang chờ giao dịch gia hạn được xác nhận...",
      "Đã gia hạn deposit. Khoản mới sẽ xuất hiện sau khi dữ liệu được cập nhật.",
    );
  }

  async function handleAutoRenew() {
    if (!contracts || !isAfterGracePeriod || !isActive) return;
    await completeAction(
      () => contracts.savingCore.autoRenewDeposit(deposit.depositId),
      "Đang chờ MetaMask xác nhận kích hoạt auto-renew...",
      "Đang chờ auto-renew được xác nhận...",
      "Đã kích hoạt auto-renew. Đây là hàm public, không tự chạy khi component render.",
    );
  }

  const maturityDate = new Date(maturityAt * 1000).toLocaleString("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const lifecycleText = !isActive
    ? statusLabels[deposit.status]
    : !isMatured
      ? "Chưa đáo hạn"
      : isInGracePeriod
        ? "Đã đáo hạn, đang trong grace period"
        : isAfterGracePeriod
          ? "Đã hết grace period nhưng deposit vẫn Active"
          : "Đã đáo hạn";

  return (
    <div className={`deposit-card ${isMatured ? "deposit-matured" : ""}`}>
      <div className="deposit-card-header">
        <span className="deposit-id">Deposit #{deposit.depositId.toString()}</span>
        <span className={`deposit-badge ${isActive ? "badge-active" : "badge-history"}`}>{lifecycleText}</span>
      </div>

      <div className="deposit-info-grid">
        <Info label="Số tiền gửi" value={`${formatUnits(deposit.principal, 6)} USDC`} />
        <Info label="Plan" value={plan ? `${plan.tenorDays} ngày` : `Plan #${deposit.planId.toString()}`} />
        <Info label="APR lúc mở" value={`${(deposit.aprBpsAtOpen / 100).toFixed(2)}%`} />
        <Info label="Phạt lúc mở" value={`${(deposit.penaltyBpsAtOpen / 100).toFixed(2)}%`} />
        <Info label="Đáo hạn" value={maturityDate} />
        <Info label="Lãi dự kiến" value={interest === null ? "Đang tải..." : `${formatUnits(interest, 6)} USDC`} />
        <Info label="Phạt dự kiến" value={penalty === null ? "Đang tải..." : `${formatUnits(penalty, 6)} USDC`} />
        <Info label="NFT hiện tại" value={deposit.isCurrentOwner ? "Bạn đang sở hữu" : "Không còn sở hữu"} />
      </div>
      {valuesError && <p className="deposit-card-warning">{valuesError}</p>}
      {deposit.renewedToId !== undefined && <p className="deposit-renew-link">Deposit #{deposit.depositId.toString()} → Deposit #{deposit.renewedToId.toString()}</p>}

      {isActive && (
        <div className="timeline-wrapper">
          <div className="timeline-labels"><span>Ngày mở</span><span>Đáo hạn</span></div>
          <div className="timeline-bar">
            <div className="timeline-fill" style={{ width: `${elapsed}%` }} />
            {now > 0 && elapsed < 100 && (
              <div className={`timeline-marker ${markerPosition}`} style={{ left: `${elapsed}%` }}>
                <span className="timeline-marker-label">Hôm nay</span>
              </div>
            )}
            {isInGracePeriod && <div className="timeline-grace" style={{ width: `${gracePercent * 0.15}%` }}><span className="timeline-grace-label">Grace</span></div>}
          </div>
          <div className="timeline-percent">{elapsed.toFixed(1)}% thời gian đã trôi qua</div>
        </div>
      )}

      {isActive && (
        <div className="deposit-actions">
          {isMatured ? (
            <>
              <button className="btn-withdraw btn-success" onClick={handleWithdraw} disabled={submitting}>
                {submitting ? "Đang xử lý..." : "✅ Rút đúng hạn"}
              </button>
              <div className="renew-group">
                <select className="renew-select" value={renewPlanId} onChange={(event) => setRenewPlanId(event.target.value)} disabled={submitting}>
                  <option value="">Chọn plan mới...</option>
                  {enabledPlans.map((item) => <option key={item.planId} value={item.planId}>Plan {item.planId} — {item.tenorDays} ngày — {(item.aprBps / 100).toFixed(2)}%</option>)}
                </select>
                <button className="btn-withdraw btn-renew" onClick={handleRenew} disabled={submitting || !renewPlanId}>🔄 Gia hạn</button>
              </div>
              {isAfterGracePeriod && <button className="btn-withdraw btn-auto-renew" onClick={handleAutoRenew} disabled={submitting}>Kích hoạt auto-renew</button>}
            </>
          ) : (
            <button className="btn-withdraw btn-danger" onClick={handleWithdraw} disabled={submitting}>
              {submitting ? "Đang xử lý..." : "⚠️ Rút sớm"}
            </button>
          )}
        </div>
      )}

      {actionStatus && <p className="deposit-action-status">{actionStatus}</p>}
      {success && <p className="deposit-card-success">{success}</p>}
      {error && <p className="deposit-card-error">{error}</p>}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="deposit-info-item"><span className="info-label">{label}</span><span className="info-value">{value}</span></div>;
}
