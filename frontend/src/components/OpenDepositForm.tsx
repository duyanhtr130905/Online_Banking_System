import { useState, useMemo, useEffect, useCallback, type FormEvent } from "react";
import { parseUnits, formatUnits } from "ethers";
import { useContracts } from "../hooks/useContracts";
import { useWalletContext } from "../contexts/WalletContext";
import { usePlansContext } from "../contexts/PlansContext";
import { useAccountDataContext } from "../contexts/AccountDataContext";
import { ADDRESSES } from "../contracts";
import { extractError } from "../utils/errors";
import "./OpenDepositForm.css";

export function OpenDepositForm() {
  const contracts = useContracts();
  const { account, chainId } = useWalletContext();
  const { plans } = usePlansContext();
  const { usdcBalance, balanceLoading, balanceError, refreshBalance, refreshDeposits } = useAccountDataContext();
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [allowanceError, setAllowanceError] = useState<string | null>(null);

  const enabledPlans = useMemo(() => plans.filter((plan) => plan.enabled), [plans]);
  const selectedPlan = useMemo(
    () => enabledPlans.find((plan) => plan.planId === Number(selectedPlanId)),
    [enabledPlans, selectedPlanId],
  );

  const refreshAllowance = useCallback(async () => {
    if (!contracts || !account || !chainId) {
      setAllowance(null);
      return;
    }
    const savingCoreAddress = ADDRESSES[chainId]?.SavingCore;
    if (!savingCoreAddress) return;
    try {
      setAllowance(BigInt(await contracts.mockUSDC.allowance(account, savingCoreAddress)));
      setAllowanceError(null);
    } catch {
      setAllowanceError("Không thể cập nhật allowance hiện tại.");
    }
  }, [account, chainId, contracts]);

  useEffect(() => { refreshAllowance(); }, [refreshAllowance]);

  const inputError = useMemo(() => {
    if (!amount || !selectedPlan) return null;
    let amountWei: bigint;
    try {
      amountWei = parseUnits(amount, 6);
    } catch {
      return "Số tiền không hợp lệ";
    }
    if (amountWei <= 0n) return "Số tiền phải lớn hơn 0";
    if (selectedPlan.minDeposit > 0n && amountWei < selectedPlan.minDeposit) {
      return `Tối thiểu: ${formatUnits(selectedPlan.minDeposit, 6)} USDC`;
    }
    if (selectedPlan.maxDeposit > 0n && amountWei > selectedPlan.maxDeposit) {
      return `Tối đa: ${formatUnits(selectedPlan.maxDeposit, 6)} USDC`;
    }
    if (usdcBalance !== null && amountWei > usdcBalance) {
      return `Số dư không đủ. Số dư hiện tại: ${formatUnits(usdcBalance, 6)} USDC`;
    }
    return null;
  }, [amount, selectedPlan, usdcBalance]);

  const canSubmit = !!selectedPlan
    && amount.trim().length > 0
    && usdcBalance !== null
    && !balanceLoading
    && !inputError
    && !submitting;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!contracts || !account || !chainId || !selectedPlan || !canSubmit) return;
    setError(null); setStatus(null); setTxHash(null); setSubmitting(true);
    try {
      const amountWei = parseUnits(amount, 6);
      // Số dư có thể đổi sau khi UI validate, nên chặn lại trước cả approve lẫn MetaMask.
      if (usdcBalance === null || amountWei > usdcBalance) {
        setError(`Số dư không đủ. Số dư hiện tại: ${formatUnits(usdcBalance ?? 0n, 6)} USDC`);
        return;
      }
      const savingCoreAddress = ADDRESSES[chainId]?.SavingCore;
      if (!savingCoreAddress) throw new Error("Không tìm thấy địa chỉ SavingCore của mạng hiện tại.");

      setStatus("Đang kiểm tra allowance...");
      const currentAllowance = BigInt(await contracts.mockUSDC.allowance(account, savingCoreAddress));
      if (currentAllowance < amountWei) {
        setStatus("Đang chờ MetaMask xác nhận approve USDC...");
        const approveTx = await contracts.mockUSDC.approve(savingCoreAddress, amountWei);
        setStatus("Đang chờ approve được xác nhận trên blockchain...");
        await approveTx.wait();
      }

      setStatus("Đang chờ MetaMask xác nhận khoản gửi...");
      const depositTx = await contracts.savingCore.openDeposit(selectedPlan.planId, amountWei);
      setStatus("Đang chờ khoản gửi được xác nhận trên blockchain...");
      const receipt = await depositTx.wait();
      setTxHash(receipt.hash);
      setStatus("Gửi tiền thành công!");
      setAmount("");
      await Promise.all([refreshBalance(), refreshAllowance(), refreshDeposits()]);
    } catch (err) {
      setError(extractError(err));
      setStatus(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (!contracts) {
    return <section className="deposit-section"><h2 className="section-title">💰 Gửi tiết kiệm</h2><p className="deposit-empty">Đang chờ kết nối ví</p></section>;
  }

  return (
    <section className="deposit-section">
      <h2 className="section-title">💰 Gửi tiết kiệm</h2>
      <div className="deposit-layout">
        <form className="deposit-form" onSubmit={handleSubmit}>
          <label className="deposit-label">Chọn gói tiết kiệm
            <select className="deposit-select" value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)} required>
              <option value="">-- Chọn plan --</option>
              {enabledPlans.map((plan) => <option key={plan.planId} value={plan.planId}>Plan {plan.planId} — {plan.tenorDays} ngày — APR {(plan.aprBps / 100).toFixed(2)}%</option>)}
            </select>
          </label>
          <label className="deposit-label">Số tiền (USDC)
            <input className={`deposit-input ${inputError ? "input-error" : ""}`} type="text" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="VD: 1000" required />
            {inputError && <span className="field-error">{inputError}</span>}
          </label>
          <button className="btn-deposit" type="submit" disabled={!canSubmit}>
            {submitting ? (status ?? "Đang xử lý...") : "Gửi tiền"}
          </button>
        </form>

        <aside className="deposit-sidebar">
          <div className="deposit-balance-row">
            <span>Số dư MockUSDC</span>
            <strong>{balanceLoading || usdcBalance === null ? "Đang tải..." : `${formatUnits(usdcBalance, 6)} USDC`}</strong>
            <button className="btn-refresh" type="button" onClick={refreshBalance} disabled={balanceLoading}>Làm mới số dư</button>
          </div>
          {balanceError && <p className="deposit-error">{balanceError}</p>}
          {selectedPlan && <div className="plan-info">
            <strong>Thông tin plan đã chọn</strong>
            <span>Min: {selectedPlan.minDeposit > 0n ? `${formatUnits(selectedPlan.minDeposit, 6)} USDC` : "Không có mức tối thiểu"}</span>
            <span>Max: {selectedPlan.maxDeposit > 0n ? `${formatUnits(selectedPlan.maxDeposit, 6)} USDC` : "Không giới hạn"}</span>
          </div>}
          {allowance !== null && <p className="deposit-allowance">Allowance cho SavingCore: {formatUnits(allowance, 6)} USDC</p>}
          {allowanceError && <p className="field-error">{allowanceError}</p>}
        </aside>
      </div>
      {status && !error && <div className="deposit-status"><p>{status}</p>{txHash && chainId === 11155111 && <a className="tx-link" href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer">Xem trên Etherscan ↗</a>}{txHash && chainId !== 11155111 && <p className="tx-hash">TX: {txHash}</p>}</div>}
      {error && <p className="deposit-error">{error}</p>}
    </section>
  );
}
