import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { EventLog } from "ethers";
import { useContracts } from "../hooks/useContracts";
import { useWalletContext } from "./WalletContext";
import { DEPLOY_BLOCK } from "../contracts";
import type { Plan } from "../types";
import { queryLogsInChunks } from "../utils/queryLogsInChunks";

interface PlansContextValue {
  plans: Plan[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const PlansContext = createContext<PlansContextValue | null>(null);

function isPlanNotFoundError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const error = err as Record<string, unknown>;
  const info = error.info as Record<string, unknown> | undefined;
  const nestedError = info?.error as Record<string, unknown> | undefined;
  return [error.reason, error.shortMessage, error.message, nestedError?.message]
    .some((message) => typeof message === "string" && /plan does not exist/i.test(message));
}

export function PlansProvider({ children }: { children: ReactNode }) {
  const contracts = useContracts();
  const { chainId } = useWalletContext();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!contracts || !chainId) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setPlans([]);
        setError(null);
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const currentBlock = await contracts.savingCore.runner!.provider!.getBlockNumber();
      const planCreatedEvents = await queryLogsInChunks(
        contracts.savingCore,
        contracts.savingCore.filters.PlanCreated(),
        DEPLOY_BLOCK[chainId] ?? 0,
        currentBlock,
      );
      const planIds = new Set<number>();
      for (const event of planCreatedEvents) {
        if (event instanceof EventLog) {
          planIds.add(Number(event.args.planId));
        }
      }

      const sortedPlanIds = Array.from(planIds).sort((a, b) => a - b);
      const results = await Promise.all(sortedPlanIds.map(async (planId): Promise<Plan | null> => {
        try {
          const plan = await contracts.savingCore.getPlan(planId);
          return {
            planId,
            tenorDays: Number(plan.tenorDays),
            aprBps: Number(plan.aprBps),
            earlyWithdrawPenaltyBps: Number(plan.earlyWithdrawPenaltyBps),
            minDeposit: BigInt(plan.minDeposit),
            maxDeposit: BigInt(plan.maxDeposit),
            enabled: plan.enabled,
          };
        } catch (err) {
          // Event là nguồn ID chính; chỉ bỏ qua ID thật sự không còn tồn tại, không che lỗi RPC.
          if (isPlanNotFoundError(err)) return null;
          throw err;
        }
      }));

      if (mountedRef.current && requestId === requestIdRef.current) {
        setPlans(results.filter((plan): plan is Plan => plan !== null));
      }
    } catch {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setError("Không thể cập nhật danh sách plan mới. Dữ liệu hiện có vẫn đang được hiển thị.");
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [chainId, contracts]);

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
