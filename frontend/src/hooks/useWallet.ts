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
  const [changingAccount, setChangingAccount] = useState(false);

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

  const changeAccount = useCallback(async () => {
    const eth = (window as Window & { ethereum?: EthereumProvider }).ethereum;
    if (!eth) {
      setError("Không tìm thấy MetaMask. Vui lòng cài đặt extension MetaMask.");
      return;
    }
    if (changingAccount) return;
    setError(null);
    setChangingAccount(true);
    try {
      const permissions = await eth.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      }) as Array<{ parentCapability?: string }>;
      if (!permissions.some((permission) => permission.parentCapability === "eth_accounts")) {
        throw new Error("MetaMask không cấp quyền truy cập tài khoản.");
      }
      const accounts = await eth.request({ method: "eth_accounts" }) as string[];
      if (accounts.length === 0) {
        resetWallet();
        return;
      }
      await syncAccount(eth, accounts[0]);
    } catch (err) {
      const code = typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: number }).code
        : undefined;
      if (code === -32601 || code === 4200) {
        try {
          // Chỉ fallback trong thao tác click trực tiếp; không tự bật popup khi account/chain thay đổi.
          const accounts = await eth.request({ method: "eth_requestAccounts" }) as string[];
          if (accounts.length === 0) resetWallet();
          else await syncAccount(eth, accounts[0]);
        } catch (fallbackError) {
          const fallbackCode = typeof fallbackError === "object" && fallbackError !== null && "code" in fallbackError
            ? (fallbackError as { code?: number }).code
            : undefined;
          setError(fallbackCode === 4001 ? "Bạn đã từ chối chọn tài khoản trong MetaMask." : "Không thể mở màn hình chọn tài khoản của MetaMask.");
        }
      } else {
        setError(code === 4001 ? "Bạn đã từ chối chọn tài khoản trong MetaMask." : "Không thể đổi tài khoản. Vui lòng thử lại trong MetaMask.");
      }
    } finally {
      setChangingAccount(false);
    }
  }, [changingAccount, resetWallet, syncAccount]);

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
    changeAccount,
    switchToSepolia,
    changingAccount,
    error,
  };
}
