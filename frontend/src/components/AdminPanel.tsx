import { useState, useEffect, useCallback, type FormEvent } from "react";
import { isAddress, parseUnits, ZeroAddress } from "ethers";
import { useContracts } from "../hooks/useContracts";
import { useRole } from "../hooks/useRole";
import { useWalletContext } from "../contexts/WalletContext";
import { usePlansContext } from "../contexts/PlansContext";
import { extractError } from "../utils/errors";
import { ActivityHistory } from "./ActivityHistory";
import "./AdminPanel.css";

export function AdminPanel() {
  const contracts = useContracts();
  const { account } = useWalletContext();
  const { isAdmin, loading: roleLoading } = useRole(contracts?.savingCore ?? null, account);

  if (roleLoading || !isAdmin) return null;
  return (
    <section className="admin-section">
      <h2 className="admin-title">🔐 Admin Panel — SavingCore</h2>
      <div className="admin-grid">
        <CreatePlanForm />
        <SystemSettings />
      </div>
      <ActivityHistory mode="admin" />
    </section>
  );
}

function CreatePlanForm() {
  const contracts = useContracts();
  const { refresh } = usePlansContext();
  const [tenorDays, setTenorDays] = useState("");
  const [aprBps, setAprBps] = useState("");
  const [penaltyBps, setPenaltyBps] = useState("");
  const [minDeposit, setMinDeposit] = useState("");
  const [maxDeposit, setMaxDeposit] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!contracts || submitting) return;
    setError(null); setSuccess(null); setSubmitting(true);
    try {
      const minAmount = minDeposit ? parseUnits(minDeposit, 6) : 0n;
      const maxAmount = maxDeposit ? parseUnits(maxDeposit, 6) : 0n;
      setStatus("Đang chờ MetaMask xác nhận tạo plan...");
      const tx = await contracts.savingCore.createPlan(Number(tenorDays), Number(aprBps), Number(penaltyBps), minAmount, maxAmount);
      setStatus("Đang chờ tạo plan được xác nhận...");
      await tx.wait();
      setSuccess("Tạo plan thành công.");
      setTenorDays(""); setAprBps(""); setPenaltyBps(""); setMinDeposit(""); setMaxDeposit("");
      await refresh();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setStatus(null); setSubmitting(false);
    }
  }

  return (
    <div className="admin-card">
      <h3 className="admin-card-title">Tạo gói tiết kiệm mới</h3>
      <form className="admin-form" onSubmit={handleSubmit}>
        <NumberInput label="Tenor (ngày)" value={tenorDays} onChange={setTenorDays} min="1" placeholder="VD: 90" />
        <NumberInput label="APR (bps)" value={aprBps} onChange={setAprBps} min="1" max="9999" placeholder="VD: 400 = 4.00%" />
        <NumberInput label="Penalty rút sớm (bps)" value={penaltyBps} onChange={setPenaltyBps} min="0" max="9999" placeholder="VD: 400 = 4.00%" />
        <TextInput label="Min Deposit (USDC, 0 = không có mức tối thiểu)" value={minDeposit} onChange={setMinDeposit} placeholder="VD: 100" />
        <TextInput label="Max Deposit (USDC, 0 = không giới hạn)" value={maxDeposit} onChange={setMaxDeposit} placeholder="0" />
        <button className="btn-primary" type="submit" disabled={submitting}>{submitting ? "Đang xử lý..." : "Tạo Plan"}</button>
      </form>
      <Messages status={status} error={error} success={success} />
    </div>
  );
}

function SystemSettings() {
  const contracts = useContracts();
  const [feeReceiver, setFeeReceiver] = useState("");
  const [graceValue, setGraceValue] = useState("");
  const [graceUnit, setGraceUnit] = useState<"days" | "hours" | "seconds">("days");
  const [paused, setPaused] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refreshSettings = useCallback(async () => {
    if (!contracts) return;
    try {
      const [receiver, grace, isPaused] = await Promise.all([
        contracts.savingCore.feeReceiver(),
        contracts.savingCore.gracePeriodSeconds(),
        contracts.savingCore.paused(),
      ]);
      setFeeReceiver(receiver);
      const seconds = BigInt(grace);
      if (seconds % 86_400n === 0n) {
        setGraceUnit("days"); setGraceValue((seconds / 86_400n).toString());
      } else if (seconds % 3_600n === 0n) {
        setGraceUnit("hours"); setGraceValue((seconds / 3_600n).toString());
      } else {
        setGraceUnit("seconds"); setGraceValue(seconds.toString());
      }
      setPaused(isPaused);
    } catch (err) {
      setError(extractError(err));
    }
  }, [contracts]);

  useEffect(() => { refreshSettings(); }, [refreshSettings]);

  async function run(action: () => Promise<{ wait: () => Promise<unknown> }>, walletStatus: string, successMessage: string) {
    if (submitting) return;
    setError(null); setSuccess(null); setSubmitting(true);
    try {
      setStatus(walletStatus);
      const tx = await action();
      setStatus("Đang chờ giao dịch được xác nhận...");
      await tx.wait();
      setSuccess(successMessage);
      await refreshSettings();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setStatus(null); setSubmitting(false);
    }
  }

  async function updateFeeReceiver(event: FormEvent) {
    event.preventDefault();
    if (!contracts) return;
    if (!isAddress(feeReceiver) || feeReceiver.toLowerCase() === ZeroAddress.toLowerCase()) {
      setError("Fee receiver phải là địa chỉ ví hợp lệ và không được là zero address.");
      return;
    }
    await run(() => contracts.savingCore.setFeeReceiver(feeReceiver), "Đang chờ MetaMask xác nhận fee receiver...", "Đã cập nhật fee receiver.");
  }

  async function updateGracePeriod(event: FormEvent) {
    event.preventDefault();
    if (!contracts) return;
    if (!/^\d+$/.test(graceValue) || BigInt(graceValue) <= 0n) {
      setError("Grace period phải là số nguyên lớn hơn 0.");
      return;
    }
    const multiplier = graceUnit === "days" ? 86_400n : graceUnit === "hours" ? 3_600n : 1n;
    await run(
      () => contracts.savingCore.setGracePeriod(BigInt(graceValue) * multiplier),
      "Đang chờ MetaMask xác nhận grace period...",
      "Đã cập nhật grace period.",
    );
  }

  return (
    <div className="admin-card">
      <h3 className="admin-card-title">Cài đặt hệ thống SavingCore</h3>
      <p className="admin-readonly">Trạng thái SavingCore: {paused === null ? "Đang tải..." : paused ? "⏸ Đang tạm dừng" : "✅ Đang hoạt động"}</p>
      <button className={`btn-primary ${paused ? "btn-success" : "btn-danger"}`} onClick={() => contracts && run(() => paused ? contracts.savingCore.unpause() : contracts.savingCore.pause(), paused ? "Đang chờ MetaMask xác nhận mở hệ thống..." : "Đang chờ MetaMask xác nhận tạm dừng...", paused ? "Đã mở lại SavingCore." : "Đã tạm dừng SavingCore.")} disabled={submitting || paused === null}>
        {paused ? "Unpause SavingCore" : "Pause SavingCore"}
      </button>
      <form className="admin-form admin-subform" onSubmit={updateFeeReceiver}>
        <TextInput label="Fee receiver" value={feeReceiver} onChange={setFeeReceiver} placeholder="0x..." />
        <button className="btn-primary" type="submit" disabled={submitting}>Cập nhật fee receiver</button>
      </form>
      <form className="admin-form admin-subform" onSubmit={updateGracePeriod}>
        <label className="admin-label">Grace period
          <div className="admin-inline-fields">
            <input className="admin-input" type="number" min="1" step="1" value={graceValue} onChange={(event) => setGraceValue(event.target.value)} required />
            <select className="admin-input" value={graceUnit} onChange={(event) => setGraceUnit(event.target.value as "days" | "hours" | "seconds")}> 
              <option value="days">Ngày</option><option value="hours">Giờ</option><option value="seconds">Giây</option>
            </select>
          </div>
        </label>
        <button className="btn-primary" type="submit" disabled={submitting}>Cập nhật grace period</button>
      </form>
      <Messages status={status} error={error} success={success} />
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="admin-label">{label}<input className="admin-input" type="text" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required /></label>;
}

function NumberInput({ label, value, onChange, min, max, placeholder }: { label: string; value: string; onChange: (value: string) => void; min: string; max?: string; placeholder: string }) {
  return <label className="admin-label">{label}<input className="admin-input" type="number" min={min} max={max} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required /></label>;
}

function Messages({ status, error, success }: { status: string | null; error: string | null; success: string | null }) {
  return <>{status && <p className="admin-status">{status}</p>}{error && <p className="admin-error">{error}</p>}{success && <p className="admin-success">{success}</p>}</>;
}
