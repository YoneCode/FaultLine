import React, { useEffect, useState } from "react";
import { useAccount, useChainId, useSwitchChain, useBalance } from "wagmi";
import { getMode, getContractAddress } from "../lib/client.js";
import { BRADBURY_CHAIN_ID, EXPLORER, getWriteClient, writeAndWait, sha256Hex, explorerTxUrl, BOND_WEI } from "../lib/wallet.js";
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
  return s;
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
  const [mandateTexts, setMandateTexts] = useState(""); // one per agent, blank-line separated
  const [iStatus, setIStatus] = useState(null);
  const [iBusy, setIBusy] = useState(false);
  const [finalId, setFinalId] = useState(null);

  const agentList = agents.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  const mandateList = mandateTexts.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

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
        (m) => setIStatus({ kind: "run", msg: `${m} · leader runs the LLM judgment, validators verify deterministically`, since })
      );
      setIStatus({ kind: "ok", msg: `investigation finalized for ${id} — bond refunded`, hash });
      setFinalId(id);
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
                </div>
                <div className="mt-16">
                  <label htmlFor="i-mandates" style={fieldLabel}>
                    mandate texts — one per agent, in the same order, separated by a blank line
                    ({mandateList.length}/{agentList.length})
                  </label>
                  <textarea id="i-mandates" style={textarea} placeholder={"mandate for agent 1\n\nmandate for agent 2\n\nmandate for agent 3"} value={mandateTexts} onChange={(e) => setMandateTexts(e.target.value)} />
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
