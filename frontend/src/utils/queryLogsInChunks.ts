import type { Contract, EventLog, Log } from "ethers";

const CHUNK_SIZE = 9000; // dưới 10,000 để có margin an toàn

/**
 * Quét event log theo từng đợt nhỏ (chunk) để tránh vượt giới hạn RPC
 * "range exceeds limit of 10000" - nhiều RPC provider công khai (kể cả
 * mặc định của MetaMask) giới hạn số block tối đa mỗi lần gọi eth_getLogs.
 */
export async function queryLogsInChunks(
  contract: Contract,
  filter: ReturnType<Contract["filters"][string]>,
  fromBlock: number,
  toBlock: number,
): Promise<(EventLog | Log)[]> {
  const results: (EventLog | Log)[] = [];
  let start = fromBlock;

  while (start <= toBlock) {
    const end = Math.min(start + CHUNK_SIZE - 1, toBlock);
    const chunk = await contract.queryFilter(filter, start, end);
    results.push(...chunk);
    start = end + 1;
  }

  return results;
}
