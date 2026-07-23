import { useState, useCallback, useEffect } from "react";
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { NETWORK_NAMES } from "../contracts";

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, listener: (...args: any[]) => void) => void;
  removeListener: (event: string, listener: (...args: any[]) => void) => void;
}

export function useWallet() {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resetWallet = useCallback(() => {
    setAccount(null);
    setChainId(null);
    setProvider(null);
    setSigner(null);
    setError(null);
  }, []);

  const syncAccount = useCallback(async (eth: EthereumProvider, address: string) => {
    const nextProvider = new BrowserProvider(eth);
    const [nextSigner, network] = await Promise.all([
      nextProvider.getSigner(address),
      nextProvider.getNetwork(),
    ]);
    setProvider(nextProvider);
    setSigner(nextSigner);
    setAccount(address);
    setChainId(Number(network.chainId));
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    const eth = (window as Window & { ethereum?: EthereumProvider }).ethereum;
    if (!eth) {
      setError("Không tìm thấy MetaMask. Vui lòng cài đặt extension MetaMask.");
      return;
    }
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" }) as string[];
      if (accounts.length === 0) {
        resetWallet();
        return;
      }
      await syncAccount(eth, accounts[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kết nối thất bại");
    }
  }, [resetWallet, syncAccount]);

  const switchToSepolia = useCallback(async () => {
    const eth = (window as Window & { ethereum?: EthereumProvider }).ethereum;
    if (!eth) {
      setError("Không tìm thấy MetaMask. Vui lòng cài đặt extension MetaMask.");
      return;
    }
    setError(null);
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
      const accounts = await eth.request({ method: "eth_accounts" }) as string[];
      if (accounts.length > 0) await syncAccount(eth, accounts[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể chuyển sang Sepolia.");
    }
  }, [syncAccount]);

  // Tự động cập nhật khi user đổi account hoặc network trong MetaMask
  // (không bắt user phải bấm connect lại thủ công)
  useEffect(() => {
    const eth = (window as Window & { ethereum?: EthereumProvider }).ethereum;
    if (!eth) return;
    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        resetWallet();
        return;
      }
      syncAccount(eth, accounts[0]).catch(() => resetWallet());
    };
    const handleChainChanged = () => {
      eth.request({ method: "eth_accounts" })
        .then((accounts) => {
          const values = accounts as string[];
          if (values.length === 0) {
            resetWallet();
            return;
          }
          return syncAccount(eth, values[0]);
        })
        .catch(() => resetWallet());
    };
    eth.on("accountsChanged", handleAccountsChanged);
    eth.on("chainChanged", handleChainChanged);
    return () => {
      eth.removeListener("accountsChanged", handleAccountsChanged);
      eth.removeListener("chainChanged", handleChainChanged);
    };
  }, [resetWallet, syncAccount]);

  const networkName = chainId ? (NETWORK_NAMES[chainId] ?? `Chain ${chainId}`) : null;

  return {
    account,
    chainId,
    networkName,
    provider,
    signer,
    connect,
    switchToSepolia,
    error,
  };
}
