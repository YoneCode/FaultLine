// Anchor FaultLine evidence on-chain and open a REAL investigation.
//
// Sequence (each step waits for ACCEPTED/FINALIZED before the next):
//   1. register_mandate(agent, mandate_url, mandate_sha256)  — per agent
//   2. record_trace_hash(trace_sha256, trace_url)
//   3. open_investigation(incident_id, trace_sha256, agent_ids, trace_text, mandate_texts)
//      with the bond — evidence is INLINE; the contract re-hashes it against the
//      anchored commitments and the LLM judges on the leader only.
//   4. read the finalized verdict back on-chain
//
// The private key is read from .env into memory only and never printed.
import "dotenv/config";
import { readFileSync } from "fs";
import path from "path";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const BOND_WEI = 10_000_000_000_000_000n; // 0.01 GEN (contract MIN_BOND_WEI)

let key = (process.env.ACCOUNT_PRIVATE_KEY || "").trim();
if (!key.startsWith("0x")) key = "0x" + key;
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) { console.error("Bad/missing ACCOUNT_PRIVATE_KEY in .env"); process.exit(1); }
const ADDRESS = (process.env.FAULTLINE_CONTRACT_ADDRESS || "").trim();
if (!/^0x[0-9a-fA-F]{40}$/.test(ADDRESS)) { console.error("FAULTLINE_CONTRACT_ADDRESS not set in .env"); process.exit(1); }

const manifest = JSON.parse(readFileSync(path.resolve("evidence/manifest.json"), "utf8"));
const account = createAccount(key);
const client = createClient({ chain: testnetBradbury, account });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A write can fail at the EVM-submission layer with "EVM tx ... was reverted"
// while the tx never reaches consensus (status UNINITIALIZED/IDLE) — a transient
// RPC/nonce hiccup, NOT a contract UserError. Those are safe to retry: a tx that
// never entered consensus had no effect. A revert that DID reach consensus (a real
// contract UserError) is NOT retried — it would just fail identically.
function isTransientSubmissionRevert(e) {
  const s = String(e && e.message ? e.message : e);
  return s.includes("was reverted") && s.includes("consensus contract");
}

// The public Bradbury RPC returns -32005 ("node is at capacity, retry in ~Nms")
// under load, BEFORE the tx is submitted — no gas spent, no state change — so it
// is always safe to retry. This flow issues several writes, so handle it here too.
function isCapacityLimit(e) {
  const s = JSON.stringify(e?.cause ?? e ?? "");
  return e?.code === -32005 || /-32005|node is at capacity|gas rate limit/i.test(s);
}
const capacityDelay = (e) => Number(e?.cause?.data?.retryAfterMs ?? e?.data?.retryAfterMs ?? 0);

async function write(fn, args, value = 0n, attempt = 1) {
  try {
    const hash = await client.writeContract({ address: ADDRESS, functionName: fn, args, value });
    const receipt = await client.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 200 });
    return { hash, receipt };
  } catch (e) {
    if (attempt < 12 && isCapacityLimit(e)) {
      const wait = Math.max(capacityDelay(e), 500) + attempt * 750;
      console.log(`  node at capacity on ${fn} (attempt ${attempt}); retrying in ${wait}ms...`);
      await sleep(wait);
      return write(fn, args, value, attempt + 1);
    }
    if (attempt < 4 && isTransientSubmissionRevert(e)) {
      console.log(`  transient submission revert on ${fn} (attempt ${attempt}); retrying...`);
      await sleep(4000 * attempt);
      return write(fn, args, value, attempt + 1);
    }
    throw e;
  }
}

const balanceBefore = await client.getBalance({ address: account.address });
console.log("deployer balance before:", balanceBefore.toString(), "wei\n");

// 1. mandates
for (const agent of manifest.agents) {
  const m = manifest.mandates[agent];
  const existing = await client.readContract({ address: ADDRESS, functionName: "get_mandate", args: [agent] });
  if (existing) { console.log(`mandate already anchored: ${agent}`); continue; }
  const { hash } = await write("register_mandate", [agent, m.url, m.sha256]);
  console.log(`mandate anchored: ${agent}  tx=${hash.slice(0, 18)}…`);
}

// 2. trace commitment
const t = manifest.trace;
const existingTrace = await client.readContract({ address: ADDRESS, functionName: "get_trace_commitment", args: [t.sha256] });
if (existingTrace) {
  console.log(`\ntrace already anchored: ${t.sha256.slice(0, 16)}…`);
} else {
  const { hash } = await write("record_trace_hash", [t.sha256, t.url]);
  console.log(`\ntrace anchored: ${t.sha256.slice(0, 16)}…  tx=${hash.slice(0, 18)}…`);
}

// 3. open investigation (bonded; evidence INLINE, LLM judges on the leader only)
const incident = manifest.incident_id;
const already = await client.readContract({ address: ADDRESS, functionName: "has_incident", args: [incident] });
if (already) {
  console.log(`\nincident already investigated: ${incident}`);
} else {
  console.log(`\nopening investigation ${incident} with ${manifest.agents.length} agents, bond 0.01 GEN…`);
  console.log("(leader runs the LLM judgment; validators verify deterministically — should FINALIZE, can take several minutes)");
  // Read the evidence bytes from disk (they hash-match the anchored commitments).
  const traceText = readFileSync(path.resolve("evidence/trace.ndjson"), "utf8");
  const mandateTexts = manifest.agents.map((a) =>
    readFileSync(path.resolve(`evidence/mandate-${a}.txt`), "utf8")
  );
  console.log(`(evidence inline: trace ${traceText.length} chars + ${mandateTexts.length} mandates; LLM judges on the leader, validators verify deterministically)`);
  const { hash } = await write(
    "open_investigation",
    [incident, t.sha256, manifest.agents, traceText, mandateTexts],
    BOND_WEI
  );
  console.log("investigation tx:", hash);
}

// 4. read the verdict
const raw = await client.readContract({ address: ADDRESS, functionName: "get_verdict", args: [incident] });
const balanceAfter = await client.getBalance({ address: account.address });
console.log("\n=== VERDICT (on-chain) ===");
if (!raw) { console.log("(no verdict stored)"); }
else {
  const v = JSON.parse(raw);
  for (const a of v.allocations) {
    console.log(`  ${String(a.fault_pct).padStart(3)}%  ${a.role.padEnd(12)} ${a.agent_id}  (within_mandate=${a.within_mandate}, trace_index=${a.trace_index})`);
    // v0.6.0 grounding: the cited event's action echoed verbatim, and for an
    // out-of-mandate finding the clause quoted verbatim from the anchored
    // mandate. Both were re-verified by every validator before this finalized.
    if (a.cited_action) console.log(`         cites trace[${a.trace_index}] action "${a.cited_action}"`);
    if (a.mandate_quote) console.log(`         clause  "${a.mandate_quote}"`);
  }
  console.log("  trace_is_single_source:", v.trace_is_single_source);
}

// 5. evidence attribution (v0.6.0 view; blank on older deployments)
let prov = "";
try {
  prov = await client.readContract({ address: ADDRESS, functionName: "get_evidence_provenance", args: [incident] });
} catch { /* view absent on pre-v0.6.0 contracts */ }
if (prov) {
  const p = JSON.parse(prov);
  console.log("\n=== EVIDENCE SOURCES (on-chain) ===");
  console.log("  trace recorder :", p.trace_recorder);
  console.log("  opened by      :", p.opener, "at", p.opened_at);
  for (const [agent, op] of Object.entries(p.mandate_operators || {})) {
    console.log(`  mandate operator ${agent.padEnd(26)} ${op}`);
  }
}
console.log("\ndeployer balance after :", balanceAfter.toString(), "wei");
console.log("net (before-after)     :", (balanceBefore - balanceAfter).toString(), "wei (gas; bond refunded on finalize)");
console.log("\nexplorer:", `https://explorer-bradbury.genlayer.com/address/${ADDRESS}`);
