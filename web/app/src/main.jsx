import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy, useWallets, useConnectWallet } from "@privy-io/react-auth";
import { testnetBradbury } from "genlayer-js/chains";
import "./styles.css";
import Landing from "./pages/Landing.jsx";
import Report from "./pages/Report.jsx";
import Investigate from "./pages/Investigate.jsx";
import Logo from "./components/Logo.jsx";
import { primaryIncidentId } from "./lib/client.js";
import { pickWallet } from "./lib/wallet.js";

// Privy app ID is a PUBLIC client identifier (safe to bundle, like a GA ID).
// Without it the app runs read-only and the connect button is hidden.
const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || "";

// Tiny hash router — no dependency. #/ is landing, #/report/:id is a report,
// #/investigate is the on-chain write flow.
function useRoute() {
  const parse = () => {
    const h = window.location.hash || "#/";
    const mr = h.match(/^#\/report\/(.+)$/);
    if (mr) return { name: "report", id: decodeURIComponent(mr[1]) };
    if (h.startsWith("#/investigate")) return { name: "investigate" };
    return { name: "landing" };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

function WalletButtonInner() {
  // Connect-only flow: no SIWE sign-in message, so no phishing screen and no
  // "resources: privy.io" prompt. The connected wallet is enough — reads are
  // public and writes are signed per-transaction by the user.
  const { ready } = usePrivy();
  const { connectWallet } = useConnectWallet();
  const { wallets } = useWallets();
  const wallet = pickWallet(wallets);
  if (!ready) return null;
  if (!wallet) {
    return (
      <button className="btn btn-wallet" onClick={() => connectWallet()}>
        Connect wallet
      </button>
    );
  }
  const addr = wallet.address;
  return (
    <button
      className="btn btn-wallet connected"
      title="Click to disconnect"
      onClick={() => wallet.disconnect()}
    >
      {addr.slice(0, 6)}…{addr.slice(-4)}
    </button>
  );
}

function WalletButton() {
  if (!PRIVY_APP_ID) return null;
  return <WalletButtonInner />;
}

function Nav({ route }) {
  return (
    <header className="nav">
      <div className="nav-inner">
        <a className="brand" href="#/">
          <span className="brand-mark"><Logo size={28} /></span>
          <span>
            <div className="brand-name">FaultLine</div>
            <div className="brand-sub">BLACK-BOX INVESTIGATOR</div>
          </span>
        </a>
        <nav className="nav-links">
          <a href="#/" className={route.name === "landing" ? "active" : ""}>Overview</a>
          <a href={`#/report/${primaryIncidentId()}`} className={route.name === "report" ? "active" : ""}>
            Live report
          </a>
          <a href="#/investigate" className={route.name === "investigate" ? "active" : ""}>
            Investigate
          </a>
          <WalletButton />
        </nav>
      </div>
    </header>
  );
}

function GithubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="shell footer-inner">
        <span>FAULTLINE · GENLAYER INTELLIGENT CONTRACT</span>
        <span className="social">
          <a href="https://github.com/YoneCode/FaultLine" target="_blank" rel="noreferrer" aria-label="FaultLine on GitHub">
            <GithubIcon />
          </a>
          <a href="https://x.com/YoneCode" target="_blank" rel="noreferrer" aria-label="YoneCode on X">
            <XIcon />
          </a>
        </span>
        <span>TRACE → MANDATE → CONSENSUS → ATTRIBUTION</span>
        <span className="faint">EVIDENCE, NOT A COURT RULING</span>
      </div>
    </footer>
  );
}

function App() {
  const route = useRoute();
  return (
    <>
      <Nav route={route} />
      {route.name === "report" ? (
        <Report incidentId={route.id} />
      ) : route.name === "investigate" ? (
        <Investigate />
      ) : (
        <Landing />
      )}
      <Footer />
    </>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(
  PRIVY_APP_ID ? (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        defaultChain: testnetBradbury,
        supportedChains: [testnetBradbury],
      }}
    >
      <App />
    </PrivyProvider>
  ) : (
    <App />
  )
);
