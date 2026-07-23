import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatUnits, parseUnits } from "ethers";
import { useContracts } from "../hooks/useContracts";
import { useRole } from "../hooks/useRole";
import { useWalletContext } from "../contexts/WalletContext";
import { ADDRESSES } from "../contracts";
import { extractError } from "../utils/errors";
import { useAccountDataContext } from "../contexts/AccountDataContext";
import "./VaultAdminPanel.css";

export function VaultAdminPanel() {
  const contracts = useContracts();
  const { account, chainId } = useWalletContext();
  const { isAdmin, loading: roleLoading } = useRole(contracts?.savingCore ?? null, account);
  const { refreshBalance } = useAccountDataContext();
  const [vaultBalance, setVaultBalance] = useState<bigint | null>(null);
  const [vaultPaused, setVaultPaused] = useState<boolean | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [fundAmount, setFundAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const vaultAddress = chainId ? ADDRESSES[chainId]?.VaultManager : undefined;
  const refresh = useCallback(async () => {
    if (!contracts || !account || !vaultAddress) return;
    try {
      const [balance, paused, nextAllowance] = await Promise.all([
        contracts.mockUSDC.balanceOf(vaultAddress),
        contracts.vaultManager.paused(),
        contracts.mockUSDC.allowance(account, vaultAddress),
      ]);
      setVaultBalance(BigInt(balance));
      setVaultPaused(paused);
      setAllowance(BigInt(nextAllowance));
    } catch {
      setError("Không thể cập nhật dữ liệu VaultManager mới.");
    }
  }, [account, contracts, vaultAddress]);

  useEffect(() => { refresh(); }, [refresh]);

  async function run(action: () => Promise<{ wait: () => Promise<unknown> }>, walletStatus: string, successMessage: string) {
    if (submitting) return;
    setError(null); setSuccess(null); setSubmitting(true);
    try {
      setStatus(walletStatus);
      const tx = await action();
      setStatus("Đang chờ giao dịch được xác nhận trên blockchain...");
      await tx.wait();
      setSuccess(successMessage);
      await Promise.all([refresh(), refreshBalance()]);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setStatus(null); setSubmitting(false);
    }
  }

  async function fund(event: FormEvent) {
    event.preventDefault();
    if (!contracts || !account || !vaultAddress) return;
    let amount: bigint;
    try { amount = parseUnits(fundAmount, 6); } catch { setError("Số tiền fund không hợp lệ."); return; }
    if (amount <= 0n) { setError("Số tiền fund phải lớn hơn 0."); return; }
    if (submitting) return;
    setError(null); setSuccess(null); setSubmitting(true);
    try {
      const currentAllowance = await contracts.mockUSDC.allowance(account, vaultAddress);
      if (BigInt(currentAllowance) < amount) {
        setStatus("Đang chờ MetaMask xác nhận approve cho VaultManager...");
        const approveTx = await contracts.mockUSDC.approve(vaultAddress, amount);
        setStatus("Đang chờ approve được xác nhận...");
        await approveTx.wait();
      }
      setStatus("Đang chờ MetaMask xác nhận fund vault...");
      const tx = await contracts.vaultManager.fundVault(amount);
      setStatus("Đang chờ fund vault được xác nhận...");
      await tx.wait();
      setFundAmount("");
      setSuccess("Đã fund VaultManager.");
      await Promise.all([refresh(), refreshBalance()]);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setStatus(null); setSubmitting(false);
    }
  }

  async function withdraw(event: FormEvent) {
    event.preventDefault();
    if (!contracts || vaultBalance === null) return;
    let amount: bigint;
    try { amount = parseUnits(withdrawAmount, 6); } catch { setError("Số tiền rút vault không hợp lệ."); return; }
    if (amount <= 0n) { setError("Số tiền rút vault phải lớn hơn 0."); return; }
    if (amount > vaultBalance) { setError("Số tiền rút vượt quá số dư VaultManager đang hiển thị."); return; }
    await run(
      () => contracts.vaultManager.withdrawVault(amount),
      "Đang chờ MetaMask xác nhận rút vault...",
      "Đã rút USDC từ VaultManager.",
    );
    setWithdrawAmount("");
  }

  if (roleLoading || !isAdmin) return null;
  return (
    <section className="vault-admin-section">
      <h2 className="vault-admin-title">🏛️ Vault Admin Panel</h2>
      <div className="vault-summary">
        <span>Số dư token VaultManager: <strong>{vaultBalance === null ? "Đang tải..." : `${formatUnits(vaultBalance, 6)} USDC`}</strong></span>
        <span>Trạng thái VaultManager: <strong className={vaultPaused ? "vault-paused" : "vault-active"}>{vaultPaused === null ? "Đang tải..." : vaultPaused ? "⏸ Đang tạm dừng" : "✅ Đang hoạt động"}</strong></span>
        <span>Allowance hiện tại: <strong>{allowance === null ? "Đang tải..." : `${formatUnits(allowance, 6)} USDC`}</strong></span>
      </div>
      <div className="vault-admin-grid">
        <form className="vault-card" onSubmit={fund}>
          <h3>Fund vault</h3>
          <input className="admin-input" value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} placeholder="Số USDC" required />
          <button className="btn-primary" type="submit" disabled={submitting}>Fund Vault</button>
        </form>
        <form className="vault-card" onSubmit={withdraw}>
          <h3>Withdraw vault</h3>
          <input className="admin-input" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} placeholder="Số USDC" required />
          <button className="btn-primary btn-danger" type="submit" disabled={submitting || vaultBalance === null}>Withdraw Vault</button>
        </form>
        <div className="vault-card">
          <h3>Pause VaultManager</h3>
          <p>Trạng thái này độc lập với SavingCore.</p>
          <button className={`btn-primary ${vaultPaused ? "btn-success" : "btn-danger"}`} onClick={() => contracts && run(() => vaultPaused ? contracts.vaultManager.unpause() : contracts.vaultManager.pause(), vaultPaused ? "Đang chờ MetaMask xác nhận mở VaultManager..." : "Đang chờ MetaMask xác nhận tạm dừng VaultManager...", vaultPaused ? "Đã mở lại VaultManager." : "Đã tạm dừng VaultManager.")} disabled={submitting || vaultPaused === null}>
            {vaultPaused ? "Unpause VaultManager" : "Pause VaultManager"}
          </button>
        </div>
      </div>
      {status && <p className="vault-status">{status}</p>}
      {error && <p className="vault-error">{error}</p>}
      {success && <p className="vault-success">{success}</p>}
    </section>
  );
}
