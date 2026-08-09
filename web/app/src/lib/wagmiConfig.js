// Wagmi + RainbowKit config for FaultLine.
//
// RainbowKit's ConnectButton handles connect AND disconnect reliably for
// external wallets (MetaMask, WalletConnect, etc.) out of the box — and it
// talks to WalletConnect's relay, not auth.privy.io, so it doesn't trip
// MetaMask's phishing heuristic the way a brand-new Privy app did.
//
// The single supported chain is GenLayer Bradbury (id 4221). Writes are signed
// by the USER'S OWN wallet via the wagmi connector; the deployer key never
// leaves .env / the CLI scripts.

import React from "react";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { darkTheme, lightTheme } from "@rainbow-me/rainbowkit";

// GenLayer Bradbury testnet as a viem/wagmi Chain. Mirrors the spec in
// genlayer-js/chains so readContract/writeContract targets the same network.
const bradbury = {
  id: 4221,
  name: "GenLayer Bradbury",
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc-bradbury.genlayer.com"] },
  },
  blockExplorers: {
    default: { name: "GenLayer Explorer", url: "https://explorer-bradbury.genlayer.com" },
  },
  testnet: true,
};

// WalletConnect project ID — a PUBLIC identifier from cloud.walletconnect.com
// (like a GA id), not a secret. Required for mobile/QR pairing; injected
// MetaMask works without it. Override via VITE_WC_PROJECT_ID.
const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID || "FAULTLINE_WC_PLACEHOLDER";

export const wagmiConfig = getDefaultConfig({
  appName: "FaultLine",
  appDescription: "Black-box investigator for multi-agent AI",
  appUrl: "https://faultline-agent.pages.dev",
  projectId: WC_PROJECT_ID,
  chains: [bradbury],
  transports: {
    [bradbury.id]: http("https://rpc-bradbury.genlayer.com"),
  },
});

// Match the site's dark amber palette. The app is dark-only (color-scheme:
// dark), so we use darkTheme directly.
export const rainbowKitTheme = darkTheme({
  accentColor: "#e08a00",
  accentColorForeground: "#141414",
  borderRadius: "medium",
});

export const queryClient = new QueryClient();

// Provider bundle: Wagmi + React Query — the two wrappers RainbowKit needs.
// Uses React.createElement (not JSX) so this stays a .js file like the other
// lib modules.
export function WalletProviders({ children }) {
  return React.createElement(
    WagmiProvider,
    { config: wagmiConfig },
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  );
}
