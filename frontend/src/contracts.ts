import MockUSDCAbi from "./abis/MockUSDC.json";
import VaultManagerAbi from "./abis/VaultManager.json";
import SavingCoreAbi from "./abis/SavingCore.json";
import type { NetworkAddresses } from "./types";
import { isAddress, ZeroAddress } from "ethers";

export const ADDRESSES: Record<number, NetworkAddresses> = {
  11155111: {
    MockUSDC: "0x80ac50FE538D20b0D260f0Fb3DD6733d1ddC65c8",
    VaultManager: "0x0F084FE741cD520031a51F862edAec13C7d46D79",
    SavingCore: "0xB1becB075dE06FAed11319390B4bBEc24C296dF8",
  },
  31337: {
    MockUSDC: "",
    VaultManager: "",
    SavingCore: "",
  },
};

export const NETWORK_NAMES: Record<number, string> = {
  11155111: "Sepolia",
  31337: "Hardhat Local",
};

export function isNetworkConfigured(chainId: number | null): boolean {
  if (chainId === null) return false;
  const addresses = ADDRESSES[chainId];
  if (!addresses) return false;
  return Object.values(addresses).every(
    (address) => isAddress(address) && address !== ZeroAddress,
  );
}

export const ABIS = {
  MockUSDC: MockUSDCAbi,
  VaultManager: VaultManagerAbi,
  SavingCore: SavingCoreAbi,
};

// Block number at which SavingCore was deployed — dùng làm fromBlock cho queryFilter
// để tránh scan toàn bộ lịch sử chain (chậm + tốn quota RPC).
export const DEPLOY_BLOCK: Record<number, number> = {
  11155111: 11330640, // Sepolia deploy block (từ deployments/sepolia/SavingCore.json)
  31337: 0,
};
