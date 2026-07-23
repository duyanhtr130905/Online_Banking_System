import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useContracts } from "../hooks/useContracts";
import type { Plan } from "../types";

interface PlansContextValue {
  plans: Plan[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const PlansContext = createContext<PlansContextValue | null>(null);

export function PlansProvider({ children }: { children: ReactNode }) {
  const contracts = useContracts();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!contracts) {
      if (mountedRef.current) {
        setPlans([]);
        setError(null);
      }
      return;
    }
    setLoading(true);
    setError(null);
    const result: Plan[] = [];
    const maxPlansToScan = 1_000;
    for (let i = 0; i < maxPlansToScan; i++) {
      try {
        const p = await contracts.savingCore.getPlan(i);
        result.push({
          planId: i,
          tenorDays: Number(p.tenorDays),
          aprBps: Number(p.aprBps),
          earlyWithdrawPenaltyBps: Number(p.earlyWithdrawPenaltyBps),
          minDeposit: BigInt(p.minDeposit),
          maxDeposit: BigInt(p.maxDeposit),
          enabled: p.enabled,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/plan does not exist/i.test(message)) {
          if (mountedRef.current) {
            setPlans(result);
            setLoading(false);
          }
          return;
        }
        if (mountedRef.current) {
          setError("Không thể cập nhật danh sách plan mới. Dữ liệu hiện có vẫn đang được hiển thị.");
          setLoading(false);
        }
        return;
      }
    }
    if (mountedRef.current) {
      setError("Danh sách plan vượt giới hạn quét an toàn. Vui lòng kiểm tra RPC.");
      setLoading(false);
    }
  }, [contracts]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <PlansContext.Provider value={{ plans, loading, error, refresh }}>
      {children}
    </PlansContext.Provider>
  );
}

export function usePlansContext(): PlansContextValue {
  const ctx = useContext(PlansContext);
  if (!ctx) throw new Error("usePlansContext phải nằm trong <PlansProvider>");
  return ctx;
}
