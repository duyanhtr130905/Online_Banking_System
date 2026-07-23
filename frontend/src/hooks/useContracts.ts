import { useMemo } from "react";
import { Contract } from "ethers";
import { useWalletContext } from "../contexts/WalletContext";
import { ADDRESSES, ABIS } from "../contracts";

export function useContracts() {
  const { signer, chainId } = useWalletContext();
  return useMemo(() => {
    if (!signer || !chainId) return null;
    const addrs = ADDRESSES[chainId];
    if (!addrs || !addrs.SavingCore) return null;
    return {
      mockUSDC: new Contract(addrs.MockUSDC, ABIS.MockUSDC, signer),
      vaultManager: new Contract(addrs.VaultManager, ABIS.VaultManager, signer),
      savingCore: new Contract(addrs.SavingCore, ABIS.SavingCore, signer),
    };
  }, [signer, chainId]);
}
