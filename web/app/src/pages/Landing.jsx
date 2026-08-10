import React, { useEffect, useRef, useState } from "react";
import {
  primaryIncidentId,
  getVerdict,
  getTrace,
  getProvenance,
  getMode,
} from "../lib/client.js";

const REPORT_HREF = `#/report/${primaryIncidentId()}`;

// Inline looping clip that stands in for a punctuation mark in a headline.
function Punct({ src, label }) {
  return (
    <video
      className="punct-vid"
      src={src}
      autoPlay
      muted
      loop
      playsInline
      aria-label={label}
    />
  );
}

function Hero() {
  return (
    <section className="hero">
      <video
        className="hero-video"
        src="/hero-motion.webm"
        poster="/hero-poster.jpg"
        preload="auto"
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
      />
      <div className="hero-scrim" aria-hidden="true" />
      <div className="hero-inner shell">
        <span className="eyebrow">GenLayer Intelligent Contract</span>
        <h1 className="hero-title">
          <span className="alarm">When five agents fail together<Punct src="/gesso.mp4" label="," /></span>
          <br />
          <span className="accent">someone has to read the black box<Punct src="/flower.mp4" label="." /></span>
        </h1>
        <p className="hero-lede">
          Multi-agent swarms now move real money. When one produces a costly failure, every
          vendor's agent blames the others — and the only record is each vendor's own logs.
          FaultLine apportions causal fault across every agent as a percentage, trustlessly
          and automatically, from a tamper-proof trace. No one files a case. No one grades
          their own homework.
        </p>
        <div className="hero-cta">
          <a className="btn btn--primary" href={REPORT_HREF}>Open a live report →</a>
          <a className="btn btn--ghost" href="#how">How it works</a>
        </div>
        <div className="hero-meta">
          <span>CONSENSUS <b>deterministic validation</b></span>
          <span>EVIDENCE <b>hash-anchored, pre-incident</b></span>
          <span>OUTPUT <b>N-party fault %</b></span>
          <span>NETWORK <b>GenLayer Bradbury</b></span>
        </div>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="section shell" id="problem">
      <div className="h-block">
        <span className="eyebrow">The problem</span>
        <h2>The happy path is built. The disagreement is not<Punct src="/clock.webm" label="." /></h2>
        <p>
          Orchestration frameworks made swarms of cooperating agents the default for real
          economic work — procurement, trading, logistics, ops. The surrounding stack ships
          payments (x402), identity (ERC-8004), and messaging (A2A). Each one carves the
          moment of failure out as someone else's problem. FaultLine is built for that moment.
        </p>
      </div>
      <div className="grid grid--3 mt-32">
        <div className="panel panel-pad">
          <div className="tag tag--red">NO NEUTRAL RECORD</div>
          <p className="mt-16 muted">
            After a bad outcome there is no shared ground truth — only each vendor's
            self-reported logs and each vendor's own model explaining its own actions.
          </p>
        </div>
        <div className="panel panel-pad">
          <div className="tag tag--red">WRONG TOOL</div>
          <p className="mt-16 muted">
            Bilateral courts answer "did A deliver what B paid for." A five-vendor swarm
            failure is N-party and causal, not two-party and contractual — there is often
            no escrow and no contract between most of the parties.
          </p>
        </div>
        <div className="panel panel-pad">
          <div className="tag tag--red">CONFLICT OF INTEREST</div>
          <p className="mt-16 muted">
            The platform running the swarm is incentivized to blame the outside vendor
            over its own agent. A judge with a stake in the answer is not a judge.
          </p>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Record",
    body: "A lightweight open-source recorder wraps agent-step functions and streams structured trace events to content-addressed storage, anchoring only a hash on-chain. Crucially, each agent's mandate is hash-committed before any incident — so no one can rewrite their charter after the fact to dodge blame.",
  },
  {
    n: "02",
    title: "Investigate",
    body: "When a loss is flagged, a bonded investigation opens. The trace and mandate texts are submitted inline and re-hashed on-chain against the pre-anchored commitments — tamper means automatic rejection, identically on every node. Mechanical facts (ordering, handoffs, recorder diversity) are computed in contract code as ground truth, then a model judges each agent against its declared mandate.",
  },
  {
    n: "03",
    title: "Reach consensus",
    body: "The judgment runs on the leader; every validator then re-checks it deterministically — same evidence bytes from the calldata, same well-formedness rules, same derived roles. No validator re-executes a live web or LLM call, so honest nodes always agree and the verdict finalizes in one round.",
  },
  {
    n: "04",
    title: "Settle",
    body: "The finalized allocation is written on-chain as a signed, timestamped black-box report and emitted as an event. FaultLine moves no money itself — insurers read it to pay claims, staking contracts read it to slash bonds, and a court case cites it as evidence instead of starting from a swearing match.",
  },
];

function How() {
  return (
    <section className="section shell" id="how">
      <div className="h-block">
        <span className="eyebrow">How it works</span>
        <h2>Evidence first. Judgment second. Ruling never<Punct src="/sunflower.webm" label="." /></h2>
        <p>
          FaultLine produces an evidentiary primitive, not a legal verdict — the neutral
          technical record that insurers, staking contracts, and courts consume.
        </p>
      </div>
      <div className="panel panel-pad mt-32">
        {STEPS.map((s) => (
          <div className="step" key={s.n}>
            <div className="step-num">{s.n}</div>
            <div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── overdrive: live evidence console ──────────────────────────────────────
   One authored moment on the page. When the teaser enters the viewport it
   boots like a flight recorder: the tamper-proof trace replays line by line,
   the fault bars power up, percentages tick to the real on-chain values and
   the trace hash draws in. All data is the finalized live investigation. */

// IntersectionObserver hook — flips `on` once, then stays on.
// Callback ref (not useRef): the observed element only exists after the
// verdict loads, so the observer must attach when the element MOUNTS —
// a [] effect with useRef would run while the component still returns null
// and the panel would stay invisible forever on slow connections.
function useInView(threshold = 0.2) {
  const [el, setEl] = useState(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!el) return undefined;
    if (typeof IntersectionObserver === "undefined") { setOn(true); return undefined; }
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setOn(true),
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, threshold]);
  return [setEl, on];
}

// Ramping ticker: eases from 0 to `target` over ~`dur`ms when `on`.
function useTick(target, on, delay = 0, dur = 900) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    let raf; const t0 = performance.now() + delay;
    const step = (now) => {
      const p = Math.min(Math.max((now - t0) / dur, 0), 1);
      setVal(Math.round(target * (1 - Math.pow(1 - p, 3)))); // ease-out cubic
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [on, target, delay, dur]);
  return val;
}

function ReportTeaser() {
  const [verdict, setVerdict] = useState(null);
  const [trace, setTrace] = useState([]);
  const [consoleOn, setConsoleOn] = useState(false); // begins replay after boot
  const live = getMode() === "live";
  const provenance = getProvenance();
  const [ref, on] = useInView(0.2);

  useEffect(() => {
    let live_ = true;
    Promise.all([getVerdict(primaryIncidentId()), getTrace(primaryIncidentId())])
      .then(([v, t]) => { if (live_) { setVerdict(v); setTrace(t || []); } });
    return () => { live_ = false; };
  }, []);

  // Boot the console shortly after it scrolls into view; the trace replay is
  // driven by CSS animation-delay, bars/tickers by their own observers.
  useEffect(() => {
    if (!on) return undefined;
    const t = setTimeout(() => setConsoleOn(true), 350);
    return () => clearTimeout(t);
  }, [on]);

  if (!verdict) return null;
  const primary = verdict.allocations.reduce((a, b) => (b.fault_pct > a.fault_pct ? b : a));
  const replay = trace.slice(0, 10);

  return (
    <section className="section shell" ref={ref}>
      <div className={`panel panel-pad console ${on ? "on" : ""}`}>
        <div className="row between">
          <div>
            <span className="eyebrow">A finished investigation</span>
            <h2 className="mt-8" style={{ fontSize: "clamp(22px,3vw,34px)" }}>
              The black-box report, rendered<Punct src="/ufo.webm" label="." />
            </h2>
            <p className="muted mt-8" style={{ maxWidth: "56ch" }}>
              Five vendors' agents. $50,000 moved to a lookalike counterparty. One primary
              cause — <span className="mono" style={{ color: "var(--amber)" }}>{primary.agent_id}</span> at{" "}
              <b style={{ color: "var(--amber)" }}>{primary.fault_pct}%</b> — with every attribution
              grounded in a cited trace line.
              {live && provenance && (
                <>
                  {" "}
                  <a className="mono" href={provenance.investigationTxUrl} target="_blank" rel="noreferrer">
                    Finalized on GenLayer Bradbury ↗
                  </a>
                </>
              )}
            </p>
          </div>
          <a className="btn btn--primary" href={REPORT_HREF}>Read the report →</a>
        </div>

        {/* trace replay — the recorder plays the tamper-proof log back */}
        <div className="trace console-trace mt-24" aria-hidden={!consoleOn}>
          {replay.map((e, i) => (
            <div className="trace-line" key={e.idx ?? i} style={{ animationDelay: `${i * 120}ms` }}>
              <span className="trace-idx">{String(e.idx ?? i).padStart(2, "0")}</span>
              <span className="trace-agent">{e.agent}</span>
              <span className="trace-action">{e.action}</span>
            </div>
          ))}
        </div>

        {/* verdict bars power up + percentages tick to the on-chain values */}
        <div className="mt-24">
          {verdict.allocations.map((a, i) => (
            <ConsoleBar key={a.agent_id} a={a} on={consoleOn} delay={i * 90} />
          ))}
        </div>

        {/* the hash that pins it — draws in like a signature */}
        {live && provenance && (
          <div className="console-hash mono mt-16">
            <span className="faint">trace sha256 </span>
            <HashReveal hex={provenance.traceSha256} on={consoleOn} />
          </div>
        )}
      </div>
    </section>
  );
}

function ConsoleBar({ a, on, delay }) {
  const pct = useTick(a.fault_pct, on, delay, 700);
  return (
    <div className="fault-row">
      <div className="fault-head">
        <span className="fault-agent">{a.agent_id}</span>
        <span className={`fault-pct ${a.fault_pct === 0 ? "zero" : ""}`}>{pct}%</span>
      </div>
      <div className="fault-track">
        <div
          className={`fault-fill ${a.role === "proximate" ? "primary" : ""} ${on ? "on" : ""}`}
          style={{ "--pct": Math.max(a.fault_pct, 1.5) / 100, transitionDelay: `${delay}ms` }}
        />
      </div>
    </div>
  );
}

// The trace hash reveals left-to-right like it's being read off the chain.
function HashReveal({ hex, on }) {
  const shown = useTick(hex.length, on, 200, 1100);
  return (
    <span className="console-hash-val">{on ? hex.slice(0, shown) : ""}</span>
  );
}

function Why() {
  return (
    <section className="section shell" id="why">
      <div className="h-block">
        <span className="eyebrow">Why GenLayer</span>
        <h2>The jury can't be the defendant's model.</h2>
        <p>
          GenLayer validators run genuinely different underlying models — each node chooses
          and configures its own, and rewrites and re-parameterizes prompts. So no AI vendor
          whose agent is implicated can bias the verdict through friendly weights. That is the
          one place where "why GenLayer, not a normal LLM call" is unambiguous.
        </p>
      </div>
      <div className="grid grid--3 mt-32">
        <div className="panel panel-pad">
          <div className="tag tag--cyan">GREYBOXING</div>
          <p className="mt-16 muted">
            Validators are not tied to one model. Different providers, different weights,
            different prompt transforms — an implicated vendor can't stack the deck.
          </p>
        </div>
        <div className="panel panel-pad">
          <div className="tag tag--cyan">COMPOSABLE</div>
          <p className="mt-16 muted">
            Verdicts map onto ERC-8004's Validation and Reputation registries and can be
            cited inside an Internet Court case — a primitive others build on, not a silo.
          </p>
        </div>
        <div className="panel panel-pad">
          <div className="tag tag--cyan">EVIDENCE, NOT COURT</div>
          <p className="mt-16 muted">
            The report is a technical attribution record. It is not automatically legally
            binding and does not replace a court — it gives courts and contracts ground truth.
          </p>
        </div>
      </div>
    </section>
  );
}

function WhoPays() {
  const rows = [
    ["Orchestration platforms", "Post the investigation bond for a defensible neutral report instead of a shouting match between vendor logs."],
    ["AI liability insurers", "Use verdicts as the claims trigger — faster and cheaper than a human loss adjuster, without the self-grading conflict."],
    ["Agent vendors", "Register mandates and get graded fairly — protection against a platform blaming the outside vendor over its own agent."],
    ["Enterprises", "Settle internal accountability and vendor cost allocation across a multi-vendor agent stack."],
  ];
  return (
    <section className="section shell" id="who">
      <div className="h-block">
        <span className="eyebrow">Who uses it</span>
        <h2>The people with the most to lose from an unanswered failure<Punct src="/globe.mp4" label="." /></h2>
      </div>
      <div className="panel panel-pad mt-32 spec">
        {rows.map(([k, v]) => (
          <div className="spec-row" key={k}>
            <span className="spec-k" style={{ color: "var(--ink-0)", fontWeight: 600 }}>{k}</span>
            <span className="spec-v" style={{ textAlign: "left", maxWidth: "60ch", color: "var(--ink-1)" }}>{v}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <main>
      <Hero />
      <ReportTeaser />
      <Problem />
      <How />
      <Why />
      <WhoPays />
    </main>
  );
}
