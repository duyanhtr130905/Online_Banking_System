import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Contract, EventLog, ZeroAddress, formatUnits, id, type Provider } from "ethers";
import { ABIS, ADDRESSES, DEPLOY_BLOCK } from "../contracts";
import { useWalletContext } from "../contexts/WalletContext";
import "./ActivityHistory.css";

export type ActivityEntry = {
  id: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  timestamp: number;
  category: "USER" | "ADMIN" | "SYSTEM";
  action: string;
  actor?: string;
  account?: string;
  depositId?: bigint;
  planId?: bigint;
  amount?: bigint;
  details: string;
};

type ActivityMode = "user" | "admin";
type ActivityFilter = "ALL" | ActivityEntry["category"];
type Source = "SavingCore" | "VaultManager";
type PendingActivity = ActivityEntry & { relatedAddresses: string[]; needsTransactionActor?: boolean };
type NamedLog = { source: Source; eventName: string; log: EventLog };

const CHUNK_SIZE = 5_000;
const INITIAL_LIMIT = 5;
const CONCURRENCY = 4;
const ADMIN_ROLE = id("ADMIN_ROLE").toLowerCase();
const DEFAULT_ADMIN_ROLE = `0x${"0".repeat(64)}`;

function asBigInt(value: unknown): bigint { return BigInt(value as bigint | number | string); }
function asAddress(value: unknown): string { return typeof value === "string" ? value : ""; }
function isZeroAddress(address: string): boolean { return address.toLowerCase() === ZeroAddress.toLowerCase(); }
function shortAddress(address?: string): string { return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "—"; }
function shortHash(hash: string): string { return `${hash.slice(0, 10)}...${hash.slice(-8)}`; }
function usdc(value?: bigint): string { return value === undefined ? "—" : `${formatUnits(value, 6)} USDC`; }
function bps(value: bigint): string { return `${(Number(value) / 100).toFixed(2)}%`; }
function getArg(log: EventLog, name: string): unknown { return (log.args as Record<string, unknown>)[name]; }

function roleLabel(role: string): string {
  const normalized = role.toLowerCase();
  if (normalized === ADMIN_ROLE) return "ADMIN_ROLE";
  if (normalized === DEFAULT_ADMIN_ROLE) return "DEFAULT_ADMIN_ROLE";
  return shortAddress(role);
}

async function mapWithConcurrency<T, R>(values: readonly T[], mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, values.length) }, worker));
  return results;
}

async function queryContractEventsSafely(contract: Contract, source: Source, fromBlock: number, toBlock: number) {
  try {
    const logs = await contract.queryFilter("*", fromBlock, toBlock);
    return {
      successfulRequests: 1,
      logs: logs
        .filter((log): log is EventLog => log instanceof EventLog)
        .map((log) => ({ source, eventName: log.eventName, log })),
    };
  } catch {
    // Lỗi một contract/range không làm mất log đã lấy được từ contract còn lại.
    return { successfulRequests: 0, logs: [] as NamedLog[] };
  }
}

function baseEntry(log: EventLog, category: ActivityEntry["category"], action: string, details: string): PendingActivity {
  return { id: `${log.transactionHash}-${log.index}`, blockNumber: log.blockNumber, transactionHash: log.transactionHash, logIndex: log.index, timestamp: 0, category, action, details, relatedAddresses: [] };
}

function addRelated(entry: PendingActivity, ...addresses: Array<string | undefined>) {
  entry.relatedAddresses.push(...addresses.filter((address): address is string => Boolean(address)));
}

function transferMintRecipients(logs: NamedLog[]): Map<string, string> {
  const recipients = new Map<string, string>();
  for (const item of logs) {
    if (item.source !== "SavingCore" || item.eventName !== "Transfer") continue;
    const from = asAddress(getArg(item.log, "from"));
    const to = asAddress(getArg(item.log, "to"));
    if (isZeroAddress(from) && !isZeroAddress(to)) recipients.set(`${item.log.transactionHash}-${asBigInt(getArg(item.log, "tokenId"))}`, to);
  }
  return recipients;
}

function makeActivity(item: NamedLog, mintRecipients: Map<string, string>): PendingActivity | null {
  const { log, source, eventName } = item;
  if (source === "SavingCore") {
    if (eventName === "PlanCreated") {
      const planId = asBigInt(getArg(log, "planId")); const tenorDays = asBigInt(getArg(log, "tenorDays")); const aprBps = asBigInt(getArg(log, "aprBps"));
      const entry = baseEntry(log, "ADMIN", `Admin tạo Plan #${planId}`, `Kỳ hạn ${tenorDays} ngày, APR ${bps(aprBps)}.`);
      entry.planId = planId; entry.needsTransactionActor = true; return entry;
    }
    if (eventName === "PlanUpdated") {
      const planId = asBigInt(getArg(log, "planId")); const aprBps = asBigInt(getArg(log, "newAprBps"));
      const entry = baseEntry(log, "ADMIN", `Admin cập nhật APR Plan #${planId}`, `APR mới: ${bps(aprBps)}.`);
      entry.planId = planId; entry.needsTransactionActor = true; return entry;
    }
    if (eventName === "DepositOpened") {
      const depositId = asBigInt(getArg(log, "depositId")); const planId = asBigInt(getArg(log, "planId")); const owner = asAddress(getArg(log, "owner")); const principal = asBigInt(getArg(log, "principal"));
      const entry = baseEntry(log, "USER", "Mở deposit", `Mở Deposit #${depositId}, Plan #${planId}, số tiền ${usdc(principal)}.`);
      entry.actor = owner; entry.account = owner; entry.depositId = depositId; entry.planId = planId; entry.amount = principal; addRelated(entry, owner); return entry;
    }
    if (eventName === "Withdrawn") {
      const depositId = asBigInt(getArg(log, "depositId")); const owner = asAddress(getArg(log, "owner")); const principal = asBigInt(getArg(log, "principal")); const interest = asBigInt(getArg(log, "interest")); const isEarly = Boolean(getArg(log, "isEarly")); const payout = principal + interest;
      const entry = baseEntry(log, "USER", isEarly ? `Rút sớm Deposit #${depositId}` : `Rút đúng hạn Deposit #${depositId}`, `Gốc ${usdc(principal)}, lãi ${usdc(interest)}, nhận ${usdc(payout)}.`);
      entry.actor = owner; entry.account = owner; entry.depositId = depositId; entry.amount = payout; addRelated(entry, owner); return entry;
    }
    if (eventName === "Renewed") {
      const oldDepositId = asBigInt(getArg(log, "oldDepositId")); const newDepositId = asBigInt(getArg(log, "newDepositId")); const newPlanId = asBigInt(getArg(log, "newPlanId"));
      const beneficiary = mintRecipients.get(`${log.transactionHash}-${newDepositId}`);
      const entry = baseEntry(log, "USER", "Gia hạn deposit", `Deposit #${oldDepositId} → Deposit #${newDepositId}, Plan mới #${newPlanId}.`);
      entry.depositId = oldDepositId; entry.planId = newPlanId; entry.amount = asBigInt(getArg(log, "newPrincipal")); entry.account = beneficiary; entry.needsTransactionActor = true; addRelated(entry, beneficiary); return entry;
    }
    if (eventName === "Transfer") {
      const from = asAddress(getArg(log, "from")); const to = asAddress(getArg(log, "to"));
      if (isZeroAddress(from) || isZeroAddress(to)) return null;
      const depositId = asBigInt(getArg(log, "tokenId"));
      const entry = baseEntry(log, "USER", `Chuyển chứng chỉ Deposit #${depositId}`, `Chuyển chứng chỉ Deposit #${depositId} từ ${shortAddress(from)} sang ${shortAddress(to)}.`);
      entry.actor = from; entry.account = to; entry.depositId = depositId; addRelated(entry, from, to); return entry;
    }
  }
  if (eventName === "Paused" || eventName === "Unpaused") {
    const account = asAddress(getArg(log, "account")); const contractName = source === "SavingCore" ? "SavingCore" : "VaultManager";
    const entry = baseEntry(log, "ADMIN", `${eventName === "Paused" ? "Tạm dừng" : "Mở lại"} ${contractName}`, `${contractName} được ${eventName === "Paused" ? "tạm dừng" : "mở lại"}.`);
    entry.actor = account; entry.account = account; addRelated(entry, account); return entry;
  }
  if (eventName === "RoleGranted" || eventName === "RoleRevoked") {
    const account = asAddress(getArg(log, "account")); const sender = asAddress(getArg(log, "sender")); const role = asAddress(getArg(log, "role"));
    const entry = baseEntry(log, "ADMIN", eventName === "RoleGranted" ? "Cấp quyền" : "Thu hồi quyền", `${eventName === "RoleGranted" ? "Cấp" : "Thu hồi"} ${roleLabel(role)} cho ${shortAddress(account)} bởi ${shortAddress(sender)}.`);
    entry.actor = sender; entry.account = account; addRelated(entry, sender, account); return entry;
  }
  if (source === "VaultManager") {
    if (eventName === "VaultFunded") {
      const from = asAddress(getArg(log, "from")); const amount = asBigInt(getArg(log, "amount"));
      const entry = baseEntry(log, "ADMIN", `Admin nạp ${usdc(amount)} vào vault`, `Nạp ${usdc(amount)} vào VaultManager.`);
      entry.actor = from; entry.account = from; entry.amount = amount; addRelated(entry, from); return entry;
    }
    if (eventName === "VaultWithdrawn") {
      const to = asAddress(getArg(log, "to")); const amount = asBigInt(getArg(log, "amount"));
      const entry = baseEntry(log, "ADMIN", `Admin rút ${usdc(amount)} khỏi vault`, `Rút ${usdc(amount)} khỏi vault đến địa chỉ ${shortAddress(to)}.`);
      entry.actor = to; entry.account = to; entry.amount = amount; addRelated(entry, to); return entry;
    }
    if (eventName === "InterestPaid") {
      const to = asAddress(getArg(log, "to")); const amount = asBigInt(getArg(log, "amount"));
      const entry = baseEntry(log, "SYSTEM", "Vault trả lãi", `Vault trả ${usdc(amount)} cho ${shortAddress(to)}.`);
      entry.account = to; entry.amount = amount; entry.needsTransactionActor = true; addRelated(entry, to); return entry;
    }
    if (eventName === "CoreAddressSet") {
      const core = asAddress(getArg(log, "core"));
      const entry = baseEntry(log, "SYSTEM", "Cập nhật địa chỉ SavingCore", `VaultManager đặt SavingCore là ${shortAddress(core)}.`);
      entry.account = core; entry.needsTransactionActor = true; addRelated(entry, core); return entry;
    }
  }
  return null;
}

async function enrichRenewals(entries: PendingActivity[], savingCore: Contract) {
  const renewals = entries.filter((entry) => entry.action === "Gia hạn deposit");
  await mapWithConcurrency(renewals, async (entry) => {
    try {
      const deposit = await savingCore.getDeposit(entry.depositId!);
      entry.action = Number(deposit.status) === 2 ? "Gia hạn thủ công" : "Auto-renew";
    } catch { entry.action = "Gia hạn deposit"; }
  });
}

async function enrichTransactionActors(entries: PendingActivity[], provider: Provider) {
  const hashes = Array.from(new Set(entries.filter((entry) => entry.needsTransactionActor).map((entry) => entry.transactionHash)));
  const actors = new Map<string, string>();
  await mapWithConcurrency(hashes, async (hash) => {
    try { const transaction = await provider.getTransaction(hash); if (transaction?.from) actors.set(hash, transaction.from); } catch { /* actor is supplementary */ }
  });
  for (const entry of entries) {
    if (!entry.needsTransactionActor) continue;
    const actor = actors.get(entry.transactionHash);
    if (actor) { entry.actor = actor; addRelated(entry, actor); }
  }
}

async function enrichTimestamps(entries: PendingActivity[], provider: Provider) {
  const timestamps = new Map<number, number>();
  const blocks = Array.from(new Set(entries.map((entry) => entry.blockNumber)));
  await mapWithConcurrency(blocks, async (blockNumber) => {
    try { const block = await provider.getBlock(blockNumber); if (block) timestamps.set(blockNumber, Number(block.timestamp)); } catch { /* order falls back to block/log index */ }
  });
  for (const entry of entries) entry.timestamp = timestamps.get(entry.blockNumber) ?? 0;
}

export function ActivityHistory({ mode }: { mode: ActivityMode }) {
  const { account, chainId, provider } = useWalletContext();
  const [entries, setEntries] = useState<PendingActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>("ALL");
  const [visibleCount, setVisibleCount] = useState(INITIAL_LIMIT);
  const [hasMore, setHasMore] = useState(false);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const nextBlockRef = useRef<number | null>(null);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const loadPage = useCallback(async (reset: boolean) => {
    const requestId = ++requestIdRef.current;
    if (!account || !chainId || !provider || !ADDRESSES[chainId]) {
      if (mountedRef.current) { setEntries([]); setError(null); setHasMore(false); setLoading(false); }
      return;
    }
    const targetCount = reset ? INITIAL_LIMIT : visibleCount + INITIAL_LIMIT;
    if (!reset && entries.length >= targetCount) {
      await enrichTimestamps(entries.slice(visibleCount, targetCount).filter((entry) => entry.timestamp === 0), provider);
      setEntries([...entries]);
      setVisibleCount(targetCount);
      setHasMore(entries.length > targetCount || nextBlockRef.current !== null);
      return;
    }
    setLoading(true); setError(null);
    try {
      const addresses = ADDRESSES[chainId];
      const savingCore = new Contract(addresses.SavingCore, ABIS.SavingCore, provider);
      const vaultManager = new Contract(addresses.VaultManager, ABIS.VaultManager, provider);
      const fromBlock = DEPLOY_BLOCK[chainId] ?? 0;
      const collected = new Map((reset ? [] : entries).map((entry) => [entry.id, entry]));
      let successfulRequests = 0;
      let endBlock = reset ? await provider.getBlockNumber() : nextBlockRef.current;

      while (endBlock !== null && endBlock >= fromBlock && collected.size < targetCount) {
        const startBlock = Math.max(fromBlock, endBlock - CHUNK_SIZE + 1);
        const [coreResult, vaultResult] = await Promise.all([
          queryContractEventsSafely(savingCore, "SavingCore", startBlock, endBlock),
          queryContractEventsSafely(vaultManager, "VaultManager", startBlock, endBlock),
        ]);
        successfulRequests += coreResult.successfulRequests + vaultResult.successfulRequests;
        const logs = [...coreResult.logs, ...vaultResult.logs];
        const mintRecipients = transferMintRecipients(logs);
        const chunkEntries = logs
          .map((item) => makeActivity(item, mintRecipients))
          .filter((entry): entry is PendingActivity => entry !== null);

        await enrichRenewals(chunkEntries, savingCore);
        await enrichTransactionActors(chunkEntries, provider);
        for (const entry of chunkEntries) {
          if (mode === "admin" || entry.relatedAddresses.some((address) => address.toLowerCase() === account.toLowerCase())) {
            collected.set(entry.id, entry);
          }
        }
        endBlock = startBlock - 1;
      }
      if (successfulRequests === 0) throw new Error("RPC history is unavailable");
      const nextEntries = Array.from(collected.values())
        .sort((left, right) => right.blockNumber - left.blockNumber || right.logIndex - left.logIndex);
      const timestampEntries = nextEntries.slice(0, targetCount).filter((entry) => entry.timestamp === 0);
      await enrichTimestamps(timestampEntries, provider);
      nextBlockRef.current = endBlock !== null && endBlock >= fromBlock ? endBlock : null;
      if (mountedRef.current && requestId === requestIdRef.current) {
        setEntries(nextEntries);
        setVisibleCount(Math.min(targetCount, nextEntries.length));
        setHasMore(nextEntries.length > targetCount || nextBlockRef.current !== null);
      }
    } catch {
      if (mountedRef.current && requestId === requestIdRef.current) { setEntries([]); setError("Không thể tải lịch sử hoạt động từ RPC hiện tại."); }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, [account, chainId, entries, mode, provider, visibleCount]);

  const refresh = useCallback(() => {
    nextBlockRef.current = null;
    setVisibleCount(INITIAL_LIMIT);
    setHasMore(false);
    return loadPage(true);
  }, [loadPage]);

  const loadMore = useCallback(() => loadPage(false), [loadPage]);

  useEffect(() => { void refresh(); }, [account, chainId, mode, provider]);

  const visibleEntries = useMemo(() => {
    const normalizedAccount = account?.toLowerCase();
    return entries.filter((entry) => {
      if (mode === "admin") return filter === "ALL" || entry.category === filter;
      return Boolean(normalizedAccount && entry.relatedAddresses.some((address) => address.toLowerCase() === normalizedAccount));
    });
  }, [account, entries, filter, mode]);
  const displayedEntries = visibleEntries.slice(0, visibleCount);

  return <section className={`activity-history activity-history-${mode}`}>
    <div className="activity-history-header"><div><h2 className="activity-history-title">📜 Lịch sử hoạt động</h2><p className="activity-history-subtitle">5 hoạt động mới nhất, đọc trực tiếp từ blockchain.</p></div><button className="btn-refresh" type="button" onClick={refresh} disabled={loading}>{loading ? "Đang tải..." : "🔄 Làm mới"}</button></div>
    {mode === "admin" && <div className="activity-filters" role="group" aria-label="Lọc lịch sử hoạt động">{(["ALL", "USER", "ADMIN", "SYSTEM"] as ActivityFilter[]).map((option) => <button className={`activity-filter ${filter === option ? "activity-filter-active" : ""}`} key={option} type="button" onClick={() => { setFilter(option); setVisibleCount(INITIAL_LIMIT); }}>{({ ALL: "Tất cả", USER: "Người dùng", ADMIN: "Admin", SYSTEM: "Hệ thống" })[option]}</button>)}</div>}
    {error ? <p className="activity-state activity-error">{error}</p> : loading && entries.length === 0 ? <p className="activity-state">Đang tải lịch sử hoạt động...</p> : visibleEntries.length === 0 ? <p className="activity-state">Chưa có hoạt động phù hợp.</p> : <>
      <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>Thời gian</th><th>Loại</th><th>Ví thực hiện</th><th>Hoạt động</th><th>Chi tiết</th><th>Giao dịch</th></tr></thead><tbody>{displayedEntries.map((entry) => <ActivityRow entry={entry} chainId={chainId} key={entry.id} />)}</tbody></table></div>
      <div className="activity-cards">{displayedEntries.map((entry) => <ActivityCard entry={entry} chainId={chainId} key={entry.id} />)}</div>
      {hasMore && <button className="activity-more" type="button" onClick={() => void loadMore()} disabled={loading}>Hiển thị thêm</button>}
    </>}
  </section>;
}

function ActivityRow({ entry, chainId }: { entry: ActivityEntry; chainId: number | null }) {
  return <tr><td>{formatTime(entry.timestamp)}</td><td><Category category={entry.category} /></td><td>{shortAddress(entry.actor)}</td><td>{entry.action}</td><td>{entry.details}</td><td><TransactionLink hash={entry.transactionHash} chainId={chainId} /></td></tr>;
}
function ActivityCard({ entry, chainId }: { entry: ActivityEntry; chainId: number | null }) {
  return <article className="activity-card"><div className="activity-card-top"><Category category={entry.category} /><time>{formatTime(entry.timestamp)}</time></div><strong>{entry.action}</strong><p>{entry.details}</p><span>Ví thực hiện: {shortAddress(entry.actor)}</span><TransactionLink hash={entry.transactionHash} chainId={chainId} /></article>;
}
function Category({ category }: { category: ActivityEntry["category"] }) { return <span className={`activity-category activity-category-${category.toLowerCase()}`}>{category === "USER" ? "Người dùng" : category === "ADMIN" ? "Admin" : "Hệ thống"}</span>; }
function TransactionLink({ hash, chainId }: { hash: string; chainId: number | null }) { return chainId === 11_155_111 ? <a className="activity-tx" href={`https://sepolia.etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">Xem tx ↗</a> : <span className="activity-tx">{shortHash(hash)}</span>; }
function formatTime(timestamp: number): string { return timestamp ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(timestamp * 1_000)) : "Không rõ"; }
