import { useState, useCallback, useEffect, useRef } from "react";
import { EventLog } from "ethers";
import { useContracts } from "./useContracts";
import { useWalletContext } from "../contexts/WalletContext";
import { DEPLOY_BLOCK } from "../contracts";
import { DepositStatus } from "../types";
import type { Deposit } from "../types";

/**
 * SavingCore không có ERC721Enumerable, nên event Transfer là nguồn danh sách token
 * mà account từng nhận. Status của Deposit vẫn luôn được đọc lại từ contract để phân
 * biệt quyền sở hữu NFT hiện tại và lịch sử nghiệp vụ đã kết thúc.
 */
export function useMyDeposits() {
  const contracts = useContracts();
  const { account, chainId } = useWalletContext();
  const [activeDeposits, setActiveDeposits] = useState<Deposit[]>([]);
  const [historicalDeposits, setHistoricalDeposits] = useState<Deposit[]>([]);
  const [loadedAccount, setLoadedAccount] = useState<string | null>(null);
  const [loadedChainId, setLoadedChainId] = useState<number | null>(null);
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
    if (!contracts || !account || !chainId) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setActiveDeposits([]);
        setHistoricalDeposits([]);
        setLoadedAccount(null);
        setLoadedChainId(null);
        setError(null);
      }
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const fromBlock = DEPLOY_BLOCK[chainId] ?? 0;
      const candidateIds = new Set<bigint>();
      const transferEvents = await contracts.savingCore.queryFilter(
        contracts.savingCore.filters.Transfer(null, account),
        fromBlock,
      );
      for (const ev of transferEvents) {
        if (ev instanceof EventLog) candidateIds.add(BigInt(ev.args.tokenId));
      }

      // Liên kết chỉ được hiển thị khi chính event Renewed xác nhận ID mới.
      const renewedTo = new Map<bigint, bigint>();
      const renewEvents = await contracts.savingCore.queryFilter(
        contracts.savingCore.filters.Renewed(),
        fromBlock,
      );
      for (const ev of renewEvents) {
        if (ev instanceof EventLog) {
          renewedTo.set(BigInt(ev.args.oldDepositId), BigInt(ev.args.newDepositId));
        }
      }

      const records = await Promise.all(
        Array.from(candidateIds).map(async (id): Promise<Deposit | null> => {
          try {
            const d = await contracts.savingCore.getDeposit(id);
            let isCurrentOwner = false;
            try {
              const owner: string = await contracts.savingCore.ownerOf(id);
              isCurrentOwner = owner.toLowerCase() === account.toLowerCase();
            } catch {
              // Withdraw/renew burn NFT cũ; trạng thái Deposit vẫn cần được giữ trong lịch sử.
            }
            return {
              depositId: id,
              planId: BigInt(d.planId),
              principal: BigInt(d.principal),
              maturityAt: BigInt(d.maturityAt),
              aprBpsAtOpen: Number(d.aprBpsAtOpen),
              penaltyBpsAtOpen: Number(d.penaltyBpsAtOpen),
              status: Number(d.status) as DepositStatus,
              isCurrentOwner,
              renewedToId: renewedTo.get(id),
            };
          } catch {
            return null;
          }
        }),
      );

      const results = records
        .filter((record): record is Deposit => record !== null)
        .sort((a, b) => (a.depositId < b.depositId ? -1 : 1));
      const nextActive = results.filter(
        (deposit) => deposit.status === DepositStatus.Active && deposit.isCurrentOwner,
      );
      const nextHistory = results.filter((deposit) => deposit.status !== DepositStatus.Active);

      if (mountedRef.current && requestId === requestIdRef.current) {
        setActiveDeposits(nextActive);
        setHistoricalDeposits(nextHistory);
        setLoadedAccount(account);
        setLoadedChainId(chainId);
        if (records.some((record) => record === null)) {
          setError("Không thể đọc đầy đủ dữ liệu deposit mới. Dữ liệu hiện có vẫn đang được hiển thị.");
        }
      }
    } catch {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setError("Không thể cập nhật dữ liệu deposit mới. Dữ liệu hiện có vẫn đang được hiển thị.");
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, [account, chainId, contracts]);

  useEffect(() => {
    requestIdRef.current += 1;
    setActiveDeposits([]);
    setHistoricalDeposits([]);
    setLoadedAccount(null);
    setLoadedChainId(null);
    setError(null);
  }, [account, chainId, contracts]);

  useEffect(() => { refresh(); }, [refresh]);

  const isCurrentAccountData = loadedAccount === account && loadedChainId === chainId;
  const currentActiveDeposits = isCurrentAccountData ? activeDeposits : [];
  const currentHistoricalDeposits = isCurrentAccountData ? historicalDeposits : [];

  return {
    deposits: currentActiveDeposits,
    activeDeposits: currentActiveDeposits,
    historicalDeposits: currentHistoricalDeposits,
    loading,
    error,
    refresh,
  };
}
