import React, { useEffect, useState } from "react";
import { useAccount, useChainId, useSwitchChain, useBalance } from "wagmi";
import { getMode, getContractAddress, readLive, saveEvidence } from "../lib/client.js";
import { BRADBURY_CHAIN_ID, EXPLORER, getWriteClient, writeAndWait, sha256Hex, explorerTxUrl, BOND_WEI, registerProxyRpc } from "../lib/wallet.js";
import { LIVE_INCIDENT_ID } from "../lib/liveEvidence.js";

// ── small form primitives (inline styles to match the existing design system) ──
const fieldLabel = { display: "block", fontSize: 11, letterSpacing: "0.08em", color: "var(--ink-2)", marginBottom: 6, textTransform: "uppercase" };
const input = {
  width: "100%", boxSizing: "border-box", background: "var(--bg-1)", border: "1px solid var(--line)",
  color: "var(--ink-0)", fontFamily: "var(--font-mono)", fontSize: 13, padding: "10px 12px", borderRadius: 2,
};
const textarea = { ...input, minHeight: 110, resize: "vertical", lineHeight: 1.5 };

// Raw wallet/viem errors are meaningless to operators — map the common ones.
function friendlyError(e) {
  const s = String(e && e.message ? e.message : e);
  if (/user rejected|user denied|rejected the request|denied transaction/i.test(s))
    return "signing cancelled — nothing was submitted";
  if (/insufficient funds/i.test(s))
    return "not enough GEN for gas + the 0.01 GEN bond — fund this wallet with Bradbury testnet GEN first";
  if (/cannot unmarshal .*Request\.id|Parse error as single request/i.test(s))
    return "your wallet broadcast with a string RPC id and Bradbury rejected it — reload the page, approve the one-time “update network” prompt (it points your wallet at our id-normalizing RPC), and retry. Your evidence is fine.";
  return s;
}

// Mirrors contracts/faultline.py FORBIDDEN_TOKENS — the contract rejects these
// pre-consensus, so we reject them before the wallet ever opens.
const FORBIDDEN_TOKENS = [
  "ignore previous", "ignore all previous", "system:", "assistant:",
  "you are now", "override your", "disregard", "<|im_start|>", "<|im_end|>",
  "[inst]", "[/inst]",
];
function scanForbidden(label, text) {
  const low = text.toLowerCase();
  const hit = FORBIDDEN_TOKENS.find((t) => low.includes(t));
  if (hit) throw new Error(`${label} contains the contract-blocked token "${hit}" — the contract rejects prompt-injection phrases; reword it`);
}

// Deterministic limits and trace rules copied from contracts/faultline.py. Each
// one reverts pre-consensus — i.e. after the wallet signed and gas was spent —
// so they are enforced here first, and every message names the fix.
const MAX_TRACE_CHARS = 24_000;
const MAX_MANDATE_CHARS = 8_000;
const MAX_AGENTS = 16;
const MIN_TRACE_EVENTS = 2;
const SINGLE_SOURCE_MAX_PCT = 60;

// Mirror of the contract's _parse_trace: strict, because every allocation cites
// a POSITION in this list. A line whose `idx` disagrees with its position would
// let a verdict cite one event while the report renders another, so the contract
// rejects it outright.
function parseTraceLikeContract(traceText) {
  const events = traceText
    .split("\n")
    .filter((l) => l.trim())
    .map((line, pos) => {
      let ev;
      try { ev = JSON.parse(line); }
      catch { throw new Error(`trace line ${pos} is not valid JSON — the contract would reject it`); }
      if (!ev || typeof ev !== "object" || Array.isArray(ev))
        throw new Error(`trace line ${pos} is not a JSON object — one event object per line`);
      for (const f of ["agent_id", "action", "recorder"])
        if (f in ev && typeof ev[f] !== "string")
          throw new Error(`trace line ${pos}: "${f}" must be a string`);
      const declared = "idx" in ev ? ev.idx : pos;
      if (!Number.isInteger(declared) || declared !== pos)
        throw new Error(`trace line ${pos} declares idx ${JSON.stringify(declared)} — idx must equal the line's own position, since the verdict cites trace[N] by position`);
      return {
        agent_id: (ev.agent_id ?? "").trim(),
        action: (ev.action ?? "").trim(),
        recorder: (ev.recorder ?? "").trim(),
      };
    });
  if (events.length < MIN_TRACE_EVENTS)
    throw new Error(`the trace holds ${events.length} event(s) — at least ${MIN_TRACE_EVENTS} are needed to apportion fault between agents`);
  return events;
}

// Ticking elapsed readout for long consensus waits — the instrument never goes quiet.
function Elapsed({ since }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((Date.now() - since) / 1000);
  return (
    <span className="mono" style={{ color: "var(--ink-3)" }}>
      {" · "}t+{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

function Status({ state }) {
  if (!state) return null;
  const color = state.kind === "err" ? "var(--red)" : state.kind === "ok" ? "var(--green)" : "var(--cyan)";
  return (
    <div
      className={`callout ${state.kind === "err" ? "red" : ""}`}
      style={{ marginTop: 14, borderColor: state.kind === "err" ? undefined : color }}
      role={state.kind === "err" ? "alert" : "status"}
      aria-live={state.kind === "err" ? undefined : "polite"}
    >
      <span style={{ color }}>{state.kind === "err" ? "✕" : state.kind === "ok" ? "✓" : "…"}</span>
      <span style={{ color: state.kind === "err" ? undefined : "var(--ink-1)" }}>
        {state.msg}
        {state.kind === "run" && state.since && <Elapsed since={state.since} />}
        {state.hash && (
          <>
            {" "}
            <a href={explorerTxUrl(state.hash)} target="_blank" rel="noreferrer" aria-label="View transaction on the GenLayer Bradbury explorer" style={{ color: "var(--cyan)" }}>
              view tx on explorer ↗
            </a>
          </>
        )}
      </span>
    </div>
  );
}

// Preflight readout shown once a wallet is connected: the operator sees the
// chain, their balance vs the bond, and the exact contract they are about to
// write to — before signing anything. A forensic tool names its target.
function Preflight() {
  const { address } = useAccount();
  const chainId = useChainId();
  const contract = getContractAddress();
  const { data: bal } = useBalance({ address, chainId: BRADBURY_CHAIN_ID });
  const chainOk = chainId === BRADBURY_CHAIN_ID;
  const balOk = bal != null && bal.value >= BOND_WEI;
  return (
    <div className="panel panel-pad" style={{ marginBottom: 18 }} aria-label="Write preflight">
      <div className="spec">
        <div className="spec-row">
          <span className="spec-k">chain</span>
          <span className="spec-v" style={{ color: chainOk ? "var(--green)" : "var(--amber)" }}>
            {chainOk ? "GenLayer Bradbury (4221) ✓" : "not on Bradbury — you will be asked to switch on write"}
          </span>
        </div>
        <div className="spec-row">
          <span className="spec-k">balance</span>
          <span className="spec-v" style={{ color: bal == null ? undefined : balOk ? "var(--green)" : "var(--red)" }}>
            {bal == null
              ? "reading…"
              : `${Number(bal.formatted).toFixed(4)} GEN ${balOk ? "· covers the bond ✓" : "· below the 0.01 GEN bond — fund this wallet with Bradbury testnet GEN"}`
            }
          </span>
        </div>
        <div className="spec-row">
          <span className="spec-k">contract</span>
          <span className="spec-v">
            <a className="mono" href={`${EXPLORER}/address/${contract}`} target="_blank" rel="noreferrer" style={{ color: "var(--cyan)" }}>
              {contract.slice(0, 10)}…{contract.slice(-8)} ↗
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}

// One-time network setup. MetaMask relays signed transactions to Bradbury with
// string JSON-RPC ids, which the gateway rejects ("cannot unmarshal string into
// Go struct field Request.id of type int"). FaultLine serves an id-normalizing
// RPC at /rpc — the fix is pointing the wallet at it once. Shown on the page so
// an operator can apply it deliberately, before the first write.
function RpcSetup() {
  const [msg, setMsg] = useState(null);
  const url = typeof window !== "undefined" ? `${window.location.origin}/rpc` : "/rpc";

  async function addToWallet() {
    setMsg(null);
    const provider = window.ethereum;
    if (!provider) {
      setMsg({ kind: "err", text: "no browser wallet found on this page — paste the URL into your wallet's network settings manually" });
      return;
    }
    const ok = await registerProxyRpc(provider);
    setMsg(ok
      ? { kind: "ok", text: "Bradbury RPC updated in your wallet ✓ — writes will now route through the id normalizer" }
      : { kind: "err", text: "wallet declined the update — use the manual path below, or retry" });
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setMsg({ kind: "ok", text: "RPC URL copied ✓" });
    } catch {
      setMsg({ kind: "err", text: "copy failed — click the URL to select it, then copy manually" });
    }
  }

  return (
    <div className="panel panel-pad" style={{ marginBottom: 18 }}>
      <div className="row between">
        <h2 style={{ fontSize: 15 }}>Bradbury RPC · one-time wallet setup</h2>
        <span className="tag tag--cyan">write path</span>
      </div>
      <p className="faint mono mt-8" style={{ fontSize: 12, lineHeight: 1.6, maxWidth: "72ch" }}>
        MetaMask broadcasts your signed transaction to Bradbury with string JSON-RPC ids; the gateway
        only accepts integer ids and refuses the broadcast before it reaches consensus. This site serves
        an id-normalizing RPC — same upstream node, ids rewritten both ways — at the URL below. Point
        your wallet at it once and writes clear the gateway. Your keys never leave the wallet; the proxy
        touches message ids only.
      </p>
      <div className="row mt-16" style={{ gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
        <code
          className="mono"
          title="click to select"
          style={{
            flex: "1 1 260px", display: "flex", alignItems: "center", background: "var(--bg-1)",
            border: "1px solid var(--line)", borderRadius: 2, padding: "8px 12px", fontSize: 12,
            color: "var(--ink-1)", overflowWrap: "anywhere", userSelect: "all",
          }}
        >
          {url}
        </code>
        <button className="btn btn--ghost" style={{ whiteSpace: "nowrap" }} onClick={copyUrl}>
          Copy RPC URL
        </button>
        <button className="btn btn--primary" style={{ whiteSpace: "nowrap" }} onClick={addToWallet}>
          Add to wallet
        </button>
      </div>
      <p className="faint mono mt-8" style={{ fontSize: 11 }}>
        manual path: MetaMask → Settings → Networks → GenLayer Bradbury → default RPC URL → paste the URL above
      </p>
      <Status state={msg ? { kind: msg.kind, msg: msg.text } : null} />
    </div>
  );
}

function ConnectGate({ children }) {
  // wagmi-based gate: a connected wallet is sufficient for writes. We build the
  // same {address, switchChain, getEthereumProvider} shape getWriteClient expects,
  // from wagmi's connector — so the existing write path works unchanged.
  const { address, connector, status } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  if (status === "reconnecting") return <p className="mono muted">loading wallet…</p>;

  // Adapter so getWriteClient (which expects switchChain + getEthereumProvider)
  // works with wagmi's connector.
  const wallet = address && connector
    ? {
        address,
        async switchChain(chainId) {
          await switchChainAsync({ chainId });
        },
        async getEthereumProvider() {
          // wagmi connectors expose an EIP-1193 provider via getProvider.
          return connector.getProvider ? connector.getProvider() : connector;
        },
      }
    : null;

  // The form renders read-only behind the gate — the three steps are the best
  // explanation of what connecting commits you to. fieldset[disabled] pulls
  // every control out of tab order and click range in one move.
  return (
    <>
      {!wallet && (
        <div className="callout" style={{ marginBottom: 18 }}>
          <span>●</span>
          <span>
            Connect a wallet from the nav bar to run these steps. You sign with your own wallet on
            GenLayer Bradbury — FaultLine never sees a private key. The steps below are shown
            read-only until you connect.
          </span>
        </div>
      )}
      {wallet && <Preflight />}
      <fieldset disabled={!wallet} style={{ display: "contents", border: 0, margin: 0, padding: 0 }}>
        <div className="grid" style={{ gap: 18, opacity: wallet ? 1 : 0.45, transition: "opacity 0.2s" }}>
          {children(wallet)}
        </div>
      </fieldset>
    </>
  );
}

// Step-heading completion mark — persistent evidence that a step is done.
function DoneTag({ children }) {
  return <span className="tag tag--green">✓ {children}</span>;
}

// One mandate field per agent in step 3. The contract requires the open-time
// text to sha256-match the digest anchored in step 1 BYTE-FOR-BYTE — a stray
// trailing newline from a chat paste is enough to fail. So each field is
// hashed raw (no trimming) and checked live against the on-chain record: the
// operator watches the ✓ appear instead of discovering the mismatch at submit.
function MandateField({ agent, value, onChange }) {
  const [check, setCheck] = useState(null); // {state: "busy"|"match"|"mismatch"|"none", mine, onchain}
  useEffect(() => {
    if (!value) { setCheck(null); return; }
    let cancelled = false;
    setCheck({ state: "busy" });
    const t = setTimeout(async () => {
      try {
        const mine = await sha256Hex(value);
        const raw = await readLive("get_mandate", [agent]);
        if (cancelled) return;
        const rec = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
        if (!rec || !rec.sha256) { setCheck({ state: "none", mine }); return; }
        const onchain = String(rec.sha256).toLowerCase().replace(/^0x/, "");
        setCheck({ state: onchain === mine ? "match" : "mismatch", mine, onchain });
      } catch { if (!cancelled) setCheck(null); }
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [agent, value]);

  const line = !check ? null
    : check.state === "busy" ? { color: "var(--ink-3)", text: "…checking against the anchored digest" }
    : check.state === "match" ? { color: "var(--green)", text: `✓ matches the anchored mandate · sha256 ${check.mine.slice(0, 16)}…` }
    : check.state === "none" ? { color: "var(--amber)", text: `no mandate anchored for ${agent} yet — anchor it in step 1` }
    : { color: "var(--red)", text: `✗ digest mismatch — on-chain ${check.onchain.slice(0, 16)}… ≠ this text ${check.mine.slice(0, 16)}… · the text must be byte-identical to what you anchored (a trailing newline counts)` };

  return (
    <div style={{ marginTop: 12 }}>
      <label htmlFor={`i-mandate-${agent}`} style={fieldLabel}>mandate for {agent}</label>
      <textarea
        id={`i-mandate-${agent}`}
        style={{ ...textarea, minHeight: 90 }}
        value={value}
        onChange={(e) => onChange(agent, e.target.value)}
      />
      {line && <p className="mono" style={{ fontSize: 11, marginTop: 6, color: line.color }} aria-live="polite">{line.text}</p>}
    </div>
  );
}

// Live read-out of the two facts the contract derives from the trace itself, so
// they are visible before signing: who actually acts in it (v0.6.0 pins an agent
// that never acts to 0%, since it has no event of its own to cite) and how many
// recorders corroborate it (a single-recorder trace caps any one agent's share).
function GroundingHint({ traceText, agentList }) {
  if (!traceText.trim() || agentList.length === 0) return null;
  let events;
  try {
    events = parseTraceLikeContract(traceText);
  } catch (e) {
    return (
      <p className="mono" style={{ fontSize: 11, marginTop: 6, color: "var(--red)" }} aria-live="polite">
        ✗ {e.message}
      </p>
    );
  }
  const present = new Set(events.map((e) => e.agent_id).filter(Boolean));
  const absent = agentList.filter((a) => !present.has(a));
  const recorders = new Set(events.map((e) => e.recorder).filter(Boolean));
  const single = recorders.size <= 1;
  return (
    <p className="mono" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.7, color: "var(--ink-3)" }} aria-live="polite">
      {events.length} events · {recorders.size} recorder{recorders.size === 1 ? "" : "s"}
      {single ? (
        <span style={{ color: "var(--amber)" }}> · single-source: no agent may exceed {SINGLE_SOURCE_MAX_PCT}%</span>
      ) : (
        <span style={{ color: "var(--green)" }}> · corroborated by multiple recorders ✓</span>
      )}
      {absent.length > 0 && (
        <>
          <br />
          <span style={{ color: "var(--amber)" }}>
            {absent.join(", ")} never act{absent.length === 1 ? "s" : ""} in this trace — the verdict
            must give {absent.length === 1 ? "it" : "them"} exactly 0%
          </span>
        </>
      )}
    </p>
  );
}

export default function Investigate() {
  const live = getMode() === "live";
  const contract = getContractAddress();

  // Step 1 — mandate
  const [mAgent, setMAgent] = useState("");
  const [mUri, setMUri] = useState("");
  const [mText, setMText] = useState("");
  const [mStatus, setMStatus] = useState(null);
  const [mBusy, setMBusy] = useState(false);

  // Step 2 — trace
  const [tUri, setTUri] = useState("");
  const [tText, setTText] = useState("");
  const [tStatus, setTStatus] = useState(null);
  const [tBusy, setTBusy] = useState(false);

  // Step 3 — investigation
  const [incident, setIncident] = useState(live ? `${LIVE_INCIDENT_ID}-` : "");
  const [agents, setAgents] = useState("");
  const [traceSha, setTraceSha] = useState("");
  const [shaCarried, setShaCarried] = useState(false);
  const [traceText, setTraceText] = useState("");
  const [mandateMap, setMandateMap] = useState({}); // agent id -> raw text, byte-exact
  const [iStatus, setIStatus] = useState(null);
  const [iBusy, setIBusy] = useState(false);
  const [finalId, setFinalId] = useState(null);

  const agentList = agents.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  // Raw bytes per agent — NO trimming. The contract sha256-compares these
  // against the step-1 anchors; whitespace is part of the evidence.
  const mandateList = agentList.map((a) => mandateMap[a] ?? "");

  async function anchorMandate(wallet) {
    const since = Date.now();
    setMBusy(true); setMStatus({ kind: "run", msg: "hashing mandate…", since });
    try {
      if (!mAgent.trim()) throw new Error("agent id is required");
      if (!mText.trim()) throw new Error("mandate text is required");
      const digest = await sha256Hex(mText);
      const client = await getWriteClient(wallet);
      const tick = (m) => setMStatus({ kind: "run", msg: `sha256 ${digest.slice(0, 12)}… · ${m}`, since });
      const raw = await client.readContract({ address: contract, functionName: "get_mandate", args: [mAgent.trim()] });
      const existing = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
      if (existing && existing.sha256) {
        // Never green-tick an anchor without proving it is THIS text: compare digests.
        const onchain = String(existing.sha256).toLowerCase().replace(/^0x/, "");
        if (onchain === digest) {
          setMStatus({ kind: "ok", msg: `mandate already anchored for ${mAgent.trim()} · on-chain digest matches yours ✓`, });
        } else {
          setMStatus({
            kind: "err",
            msg: `a DIFFERENT mandate is already anchored for ${mAgent.trim()} — on-chain ${onchain.slice(0, 12)}… ≠ yours ${digest.slice(0, 12)}…. Mandates are immutable: use the anchored text or a different agent id.`,
          });
        }
        return;
      }
      const { hash } = await writeAndWait(client, contract, "register_mandate", [mAgent.trim(), mUri.trim(), digest], 0n, tick);
      setMStatus({ kind: "ok", msg: `mandate anchored for ${mAgent.trim()} · sha256 ${digest.slice(0, 16)}…`, hash });
    } catch (e) {
      setMStatus({ kind: "err", msg: friendlyError(e) });
    } finally { setMBusy(false); }
  }

  async function anchorTrace(wallet) {
    const since = Date.now();
    setTBusy(true); setTStatus({ kind: "run", msg: "hashing trace…", since });
    try {
      if (!tText.trim()) throw new Error("trace (ndjson) is required");
      const digest = await sha256Hex(tText);
      const client = await getWriteClient(wallet);
      const tick = (m) => setTStatus({ kind: "run", msg: `sha256 ${digest.slice(0, 12)}… · ${m}`, since });
      const raw = await client.readContract({ address: contract, functionName: "get_trace_commitment", args: [digest] });
      const existing = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
      if (existing) {
        setTStatus({ kind: "ok", msg: `trace already anchored · sha256 ${digest.slice(0, 16)}…` });
        setTraceSha(digest); setShaCarried(true); setTraceText(tText);
        return;
      }
      const { hash } = await writeAndWait(client, contract, "record_trace_hash", [digest, tUri.trim()], 0n, tick);
      setTStatus({ kind: "ok", msg: `trace anchored · sha256 ${digest.slice(0, 16)}…`, hash });
      setTraceSha(digest); setShaCarried(true); setTraceText(tText); // carry into step 3
    } catch (e) {
      setTStatus({ kind: "err", msg: friendlyError(e) });
    } finally { setTBusy(false); }
  }

  async function openInvestigation(wallet) {
    const since = Date.now();
    setIBusy(true); setIStatus({ kind: "run", msg: "preparing…", since }); setFinalId(null);
    try {
      const id = incident.trim();
      if (!id) throw new Error("incident id is required");
      if (agentList.length < 2) throw new Error("list at least 2 agents");
      if (!/^[0-9a-f]{64}$/.test(traceSha)) throw new Error("anchor the trace in step 2 first (need its sha256)");
      if (!traceText.trim()) throw new Error("paste the trace text (must hash to the anchored sha256)");
      for (const [i, m] of mandateList.entries())
        if (!m.trim()) throw new Error(`mandate text missing for ${agentList[i]}`);
      // client-side sanity: the inline evidence must hash to the anchored commitments
      const digest = await sha256Hex(traceText);
      if (digest !== traceSha) throw new Error("trace text does not hash to the anchored sha256 — the contract would reject it");

      const client = await getWriteClient(wallet);
      const already = await client.readContract({ address: contract, functionName: "has_incident", args: [id] });
      if (already) throw new Error(`incident already investigated: ${id}`);

      // Mirror the contract's pre-consensus checks locally — a guaranteed
      // revert should never reach the wallet. Each failure names the fix.
      scanForbidden("the trace", traceText);
      mandateList.forEach((m, i) => scanForbidden(`mandate ${i + 1}`, m));
      if (traceText.length > MAX_TRACE_CHARS)
        throw new Error(`the trace is ${traceText.length} chars — the contract caps inline evidence at ${MAX_TRACE_CHARS}; split the incident or trim non-material events`);
      if (agentList.length > MAX_AGENTS)
        throw new Error(`${agentList.length} agents listed — the contract caps an investigation at ${MAX_AGENTS}`);
      mandateList.forEach((m, i) => {
        if (m.length > MAX_MANDATE_CHARS)
          throw new Error(`the mandate for ${agentList[i]} is ${m.length} chars — the contract caps one mandate at ${MAX_MANDATE_CHARS}`);
      });
      // Trace shape + the apportionment guards: v0.6.0 requires every fault
      // allocation to cite an event its own agent performed, so an agent that
      // never acts in the trace is pinned to 0% and cannot carry the verdict.
      const events = parseTraceLikeContract(traceText);
      const present = new Set(events.map((e) => e.agent_id).filter(Boolean));
      const named = agentList.filter((a) => present.has(a));
      if (named.length === 0)
        throw new Error("none of the listed agents appears in the trace — the ids here must match the trace's agent_id values character for character");
      const recorders = new Set(events.map((e) => e.recorder).filter(Boolean));
      if (recorders.size <= 1 && named.length < 2)
        throw new Error(`this trace has a single recorder and only one listed agent acting in it — under the ${SINGLE_SOURCE_MAX_PCT}% cap on uncorroborated evidence the shares cannot reach 100%, so no valid verdict exists; add the other agents' events or a second recorder`);
      for (const [i, a] of agentList.entries()) {
        const raw = await client.readContract({ address: contract, functionName: "get_mandate", args: [a] });
        const rec = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
        if (!rec || !rec.sha256) throw new Error(`no pre-anchored mandate for ${a} — anchor it in step 1 first`);
        const d = await sha256Hex(mandateList[i]);
        if (String(rec.sha256).toLowerCase().replace(/^0x/, "") !== d)
          throw new Error(`mandate ${i + 1} (${a}) does not match its anchored digest — the text must be byte-identical to what you anchored in step 1 (a trailing newline counts); the field above shows the live comparison`);
      }
      const traceCommit = await client.readContract({ address: contract, functionName: "get_trace_commitment", args: [digest] });
      if (!traceCommit) throw new Error("trace digest is not anchored on-chain — run step 2 first");

      const { hash } = await writeAndWait(
        client, contract, "open_investigation",
        [id, traceSha, agentList, traceText, mandateList],
        BOND_WEI,
        (m) => setIStatus({ kind: "run", msg: `${m} · leader runs the LLM judgment, validators verify deterministically`, since })
      );
      setIStatus({ kind: "ok", msg: `investigation finalized for ${id} — bond refunded`, hash });
      setFinalId(id);
      // The contract stores only the verdict + sha256 commitments — the
      // evidence bytes rode in as calldata. Cache them locally so the report
      // page can render the trace/mandates (re-verified against the digests
      // before display). The verdict itself is always read from the chain.
      saveEvidence(id, {
        traceText,
        traceSha,
        traceUri: tUri.trim(),
        agents: agentList,
        mandates: Object.fromEntries(agentList.map((a, i) => [a, mandateList[i]])),
        txHash: hash,
        openedAt: new Date().toISOString(),
      });
    } catch (e) {
      setIStatus({ kind: "err", msg: friendlyError(e) });
    } finally { setIBusy(false); }
  }

  return (
    <main className="shell section" style={{ paddingTop: 32 }}>
      <span className="eyebrow">Run an investigation</span>
      <h1 className="mt-8" style={{ fontSize: "clamp(24px,3.4vw,40px)" }}>
        Anchor evidence. Open a bonded investigation.
      </h1>
      <p className="muted" style={{ maxWidth: "62ch" }}>
        Three on-chain steps against the live contract. Evidence is hash-committed <b>before</b> the
        incident, then re-hashed inline at open time — so the judgment can only rest on untampered
        evidence. You sign each step with your own wallet on GenLayer Bradbury; the 0.01 GEN bond is
        refunded when the verdict finalizes.
      </p>

      {!live && (
        <div className="callout red" style={{ marginTop: 18 }}>
          <span>✕</span>
          <span>The app is in demo mode — set VITE_FAULTLINE_ADDRESS to the deployed contract to enable writes.</span>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <RpcSetup />
        <ConnectGate>
          {(wallet) => (
            <>
              <div className="panel panel-pad" aria-busy={mBusy}>
                <div className="row between">
                  <h2 style={{ fontSize: 18 }}>1 · Anchor a mandate</h2>
                  <span className="row" style={{ gap: 6 }}>
                    {mStatus?.kind === "ok" && <DoneTag>anchored</DoneTag>}
                    <span className="tag tag--cyan">pre-incident</span>
                  </span>
                </div>
                <p className="faint mono mt-8" style={{ fontSize: 12 }}>
                  one per agent · immutable once anchored · the text is hashed in your browser
                </p>
                <div className="grid grid--2 mt-16" style={{ gap: 12 }}>
                  <div>
                    <label htmlFor="m-agent" style={fieldLabel}>agent id</label>
                    <input id="m-agent" style={input} placeholder="planner@orbit-ops" value={mAgent} onChange={(e) => setMAgent(e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="m-uri" style={fieldLabel}>mandate uri (optional)</label>
                    <input id="m-uri" style={input} placeholder="ipfs://…" value={mUri} onChange={(e) => setMUri(e.target.value)} />
                  </div>
                </div>
                <div className="mt-16">
                  <label htmlFor="m-text" style={fieldLabel}>mandate text</label>
                  <textarea id="m-text" style={textarea} placeholder="The agent's declared charter — what it is and is not permitted to do." value={mText} onChange={(e) => setMText(e.target.value)} />
                </div>
                <button className="btn btn--primary mt-16" disabled={mBusy || !live} onClick={() => anchorMandate(wallet)}>
                  {mBusy ? "anchoring…" : "Anchor mandate"}
                </button>
                <Status state={mStatus} />
              </div>

              <div className="panel panel-pad" aria-busy={tBusy}>
                <div className="row between">
                  <h2 style={{ fontSize: 18 }}>2 · Anchor the trace</h2>
                  <span className="row" style={{ gap: 6 }}>
                    {tStatus?.kind === "ok" && <DoneTag>anchored</DoneTag>}
                    <span className="tag tag--cyan">pre-incident</span>
                  </span>
                </div>
                <p className="faint mono mt-8" style={{ fontSize: 12 }}>
                  content hash committed on-chain · the blob itself stays off-chain (content-addressed)
                </p>
                <div className="mt-16">
                  <label htmlFor="t-uri" style={fieldLabel}>trace uri (optional)</label>
                  <input id="t-uri" style={input} placeholder="ipfs://…" value={tUri} onChange={(e) => setTUri(e.target.value)} />
                </div>
                <div className="mt-16">
                  <label htmlFor="t-text" style={fieldLabel}>trace (ndjson — one event per line)</label>
                  <textarea id="t-text" style={textarea} placeholder='{"idx":0,"agent_id":"scout@acme-research","action":"…","detail":"…","recorder":"…"}' value={tText} onChange={(e) => setTText(e.target.value)} />
                </div>
                <button className="btn btn--primary mt-16" disabled={tBusy || !live} onClick={() => anchorTrace(wallet)}>
                  {tBusy ? "anchoring…" : "Anchor trace"}
                </button>
                <Status state={tStatus} />
              </div>

              <div className="panel panel-pad" aria-busy={iBusy}>
                <div className="row between">
                  <h2 style={{ fontSize: 18 }}>3 · Open investigation</h2>
                  <span className="row" style={{ gap: 6 }}>
                    {finalId && <DoneTag>finalized</DoneTag>}
                    <span className="tag tag--amber">bond 0.01 GEN</span>
                  </span>
                </div>
                <p className="faint mono mt-8" style={{ fontSize: 12 }}>
                  evidence rides inline · the contract re-hashes it · leader LLM judges · validators verify deterministically
                </p>
                <div className="grid grid--2 mt-16" style={{ gap: 12 }}>
                  <div>
                    <label htmlFor="i-id" style={fieldLabel}>incident id</label>
                    <input id="i-id" style={input} value={incident} onChange={(e) => setIncident(e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="i-sha" style={fieldLabel}>
                      trace sha256 (from step 2)
                      {shaCarried && <span style={{ color: "var(--green)" }}> · carried from step 2 ✓</span>}
                    </label>
                    <input id="i-sha" style={input} value={traceSha} onChange={(e) => { setTraceSha(e.target.value.trim()); setShaCarried(false); }} placeholder="64 hex chars" />
                  </div>
                </div>
                <div className="mt-16">
                  <label htmlFor="i-agents" style={fieldLabel}>agents (comma or newline separated)</label>
                  <textarea id="i-agents" style={{ ...textarea, minHeight: 70 }} placeholder={"scout@acme-research\nplanner@orbit-ops\ncompliance@verity-guard"} value={agents} onChange={(e) => setAgents(e.target.value)} />
                </div>
                <div className="mt-16">
                  <label htmlFor="i-trace" style={fieldLabel}>trace text (must hash to the sha256 above)</label>
                  <textarea id="i-trace" style={textarea} value={traceText} onChange={(e) => setTraceText(e.target.value)} />
                  <GroundingHint traceText={traceText} agentList={agentList} />
                </div>
                <div className="mt-16">
                  <span style={fieldLabel}>mandate texts — one field per agent, byte-exact as anchored in step 1</span>
                  {agentList.length === 0 && (
                    <p className="faint mono" style={{ fontSize: 12, marginTop: 8 }}>list the agents above first — one field appears per agent</p>
                  )}
                  {agentList.map((a) => (
                    <MandateField
                      key={a}
                      agent={a}
                      value={mandateMap[a] ?? ""}
                      onChange={(agent, v) => setMandateMap((m) => ({ ...m, [agent]: v }))}
                    />
                  ))}
                </div>
                <button className="btn btn--primary mt-16" disabled={iBusy || !live} onClick={() => openInvestigation(wallet)}>
                  {iBusy ? "running… (LLM consensus, can take several minutes)" : "Open investigation · lock 0.01 GEN bond"}
                </button>
                <Status state={iStatus} />
                {finalId && (
                  <div className="callout" style={{ marginTop: 14, borderColor: "var(--green)" }} role="status">
                    <span style={{ color: "var(--green)" }}>✓</span>
                    <span>
                      Verdict finalized on-chain.{" "}
                      <a href={`#/report/${finalId}`} style={{ color: "var(--cyan)" }}>Read the black-box report →</a>
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </ConnectGate>
      </div>
    </main>
  );
}
