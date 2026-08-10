import React, { useEffect, useMemo, useState } from "react";
import { getReport, getMode, getProvenance } from "../lib/client.js";

const ROLE_TAG = {
  proximate: "tag--red",
  contributing: "tag--amber",
  uninvolved: "tag--green",
};

function Header({ verdict, groundTruth, provenance }) {
  const single = verdict.trace_is_single_source ?? groundTruth?.single_source_trace;
  return (
    <div className="panel panel-pad">
      <div className="row between">
        <div>
          <span className="eyebrow">Black-box report</span>
          <h1 className="mt-8" style={{ fontSize: "clamp(24px,3.4vw,40px)" }}>
            Incident <span className="mono" style={{ color: "var(--amber)" }}>{verdict.incident_id}</span>
          </h1>
        </div>
        <span className={`tag ${single ? "tag--red" : "tag--green"}`}>
          {single ? "SINGLE-SOURCE TRACE" : "MULTI-SOURCE TRACE"}
        </span>
      </div>

      {single && (
        <div className="callout red mt-16">
          <span>⚠</span>
          <span>
            This trace was produced by a single recorder. It reflects one side's view and is
            lower-confidence evidence — the consensus treats single-source traces accordingly.
          </span>
        </div>
      )}

      <div className="grid grid--2 mt-24">
        <div className="spec">
          <div className="spec-row"><span className="spec-k">network</span><span className="spec-v">{verdict.network}</span></div>
          <div className="spec-row"><span className="spec-k">consensus</span><span className="spec-v">{verdict.consensus}</span></div>
          <div className="spec-row"><span className="spec-k">validators</span><span className="spec-v">{verdict.validators}</span></div>
          <div className="spec-row"><span className="spec-k">distinct recorders</span><span className="spec-v">{verdict.distinct_recorders ?? groundTruth?.distinct_recorders}</span></div>
        </div>
        <div className="spec">
          <div className="spec-row"><span className="spec-k">opened</span><span className="spec-v mono-tint">{verdict.opened_at}</span></div>
          <div className="spec-row"><span className="spec-k">finalized</span><span className="spec-v mono-tint">{verdict.finalized_at}</span></div>
          <div className="spec-row"><span className="spec-k">agents implicated</span><span className="spec-v">{verdict.allocations.length}</span></div>
          <div className="spec-row"><span className="spec-k">trace events</span><span className="spec-v">{groundTruth?.event_count ?? "—"}</span></div>
        </div>
      </div>

      {provenance && (
        <div className="spec mt-16">
          <div className="spec-row">
            <span className="spec-k">finalized tx</span>
            <span className="spec-v">
              <a className="mono" href={provenance.investigationTxUrl} target="_blank" rel="noreferrer">
                {provenance.investigationTx.slice(0, 18)}… ↗
              </a>
            </span>
          </div>
          <div className="spec-row">
            <span className="spec-k">contract</span>
            <span className="spec-v">
              <a className="mono" href={provenance.contractUrl} target="_blank" rel="noreferrer">
                {provenance.contract.slice(0, 14)}… ↗
              </a>
            </span>
          </div>
          <div className="spec-row">
            <span className="spec-k">trace sha256</span>
            <span className="spec-v mono-tint mono">{provenance.traceSha256.slice(0, 20)}…</span>
          </div>
        </div>
      )}
    </div>
  );
}

function FaultBars({ verdict, onCite, activeCite }) {
  const sorted = useMemo(
    () => [...verdict.allocations].sort((a, b) => b.fault_pct - a.fault_pct),
    [verdict]
  );
  return (
    <div className="panel panel-pad">
      <div className="row between">
        <h3 style={{ fontSize: 18 }}>Fault allocation</h3>
        <span className="tag tag--amber">Σ = 100%</span>
      </div>
      <div className="mt-16">
        {sorted.map((a) => (
          <div className="fault-row" key={a.agent_id}>
            <div className="fault-head">
              <span className="fault-agent">{a.agent_id}</span>
              <span className={`fault-pct ${a.fault_pct === 0 ? "zero" : ""}`}>{a.fault_pct}%</span>
            </div>
            <div className="fault-track">
              <div
                className={`fault-fill ${a.role === "proximate" ? "primary" : ""}`}
                style={{ "--pct": Math.max(a.fault_pct, 1.5) / 100 }}
              />
            </div>
            <div className="fault-sub">
              <span className={`tag ${ROLE_TAG[a.role] || ""}`}>{a.role.toUpperCase()}</span>
              <span className={`tag ${a.within_mandate ? "tag--green" : "tag--red"}`}>
                {a.within_mandate ? "WITHIN MANDATE" : "OUT OF MANDATE"}
              </span>
              <button
                className="fault-cite btn-bare"
                style={{ color: activeCite === a.trace_index ? "var(--amber)" : "var(--ink-2)" }}
                onClick={() => onCite(a.trace_index)}
                title="Jump to the cited trace line"
              >
                ▸ cites trace[{a.trace_index}]
              </button>
            </div>
            <p className="fault-reason">{a.reason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CauseFlow({ groundTruth, verdict }) {
  if (!groundTruth?.handoff_order) return null;
  const primary = verdict.allocations.reduce((a, b) => (b.fault_pct > a.fault_pct ? b : a));
  return (
    <div className="panel panel-pad">
      <h3 style={{ fontSize: 18 }}>Causal chain</h3>
      <p className="faint mono mt-8" style={{ fontSize: 12 }}>
        handoff order, computed deterministically from the trace
      </p>
      <div className="cause-flow mt-16">
        {groundTruth.handoff_order.map((agent, i) => (
          <React.Fragment key={agent}>
            {i > 0 && <span className="cause-arrow">→</span>}
            <span className={`cause-node ${agent === primary.agent_id ? "culprit" : ""}`}>
              {agent}
              {agent === primary.agent_id && <span> ·{primary.fault_pct}%</span>}
            </span>
          </React.Fragment>
        ))}
        <span className="cause-arrow">→</span>
        <span className="cause-node culprit">LOSS</span>
      </div>
    </div>
  );
}

function TraceLog({ trace, activeCite, citedSet }) {
  return (
    <div className="panel">
      <div className="panel-pad" style={{ paddingBottom: 0 }}>
        <div className="row between">
          <h3 style={{ fontSize: 18 }}>Execution trace</h3>
          <span className="tag">hash-anchored · pre-incident</span>
        </div>
      </div>
      <div className="trace mt-16" style={{ margin: 16 }}>
        {trace.map((e) => (
          <div
            key={e.idx}
            id={`trace-${e.idx}`}
            className={`trace-line ${citedSet.has(e.idx) ? "cited" : ""}`}
            style={activeCite === e.idx ? { outline: "1px solid var(--amber)" } : undefined}
          >
            <span className="trace-idx">[{e.idx}]</span>
            <span className="trace-agent">{e.agent}</span>
            <span className="trace-action">
              <span style={{ color: "var(--ink-0)" }}>{e.action}</span> — {e.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Mandates({ mandates }) {
  const [open, setOpen] = useState(null);
  const ids = Object.keys(mandates);
  if (!ids.length) return null;
  return (
    <div className="panel panel-pad">
      <h3 style={{ fontSize: 18 }}>Pre-anchored mandates</h3>
      <p className="faint mono mt-8" style={{ fontSize: 12 }}>
        hash-committed before the incident · validators re-hash on fetch
      </p>
      <div className="mt-16">
        {ids.map((id) => (
          <div key={id} style={{ borderBottom: "1px solid var(--line)" }}>
            <button
              className="btn-bare"
              onClick={() => setOpen(open === id ? null : id)}
              style={{
                width: "100%", textAlign: "left",
                color: "var(--cyan)", padding: "12px 0",
                fontSize: 13,
              }}
            >
              {open === id ? "▾" : "▸"} {id}
            </button>
            {open === id && (
              <p className="muted" style={{ padding: "0 0 14px 18px", fontSize: 13, margin: 0 }}>
                {mandates[id]}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Report({ incidentId }) {
  const [report, setReport] = useState(null);
  const [err, setErr] = useState(null);
  const [activeCite, setActiveCite] = useState(null);

  useEffect(() => {
    let live = true;
    getReport(incidentId)
      .then((r) => live && (r ? setReport(r) : setErr("Incident not found.")))
      .catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [incidentId]);

  const citedSet = useMemo(
    () => new Set((report?.verdict.allocations || []).map((a) => a.trace_index)),
    [report]
  );

  const onCite = (idx) => {
    setActiveCite(idx);
    const el = document.getElementById(`trace-${idx}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (err) {
    return (
      <main className="shell section">
        <div className="callout red"><span>✕</span><span>{err}</span></div>
      </main>
    );
  }
  if (!report) {
    return (
      <main className="shell section">
        <p className="mono muted">reading trace…</p>
      </main>
    );
  }

  return (
    <main className="shell section" style={{ paddingTop: 32 }}>
      {getMode() === "demo" ? (
        <div className="callout" style={{ marginBottom: 18 }}>
          <span>●</span>
          <span>
            Demo data — the contract reads live once deployed to Bradbury and wired via
            VITE_FAULTLINE_ADDRESS. The interface below does not change.
          </span>
        </div>
      ) : (
        <div className="callout green" style={{ marginBottom: 18 }}>
          <span>✓</span>
          <span>
            Live — this verdict was finalized by GenLayer validator consensus on Bradbury.
            The percentages below are read from the contract, not bundled with this page.
          </span>
        </div>
      )}
      <div className="grid" style={{ gap: 18 }}>
        <Header verdict={report.verdict} groundTruth={report.groundTruth} provenance={report.provenance} />
        <CauseFlow groundTruth={report.groundTruth} verdict={report.verdict} />
        <div className="grid grid--2" style={{ alignItems: "start" }}>
          <FaultBars verdict={report.verdict} onCite={onCite} activeCite={activeCite} />
          <div className="grid" style={{ gap: 18 }}>
            <TraceLog trace={report.trace} activeCite={activeCite} citedSet={citedSet} />
            <Mandates mandates={report.mandates} />
          </div>
        </div>
      </div>
    </main>
  );
}
