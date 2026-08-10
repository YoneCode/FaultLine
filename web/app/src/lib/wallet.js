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
// Ensures the wallet is on Bradbury first (assertChainMatch inside genlayer-js
// throws if it isn't, and we want a clean switch rather than an error).
//
// We do NOT pass the address as a plain string: that path ends in
// eth_sendTransaction, and the wallet then broadcasts with its own RPC stack —
// MetaMask's json-rpc engine emits STRING request ids, which the Bradbury Go
// gateway rejects ("cannot unmarshal string into Go struct field Request.id of
// type int"). Instead we hand over a "local"-type account whose signer
// delegates to the wallet's eth_signTransaction (sign-only, no broadcast);
// genlayer-js then takes its local-account branch and broadcasts the signed
// bytes itself via its direct JSON-RPC transport, which uses integer ids.
export async function getWriteClient(wallet) {
  if (!wallet) throw new Error("No wallet connected");
  await wallet.switchChain(BRADBURY_CHAIN_ID);
  const provider = await wallet.getEthereumProvider();
  const account = {
    address: wallet.address,
    type: "local",
    // genlayer-js calls this with a viem tx request; the wallet signs it and
    // returns the raw signed transaction without submitting anything.
    async signTransaction(tx) {
      const req = { from: wallet.address };
      for (const [k, v] of Object.entries(tx)) {
        if (k === "account" || v === undefined || v === null) continue;
        if (k === "type") { req.type = v === "legacy" ? "0x0" : v; continue; }
        req[k] = typeof v === "bigint" || typeof v === "number" ? `0x${v.toString(16)}` : v;
      }
      return provider.request({ method: "eth_signTransaction", params: [req] });
    },
  };
  return createClient({ chain: testnetBradbury, account, provider });
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

// sha256 of a UTF-8 string, hex, via the Web Crypto API (no dependency).
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
