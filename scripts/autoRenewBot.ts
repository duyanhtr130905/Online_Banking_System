import { deployments, ethers, network } from "hardhat";
import type { Signer } from "ethers";

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_EVENT_CHUNK_SIZE = 5_000;
const ACTIVE_STATUS = 0;

// The generated Hardhat contract types are not committed in every checkout, so keep this
// adapter structural and let the ABI selected by getContractAt provide the runtime contract.
type SavingCoreContract = any;
type VaultManagerContract = any;

export interface BotState {
  candidateIds: Set<bigint>;
  processingIds: Set<bigint>;
  lastScannedBlock: number;
}

export interface ScanAndRenewContext {
  savingCore: SavingCoreContract;
  vaultManager: VaultManagerContract;
  state: BotState;
  log?: (message: string) => void;
  chunkSize?: number;
  shouldStop?: () => boolean;
}

export interface ScanAndRenewResult {
  discoveredIds: number;
  renewedIds: number;
  remainingCandidates: number;
}

export function getPollIntervalMs(value = process.env.AUTO_RENEW_POLL_MS): number {
  if (value === undefined || value === "") return DEFAULT_POLL_INTERVAL_MS;

  if (!/^\d+$/.test(value)) {
    console.warn(
      `[AUTO-RENEW BOT] AUTO_RENEW_POLL_MS="${value}" không hợp lệ; dùng mặc định ${DEFAULT_POLL_INTERVAL_MS} ms.`,
    );
    return DEFAULT_POLL_INTERVAL_MS;
  }

  const interval = Number(value);
  if (!Number.isSafeInteger(interval) || interval < 1_000) {
    console.warn(
      `[AUTO-RENEW BOT] AUTO_RENEW_POLL_MS phải là số nguyên >= 1000; dùng mặc định ${DEFAULT_POLL_INTERVAL_MS} ms.`,
    );
    return DEFAULT_POLL_INTERVAL_MS;
  }

  return interval;
}

export async function loadSavingCoreFromDeployment(botSigner: Signer) {
  const savingCoreDeployment = await deployments.get("SavingCore");
  const code = await ethers.provider.getCode(savingCoreDeployment.address);

  if (code === "0x") {
    throw new Error(
      "SavingCore deployment không tồn tại trên Hardhat node hiện tại.\n" +
        "Hãy deploy lại contract hoặc kiểm tra deployments/localhost.",
    );
  }

  const savingCore = await ethers.getContractAt("SavingCore", savingCoreDeployment.address, botSigner);
  const vaultAddress = await savingCore.vault();
  const vaultManager = await ethers.getContractAt("VaultManager", vaultAddress, botSigner);

  return { savingCore, vaultManager, savingCoreDeployment };
}

function eventArg(event: any, name: string): bigint | undefined {
  const value = event.args?.[name];
  return typeof value === "bigint" ? value : undefined;
}

function getErrorMessage(error: unknown): string {
  const cause = error as { reason?: string; shortMessage?: string; message?: string };
  return cause.reason ?? cause.shortMessage ?? cause.message ?? String(error);
}

/** Quét theo chunk để RPC không vượt giới hạn, kể cả deposit được mở khi bot đang chạy. */
export async function scanNewEvents(
  savingCore: SavingCoreContract,
  state: BotState,
  fromBlock: number,
  toBlock: number,
  chunkSize = DEFAULT_EVENT_CHUNK_SIZE,
  log: (message: string) => void = console.log,
): Promise<number> {
  if (fromBlock > toBlock) return 0;

  let discoveredIds = 0;
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, toBlock);
    const openedEvents = await savingCore.queryFilter(savingCore.filters.DepositOpened(), start, end);
    const renewedEvents = await savingCore.queryFilter(savingCore.filters.Renewed(), start, end);

    for (const event of openedEvents) {
      const depositId = eventArg(event, "depositId");
      if (depositId !== undefined && !state.candidateIds.has(depositId)) {
        state.candidateIds.add(depositId);
        discoveredIds++;
        log(`[AUTO-RENEW BOT] Phát hiện deposit mới #${depositId}.`);
      }
    }

    for (const event of renewedEvents) {
      const newDepositId = eventArg(event, "newDepositId");
      if (newDepositId !== undefined && !state.candidateIds.has(newDepositId)) {
        state.candidateIds.add(newDepositId);
        discoveredIds++;
        log(`[AUTO-RENEW BOT] Phát hiện deposit #${newDepositId} từ Renewed event.`);
      }
    }
  }

  return discoveredIds;
}

function renewedDepositIdFromReceipt(savingCore: SavingCoreContract, receipt: any, oldDepositId: bigint): bigint {
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = savingCore.interface.parseLog(log);
      if (parsed?.name === "Renewed" && parsed.args.oldDepositId === oldDepositId) {
        return parsed.args.newDepositId as bigint;
      }
    } catch {
      // A receipt also has ERC-20/ERC-721 logs; only SavingCore's Renewed log matters here.
    }
  }

  throw new Error("Không tìm thấy Renewed event trong receipt.");
}

async function processCandidates(context: ScanAndRenewContext, log: (message: string) => void): Promise<number> {
  const { savingCore, vaultManager, state, shouldStop = () => false } = context;
  const latestBlock = await ethers.provider.getBlock("latest");
  if (!latestBlock) throw new Error("Không đọc được latest block.");

  const [gracePeriodSeconds, savingCorePaused, vaultPaused] = await Promise.all([
    savingCore.gracePeriodSeconds(),
    savingCore.paused(),
    vaultManager.paused(),
  ]);

  if (savingCorePaused || vaultPaused) {
    log(
      `[AUTO-RENEW BOT] Tạm dừng xử lý vì ${savingCorePaused ? "SavingCore" : "VaultManager"} đang pause.`,
    );
    return 0;
  }

  let renewedIds = 0;
  for (const depositId of [...state.candidateIds]) {
    if (shouldStop()) break;
    if (state.processingIds.has(depositId)) continue;

    const deposit = await savingCore.getDeposit(depositId);
    if (Number(deposit.status) !== ACTIVE_STATUS) {
      state.candidateIds.delete(depositId);
      continue;
    }

    const eligibleAt = deposit.maturityAt + gracePeriodSeconds;
    if (BigInt(latestBlock.timestamp) < eligibleAt) continue;

    state.processingIds.add(depositId);
    try {
      log(`[AUTO-RENEW BOT] Deposit #${depositId} đã đủ điều kiện auto-renew.`);

      const interest = await savingCore.calculateInterest(depositId);
      const availableBalance = await vaultManager.getAvailableBalance();
      if (availableBalance < interest) {
        log(
          `[AUTO-RENEW BOT] Vault thiếu thanh khoản cho deposit #${depositId}: cần ${interest}, có ${availableBalance}.`,
        );
        continue;
      }

      await savingCore.autoRenewDeposit.staticCall(depositId);
      log(`[AUTO-RENEW BOT] Đang gửi auto-renew cho deposit #${depositId}.`);
      const tx = await savingCore.autoRenewDeposit(depositId);
      const receipt = await tx.wait();
      if (!receipt) throw new Error("Transaction không có receipt.");

      const newDepositId = renewedDepositIdFromReceipt(savingCore, receipt, depositId);
      state.candidateIds.delete(depositId);
      state.candidateIds.add(newDepositId);
      renewedIds++;
      log(`[AUTO-RENEW BOT] Tx thành công: ${receipt.hash}`);
      log(`[AUTO-RENEW BOT] Auto-renew thành công: oldDepositId ${depositId} -> newDepositId ${newDepositId}`);
    } catch (error) {
      // Có thể user đã renew/rút sau lần đọc trạng thái của bot; đây không phải lỗi nghiêm trọng.
      try {
        const currentDeposit = await savingCore.getDeposit(depositId);
        if (Number(currentDeposit.status) !== ACTIVE_STATUS) {
          state.candidateIds.delete(depositId);
          log(`[AUTO-RENEW BOT] Deposit #${depositId} đã được xử lý bởi giao dịch khác.`);
          continue;
        }
      } catch {
        // Giữ lỗi giao dịch ban đầu nếu lần đọc kiểm tra lại cũng thất bại.
      }
      log(`[AUTO-RENEW BOT] Revert khi xử lý deposit #${depositId}: ${getErrorMessage(error)}`);
    } finally {
      state.processingIds.delete(depositId);
    }
  }

  return renewedIds;
}

/** Mỗi poll nhận event mới trước, rồi xử lý tuần tự để một signer không bị trùng nonce. */
export async function scanAndRenewOnce(context: ScanAndRenewContext): Promise<ScanAndRenewResult> {
  const log = context.log ?? console.log;
  const latestBlock = await ethers.provider.getBlockNumber();
  const fromBlock = context.state.lastScannedBlock + 1;
  const discoveredIds = await scanNewEvents(
    context.savingCore,
    context.state,
    fromBlock,
    latestBlock,
    context.chunkSize,
    log,
  );
  context.state.lastScannedBlock = latestBlock;

  const renewedIds = await processCandidates(context, log);
  if (discoveredIds > 0 || renewedIds > 0) {
    log(`[AUTO-RENEW BOT] Candidates còn lại: ${context.state.candidateIds.size}.`);
  }

  return { discoveredIds, renewedIds, remainingCandidates: context.state.candidateIds.size };
}

function waitForPollInterval(intervalMs: number, registerWake: (wake: () => void) => void): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, intervalMs);
    registerWake(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main() {
  const [botSigner] = await ethers.getSigners();
  const { savingCore, vaultManager, savingCoreDeployment } = await loadSavingCoreFromDeployment(botSigner);
  const chain = await ethers.provider.getNetwork();
  const deploymentBlock = savingCoreDeployment.receipt?.blockNumber;
  if (typeof deploymentBlock !== "number") {
    throw new Error("Không tìm thấy SavingCore deployment block trong deployment record.");
  }

  const pollIntervalMs = getPollIntervalMs();
  const state: BotState = {
    candidateIds: new Set<bigint>(),
    processingIds: new Set<bigint>(),
    lastScannedBlock: deploymentBlock - 1,
  };

  console.log("[AUTO-RENEW BOT]");
  console.log(`Network: ${network.name}`);
  console.log(`Chain ID: ${chain.chainId}`);
  console.log(`Bot address: ${await botSigner.getAddress()}`);
  console.log(`SavingCore address: ${savingCoreDeployment.address}`);
  console.log(`SavingCore deployment block: ${deploymentBlock}`);
  console.log(`Poll interval: ${pollIntervalMs} ms`);

  let stopping = false;
  let wakePoll: (() => void) | undefined;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    wakePoll?.();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const initialResult = await scanAndRenewOnce({
      savingCore,
      vaultManager,
      state,
      shouldStop: () => stopping,
    });
    console.log(`Initial candidates: ${initialResult.discoveredIds}`);

    while (!stopping) {
      await waitForPollInterval(pollIntervalMs, (wake) => {
        wakePoll = wake;
      });
      wakePoll = undefined;
      if (stopping) break;

      await scanAndRenewOnce({
        savingCore,
        vaultManager,
        state,
        shouldStop: () => stopping,
      });
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    console.log("Bot đã dừng");
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
