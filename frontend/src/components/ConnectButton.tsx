import { useWalletContext } from "../contexts/WalletContext";
import { isNetworkConfigured } from "../contracts";
import "./ConnectButton.css";

export function ConnectButton() {
  const { account, chainId, networkName, connect, changeAccount, changingAccount, switchToSepolia, error } = useWalletContext();

  // Kiểm tra network có được hỗ trợ không
  const isUnsupported = chainId !== null && !isNetworkConfigured(chainId);

  if (!account) {
    return (
      <div className="connect-wrapper">
        <button className="connect-btn" onClick={connect}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
            <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
          </svg>
          Kết nối ví
        </button>
        {error && <p className="connect-error">{error}</p>}
      </div>
    );
  }

  const shortAddr = `${account.slice(0, 6)}...${account.slice(-4)}`;

  return (
    <div className="connect-wrapper">
      <div className="connect-connected-row">
        <div className="connect-pill">
          <span className="connect-dot" />
          <span className="connect-addr">{shortAddr}</span>
          <span className="connect-sep">·</span>
          <span className="connect-network">{networkName}</span>
        </div>
        <button className="change-account-btn" onClick={changeAccount} disabled={changingAccount}>
          {changingAccount ? "Đang mở MetaMask..." : "Đổi tài khoản"}
        </button>
      </div>
      {isUnsupported && (
        <div className="connect-unsupported">
          ⚠️ Mạng này chưa có đủ địa chỉ contract. Hardhat Local chỉ khả dụng sau khi cấu hình
          đủ ba địa chỉ local; vui lòng chuyển sang Sepolia.
          <button className="switch-network-btn" onClick={switchToSepolia}>Chuyển sang Sepolia</button>
        </div>
      )}
      {error && <p className="connect-error">{error}</p>}
    </div>
  );
}
