import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useContracts } from "../hooks/useContracts";
import { useMyDeposits } from "../hooks/useMyDeposits";
import { useWalletContext } from "./WalletContext";
import type { Deposit } from "../types";

interface AccountDataContextValue {
  usdcBalance: bigint | null;
  balanceLoading: boolean;
  balanceError: string | null;
  refreshBalance: () => Promise<void>;
  activeDeposits: Deposit[];
  historicalDeposits: Deposit[];
  depositsLoading: boolean;
  depositsError: string | null;
  refreshDeposits: () => Promise<void>;
}

const AccountDataContext = createContext<AccountDataContextValue | null>(null);

export function AccountDataProvider({ children }: { children: ReactNode }) {
  const contracts = useContracts();
  const { account } = useWalletContext();
  const deposits = useMyDeposits();
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!contracts || !account) {
      if (mountedRef.current) {
        setUsdcBalance(null);
        setBalanceError(null);
      }
      return;
    }
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const nextBalance = await contracts.mockUSDC.balanceOf(account);
      if (mountedRef.current) setUsdcBalance(BigInt(nextBalance));
    } catch {
      if (mountedRef.current) {
        setBalanceError("Không thể cập nhật số dư USDC mới. Dữ liệu hiện có vẫn đang được hiển thị.");
      }
    } finally {
      if (mountedRef.current) setBalanceLoading(false);
    }
  }, [account, contracts]);

  useEffect(() => { refreshBalance(); }, [refreshBalance]);

  return (
    <AccountDataContext.Provider value={{
      usdcBalance,
      balanceLoading,
      balanceError,
      refreshBalance,
      activeDeposits: deposits.activeDeposits,
      historicalDeposits: deposits.historicalDeposits,
      depositsLoading: deposits.loading,
      depositsError: deposits.error,
      refreshDeposits: deposits.refresh,
    }}>
      {children}
    </AccountDataContext.Provider>
  );
}

export function useAccountDataContext(): AccountDataContextValue {
  const ctx = useContext(AccountDataContext);
  if (!ctx) throw new Error("useAccountDataContext phải nằm trong <AccountDataProvider>");
  return ctx;
}
