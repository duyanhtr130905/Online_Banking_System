import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WalletProvider } from "./contexts/WalletContext";
import { PlansProvider } from "./contexts/PlansContext";
import { AccountDataProvider } from "./contexts/AccountDataContext";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <WalletProvider>
      <PlansProvider>
        <AccountDataProvider>
          <App />
        </AccountDataProvider>
      </PlansProvider>
    </WalletProvider>
  </StrictMode>
);
