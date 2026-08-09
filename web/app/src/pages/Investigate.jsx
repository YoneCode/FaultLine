import React, { useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { getMode, getContractAddress } from "../lib/client.js";
import { pickWallet, getWriteClient, writeAndWait, sha256Hex, explorerTxUrl, BOND_WEI } from "../lib/wallet.js";
import { LIVE_INCIDENT_ID } from "../lib/liveEvidence.js";

// ── small form primitives (inline styles to match the existing design system) ──
const fieldLabel = { display: "block", fontSize: 11, letterSpacing: "0.08em", color: "var(--ink-2)", marginBottom: 6, textTransform: "uppercase" };
const input = {
  width: "100%", boxSizing: "border-box", background: "var(--bg-1)", border: "1px solid var(--line)",
  color: "var(--ink-0)", fontFamily: "var(--font-mono)", fontSize: 13, padding: "10px 12px", borderRadius: 2,
};
const textarea = { ...input, minHeight: 110, resize: "vertical", lineHeight: 1.5 };

function Status({ state }) {
  if (!state) return null;
  const color = state.kind === "err" ? "var(--red)" : state.kind === "ok" ? "var(--green)" : "var(--cyan)";
  return (
    <div className={`callout ${state.kind === "err" ? "red" : ""}`} style={{ marginTop: 14, borderColor: state.kind === "err" ? undefined : color }}>
      <span style={{ color }}>{state.kind === "err" ? "✕" : state.kind === "ok" ? "✓" : "…"}</span>
      <span style={{ color: state.kind === "err" ? undefined : "var(--ink-1)" }}>
        {state.msg}
        {state.hash && (
          <>
            {" "}
            <a href={explorerTxUrl(state.hash)} target="_blank" rel="noreferrer" style={{ color: "var(--cyan)" }}>
              view tx ↗
            </a>
          </>
        )}
      </span>
    </div>
  );
}

function ConnectGate({ children }) {
  // Connect-only flow (no SIWE): a connected wallet is sufficient — we gate on
  // the wallet presence, not `authenticated`, which stays false without a sign-in.
  const { ready, connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const wallet = pickWallet(wallets);
  if (!ready) return <p className="mono muted">loading wallet…</p>;
  if (!wallet) {
    return (
      <div className="callout">
        <span>●</span>
        <span>
          Connect a wallet to run an investigation. You sign with your own wallet on GenLayer
          Bradbury — FaultLine never sees a private key.{" "}
          <button className="btn btn--primary" style={{ marginLeft: 10, padding: "6px 12px", fontSize: 12 }} onClick={() => connectWallet()}>
            Connect wallet
          </button>
        </span>
      </div>
    );
  }
  return children(wallet);
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
  const [traceText, setTraceText] = useState("");
  const [mandateTexts, setMandateTexts] = useState(""); // one per agent, blank-line separated
  const [iStatus, setIStatus] = useState(null);
  const [iBusy, setIBusy] = useState(false);
  const [finalId, setFinalId] = useState(null);

  const agentList = useMemo(
    () => agents.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
    [agents]
  );
  const mandateList = useMemo(
    () => mandateTexts.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean),
    [mandateTexts]
  );

  async function anchorMandate(wallet) {
    setMBusy(true); setMStatus({ kind: "run", msg: "hashing mandate…" });
    try {
      if (!mAgent.trim()) throw new Error("agent id is required");
      if (!mText.trim()) throw new Error("mandate text is required");
      const digest = await sha256Hex(mText);
      const client = await getWriteClient(wallet);
      const existing = await client.readContract({ address: contract, functionName: "get_mandate", args: [mAgent.trim()] });
      if (existing) { setMStatus({ kind: "ok", msg: `mandate already anchored for ${mAgent.trim()}` }); return; }
      const { hash } = await writeAndWait(client, contract, "register_mandate", [mAgent.trim(), mUri.trim(), digest], 0n, (m) => setMStatus({ kind: "run", msg: m }));
      setMStatus({ kind: "ok", msg: `mandate anchored for ${mAgent.trim()} · sha256 ${digest.slice(0, 16)}…`, hash });
    } catch (e) {
      setMStatus({ kind: "err", msg: String(e && e.message ? e.message : e) });
    } finally { setMBusy(false); }
  }

  async function anchorTrace(wallet) {
    setTBusy(true); setTStatus({ kind: "run", msg: "hashing trace…" });
    try {
      if (!tText.trim()) throw new Error("trace (ndjson) is required");
      const digest = await sha256Hex(tText);
      const client = await getWriteClient(wallet);
      const existing = await client.readContract({ address: contract, functionName: "get_trace_commitment", args: [digest] });
      if (existing) { setTStatus({ kind: "ok", msg: `trace already anchored · sha256 ${digest.slice(0, 16)}…` }); setTraceSha(digest); setTraceText(tText); return; }
      const { hash } = await writeAndWait(client, contract, "record_trace_hash", [digest, tUri.trim()], 0n, (m) => setTStatus({ kind: "run", msg: m }));
      setTStatus({ kind: "ok", msg: `trace anchored · sha256 ${digest.slice(0, 16)}…`, hash });
      setTraceSha(digest); setTraceText(tText); // carry into step 3
    } catch (e) {
      setTStatus({ kind: "err", msg: String(e && e.message ? e.message : e) });
    } finally { setTBusy(false); }
  }

  async function openInvestigation(wallet) {
    setIBusy(true); setIStatus({ kind: "run", msg: "preparing…" }); setFinalId(null);
    try {
      const id = incident.trim();
      if (!id) throw new Error("incident id is required");
      if (agentList.length < 2) throw new Error("list at least 2 agents");
      if (!/^[0-9a-f]{64}$/.test(traceSha)) throw new Error("anchor the trace in step 2 first (need its sha256)");
      if (!traceText.trim()) throw new Error("paste the trace text (must hash to the anchored sha256)");
      if (mandateList.length !== agentList.length)
        throw new Error(`need exactly ${agentList.length} mandate texts (one per agent, blank-line separated) — got ${mandateList.length}`);
      // client-side sanity: the inline evidence must hash to the anchored commitments
      const digest = await sha256Hex(traceText);
      if (digest !== traceSha) throw new Error("trace text does not hash to the anchored sha256 — the contract would reject it");

      const client = await getWriteClient(wallet);
      const already = await client.readContract({ address: contract, functionName: "has_incident", args: [id] });
      if (already) throw new Error(`incident already investigated: ${id}`);

      const { hash } = await writeAndWait(
        client, contract, "open_investigation",
        [id, traceSha, agentList, traceText, mandateList],
        BOND_WEI,
        (m) => setIStatus({ kind: "run", msg: `${m} · leader runs the LLM judgment, validators verify deterministically` })
      );
      setIStatus({ kind: "ok", msg: `investigation finalized for ${id} — bond refunded`, hash });
      setFinalId(id);
    } catch (e) {
      setIStatus({ kind: "err", msg: String(e && e.message ? e.message : e) });
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

      <ConnectGate>
        {(wallet) => (
          <div className="grid" style={{ gap: 18, marginTop: 24 }}>

            <div className="panel panel-pad">
              <div className="row between">
                <h3 style={{ fontSize: 18 }}>1 · Anchor a mandate</h3>
                <span className="tag tag--cyan">pre-incident</span>
              </div>
              <p className="faint mono mt-8" style={{ fontSize: 12 }}>
                one per agent · immutable once anchored · the text is hashed in your browser
              </p>
              <div className="grid grid--2 mt-16" style={{ gap: 12 }}>
                <div>
                  <label style={fieldLabel}>agent id</label>
                  <input style={input} placeholder="planner@orbit-ops" value={mAgent} onChange={(e) => setMAgent(e.target.value)} />
                </div>
                <div>
                  <label style={fieldLabel}>mandate uri (optional)</label>
                  <input style={input} placeholder="ipfs://…" value={mUri} onChange={(e) => setMUri(e.target.value)} />
                </div>
              </div>
              <div className="mt-16">
                <label style={fieldLabel}>mandate text</label>
                <textarea style={textarea} placeholder="The agent's declared charter — what it is and is not permitted to do." value={mText} onChange={(e) => setMText(e.target.value)} />
              </div>
              <button className="btn btn--primary mt-16" disabled={mBusy || !live} onClick={() => anchorMandate(wallet)}>
                {mBusy ? "anchoring…" : "Anchor mandate"}
              </button>
              <Status state={mStatus} />
            </div>

            <div className="panel panel-pad">
              <div className="row between">
                <h3 style={{ fontSize: 18 }}>2 · Anchor the trace</h3>
                <span className="tag tag--cyan">pre-incident</span>
              </div>
              <p className="faint mono mt-8" style={{ fontSize: 12 }}>
                content hash committed on-chain · the blob itself stays off-chain (content-addressed)
              </p>
              <div className="mt-16">
                <label style={fieldLabel}>trace uri (optional)</label>
                <input style={input} placeholder="ipfs://…" value={tUri} onChange={(e) => setTUri(e.target.value)} />
              </div>
              <div className="mt-16">
                <label style={fieldLabel}>trace (ndjson — one event per line)</label>
                <textarea style={textarea} placeholder='{"idx":0,"agent_id":"scout@acme-research","action":"…","detail":"…","recorder":"…"}' value={tText} onChange={(e) => setTText(e.target.value)} />
              </div>
              <button className="btn btn--primary mt-16" disabled={tBusy || !live} onClick={() => anchorTrace(wallet)}>
                {tBusy ? "anchoring…" : "Anchor trace"}
              </button>
              <Status state={tStatus} />
            </div>

            <div className="panel panel-pad">
              <div className="row between">
                <h3 style={{ fontSize: 18 }}>3 · Open investigation</h3>
                <span className="tag tag--amber">bond 0.01 GEN</span>
              </div>
              <p className="faint mono mt-8" style={{ fontSize: 12 }}>
                evidence rides inline · the contract re-hashes it · leader LLM judges · validators verify deterministically
              </p>
              <div className="grid grid--2 mt-16" style={{ gap: 12 }}>
                <div>
                  <label style={fieldLabel}>incident id</label>
                  <input style={input} value={incident} onChange={(e) => setIncident(e.target.value)} />
                </div>
                <div>
                  <label style={fieldLabel}>trace sha256 (from step 2)</label>
                  <input style={input} value={traceSha} onChange={(e) => setTraceSha(e.target.value.trim())} placeholder="64 hex chars" />
                </div>
              </div>
              <div className="mt-16">
                <label style={fieldLabel}>agents (comma or newline separated)</label>
                <textarea style={{ ...textarea, minHeight: 70 }} placeholder={"scout@acme-research\nplanner@orbit-ops\ncompliance@verity-guard"} value={agents} onChange={(e) => setAgents(e.target.value)} />
              </div>
              <div className="mt-16">
                <label style={fieldLabel}>trace text (must hash to the sha256 above)</label>
                <textarea style={textarea} value={traceText} onChange={(e) => setTraceText(e.target.value)} />
              </div>
              <div className="mt-16">
                <label style={fieldLabel}>
                  mandate texts — one per agent, in the same order, separated by a blank line
                  ({mandateList.length}/{agentList.length})
                </label>
                <textarea style={textarea} placeholder={"mandate for agent 1\n\nmandate for agent 2\n\nmandate for agent 3"} value={mandateTexts} onChange={(e) => setMandateTexts(e.target.value)} />
              </div>
              <button className="btn btn--primary mt-16" disabled={iBusy || !live} onClick={() => openInvestigation(wallet)}>
                {iBusy ? "running… (LLM consensus, can take several minutes)" : "Open investigation · lock 0.01 GEN bond"}
              </button>
              <Status state={iStatus} />
              {finalId && (
                <div className="callout" style={{ marginTop: 14, borderColor: "var(--green)" }}>
                  <span style={{ color: "var(--green)" }}>✓</span>
                  <span>
                    Verdict finalized on-chain.{" "}
                    <a href={`#/report/${finalId}`} style={{ color: "var(--cyan)" }}>Read the black-box report →</a>
                  </span>
                </div>
              )}
            </div>

          </div>
        )}
      </ConnectGate>
    </main>
  );
}
