import { ConnectButton } from "./components/ConnectButton";
import { AdminPanel } from "./components/AdminPanel";
import { PlanList } from "./components/PlanList";
import { OpenDepositForm } from "./components/OpenDepositForm";
import { MyDeposits } from "./components/MyDeposits";
import { VaultAdminPanel } from "./components/VaultAdminPanel";
import { useWalletContext } from "./contexts/WalletContext";
import { isNetworkConfigured } from "./contracts";
import "./App.css";

function App() {
  const { account, chainId } = useWalletContext();

  // Network được hỗ trợ khi có address SavingCore hợp lệ
  const isSupported = isNetworkConfigured(chainId);
  const showDashboard = !!account && isSupported;

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="url(#logo-grad)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <defs>
              <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
            <rect x="2" y="4" width="20" height="16" rx="3" />
            <path d="M2 10h20" />
            <path d="M12 4v16" />
          </svg>
          <h1 className="app-title">Term Deposit</h1>
        </div>
        <ConnectButton />
      </header>

      {/* Content */}
      <main className="app-main">
        {!account ? (
          <div className="app-placeholder">
            <div className="app-placeholder-icon">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#a5b4c3"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
              </svg>
            </div>
            <p className="app-placeholder-text">Kết nối ví để bắt đầu</p>
            <p className="app-placeholder-sub">
              Sử dụng MetaMask trên mạng Sepolia để tương tác với hệ thống
            </p>
          </div>
        ) : showDashboard ? (
          <div className="app-dashboard">
            <AdminPanel />
            <VaultAdminPanel />
            <PlanList />
            <OpenDepositForm />
            <MyDeposits />
          </div>
        ) : (
          <div className="app-placeholder">
            <p className="app-placeholder-text">Mạng không được hỗ trợ</p>
            <p className="app-placeholder-sub">
              Vui lòng đổi sang Sepolia trong MetaMask. Hardhat Local chỉ được hỗ trợ khi đủ
              ba địa chỉ contract local được cấu hình.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
