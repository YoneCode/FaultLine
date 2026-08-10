// Wallet write-path for FaultLine (browser).
//
// Reading the verdict needs no wallet (plain readContract over the public RPC).
// Writing — register_mandate / record_trace_hash / open_investigation — must be
// signed by the USER'S OWN wallet, connected via Privy. The deployer's private
// key is NEVER involved here: it lives only in .env for the CLI deploy scripts.
//
// The integration is verified against the installed packages:
//   - Privy ConnectedWallet exposes switchChain(id) and getEthereumProvider()
//     (an EIP-1193 provider).
//   - genlayer-js createClient accepts { chain, account, provider }. It routes
//     signing methods (eth_sendTransaction, ...) through `provider` ONLY when
//     `account` is an address string (not a local Account object) — see
//     getCustomTransportConfig in genlayer-js/dist/index.js. So we pass the
//     connected wallet's address as `account` and its EIP-1193 provider.
import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { sha256Hex } from "./hash.js";

export { sha256Hex };

export const BRADBURY_CHAIN_ID = 4221; // 0x1085
export const EXPLORER = "https://explorer-bradbury.genlayer.com";
export const BOND_WEI = 10_000_000_000_000_000n; // 0.01 GEN (contract MIN_BOND_WEI)

export function explorerTxUrl(hash) {
  return `${EXPLORER}/tx/${hash}`;
}

// Pick the wallet to sign with: the active EOA (embedded or external).
// Privy returns wallets most-recent-first; we just take the first EVM one.
export function pickWallet(wallets) {
  if (!wallets || wallets.length === 0) return null;
  return wallets[0];
}

// Build a genlayer-js client that signs with the connected wallet.
// The account is passed as an address string, so genlayer-js routes
// eth_sendTransaction through the wallet's EIP-1193 provider and the wallet
// broadcasts — the only flow browser wallets universally support
// (eth_signTransaction sign-only is NOT available on MetaMask).
//
// The wallet broadcast problem this works around: MetaMask's json-rpc engine
// emits STRING request ids when it relays the signed transaction to the
// network's RPC, and Bradbury's Go gateway only accepts integer ids
// ("cannot unmarshal string into Go struct field Request.id of type int").
// So before the first write of a session we point the wallet's Bradbury
// network at our same-origin id-normalizing proxy (functions/rpc.js) via
// wallet_addEthereumChain — a one-time "update network" consent prompt.
const BRADBURY_HEX_CHAIN_ID = "0x1085"; // 4221
const RPC_REGISTERED_KEY = "faultline_rpc_proxy_registered";

// Same-origin id-normalizing proxy (functions/rpc.js).
export function proxyRpcUrl() {
  return `${window.location.origin}/rpc`;
}

export function bradburyProxyChainParams() {
  return {
    chainId: BRADBURY_HEX_CHAIN_ID,
    chainName: "GenLayer Bradbury",
    nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
    rpcUrls: [proxyRpcUrl()],
    blockExplorerUrls: [EXPLORER],
  };
}

// Ask the wallet to add (or update) Bradbury with the proxy RPC URL.
// One-time consent prompt. Returns true when the wallet accepted.
// Exported so the /investigate page can offer it as a manual button too.
export async function registerProxyRpc(provider) {
  try {
    await provider.request({ method: "wallet_addEthereumChain", params: [bradburyProxyChainParams()] });
    try { sessionStorage.setItem(RPC_REGISTERED_KEY, "1"); } catch { /* private mode */ }
    return true;
  } catch {
    return false;
  }
}

async function ensureProxyRpcRegistered(provider, wallet) {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return;
  // Embedded wallets (Privy) broadcast through their own infra, not a
  // user-configured RPC — there is nothing to re-point.
  if (wallet && wallet.walletClientType === "privy") return;
  if (sessionStorage.getItem(RPC_REGISTERED_KEY) === "1") return;
  // Declined or unsupported: continue — the write may still work if the
  // wallet's relay already sends integer ids (non-MetaMask wallets often do).
  await registerProxyRpc(provider);
}

export async function getWriteClient(wallet) {
  if (!wallet) throw new Error("No wallet connected");
  const provider = await wallet.getEthereumProvider();
  await ensureProxyRpcRegistered(provider, wallet);
  await wallet.switchChain(BRADBURY_CHAIN_ID);
  return createClient({ chain: testnetBradbury, account: wallet.address, provider });
}

// A write can fail at the EVM-submission layer while the tx never reaches
// consensus (a transient RPC/nonce hiccup, not a contract UserError). Those are
// safe to retry. A revert that reached consensus is a real UserError — do NOT
// retry it (mirrors deploy/investigate.mjs).
function isTransientSubmissionRevert(e) {
  const s = String(e && e.message ? e.message : e);
  return s.includes("was reverted") && s.includes("consensus contract");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Submit a write and wait for acceptance. Returns { hash, receipt }.
// onStatus(msg) is an optional progress callback for the UI.
export async function writeAndWait(client, address, fn, args, value = 0n, onStatus, attempt = 1) {
  try {
    onStatus && onStatus(`submitting ${fn}…`);
    const hash = await client.writeContract({ address, functionName: fn, args, value });
    onStatus && onStatus(`waiting for consensus (${hash.slice(0, 12)}…) — this can take a few minutes`);
    const receipt = await client.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 240 });
    return { hash, receipt };
  } catch (e) {
    if (attempt < 4 && isTransientSubmissionRevert(e)) {
      onStatus && onStatus(`transient submission revert on ${fn} (attempt ${attempt}); retrying…`);
      await sleep(4000 * attempt);
      return writeAndWait(client, address, fn, args, value, onStatus, attempt + 1);
    }
    throw e;
  }
}
