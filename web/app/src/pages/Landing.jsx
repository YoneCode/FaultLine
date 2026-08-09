import React from "react";
import { SAMPLE_INCIDENT_ID, SAMPLE_VERDICT } from "../lib/sampleIncident.js";

const REPORT_HREF = `#/report/${SAMPLE_INCIDENT_ID}`;

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
          When five agents fail together,
          <br />
          <span className="accent">someone has to read the black box.</span>
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
          <span>CONSENSUS <b>comparative re-execution</b></span>
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
        <h2>The happy path is built. The disagreement is not.</h2>
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
    body: "When a loss is flagged, a bonded investigation opens. Validators independently fetch the trace and the pre-anchored mandates, recompute the mechanical facts (ordering, handoffs, recorder diversity) as ground truth, and judge each agent against its declared mandate — proximate cause, contributing cause, or uninvolved.",
  },
  {
    n: "03",
    title: "Reach consensus",
    body: "Not leader-grading: every validator independently re-derives the allocation and they compare only the decision fields — a zero-gate on 'uninvolved', a tolerance band on percentages, and mandatory agreement on the primary cause. An injection must fool every independently-modelled validator at once, not one leader.",
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
        <h2>Evidence first. Judgment second. Ruling never.</h2>
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

function ReportTeaser() {
  const primary = SAMPLE_VERDICT.allocations.reduce((a, b) => (b.fault_pct > a.fault_pct ? b : a));
  return (
    <section className="section shell">
      <div className="panel panel-pad">
        <div className="row between">
          <div>
            <span className="eyebrow">A finished investigation</span>
            <h2 className="mt-8" style={{ fontSize: "clamp(22px,3vw,34px)" }}>
              The black-box report, rendered.
            </h2>
            <p className="muted mt-8" style={{ maxWidth: "56ch" }}>
              Five vendors' agents. $50,000 moved to a lookalike counterparty. One primary
              cause — <span className="mono" style={{ color: "var(--amber)" }}>{primary.agent_id}</span> at{" "}
              <b style={{ color: "var(--amber)" }}>{primary.fault_pct}%</b> — with every attribution
              grounded in a cited trace line.
            </p>
          </div>
          <a className="btn btn--primary" href={REPORT_HREF}>Read the report →</a>
        </div>
        <div className="mt-24">
          {SAMPLE_VERDICT.allocations.map((a) => (
            <div className="fault-row" key={a.agent_id}>
              <div className="fault-head">
                <span className="fault-agent">{a.agent_id}</span>
                <span className={`fault-pct ${a.fault_pct === 0 ? "zero" : ""}`}>{a.fault_pct}%</span>
              </div>
              <div className="fault-track">
                <div
                  className={`fault-fill ${a.role === "proximate" ? "primary" : ""}`}
                  style={{ width: `${Math.max(a.fault_pct, 1.5)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
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
        <h2>The people with the most to lose from an unanswered failure.</h2>
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
      <Problem />
      <How />
      <ReportTeaser />
      <Why />
      <WhoPays />
    </main>
  );
}
