// Data layer for FaultLine.
//
// Two modes:
//   live — reads the deployed contract on GenLayer Bradbury via genlayer-js.
//          The verdict comes from the chain (readContract get_verdict); the
//          trace/mandates are the bundled, hash-verified evidence bytes.
//   demo — serves the built-in sample incident with no chain connection.
//
// Live mode activates when VITE_FAULTLINE_ADDRESS is set, or via the pinned
// deployment address below, and can be forced off with VITE_FAULTLINE_MODE=demo.

import {
  SAMPLE_INCIDENT_ID,
  SAMPLE_TRACE,
  SAMPLE_VERDICT,
  SAMPLE_GROUND_TRUTH,
  SAMPLE_MANDATES,
} from "./sampleIncident.js";
import {
  LIVE_INCIDENT_ID,
  LIVE_TRACE,
  LIVE_TRACE_SHA256,
  LIVE_TRACE_URI,
  LIVE_MANDATES,
  LIVE_MANDATE_META,
} from "./liveEvidence.js";
import { sha256Hex } from "./hash.js";

// The deployed v0.5.0 contract on Bradbury — the one that finalized the live
// verdict (tx 0x479359…c34e9). Hardcoded so the dapp is live out of the box;
// VITE_FAULTLINE_ADDRESS overrides it.
const DEFAULT_ADDRESS = "0x94941FB76b1590CD4835930dF8B955d5718DAe97";
const CONTRACT_ADDRESS = import.meta.env.VITE_FAULTLINE_ADDRESS || DEFAULT_ADDRESS;
const MODE = import.meta.env.VITE_FAULTLINE_MODE || "live";

// Verified on-chain metadata for the finalized live investigation.
export const INVESTIGATION_TX =
  "0x4793599510a8827397a2472fca5801738f9391fd3f9a1ee926a2d4add93c34e9";
export const EXPLORER = "https://explorer-bradbury.genlayer.com";
const OPENED_AT = "2026-08-09T17:45:29Z";
const FINALIZED_AT = "2026-08-09T17:45:51Z";

let liveClientPromise = null;
async function getLiveClient() {
  // Loaded lazily so the demo path never bundles/initializes the chain client.
  if (!liveClientPromise) {
    liveClientPromise = Promise.all([
      import("genlayer-js"),
      import("genlayer-js/chains"),
    ]).then(([{ createClient }, { testnetBradbury }]) =>
      createClient({ chain: testnetBradbury })
    );
  }
  return liveClientPromise;
}

export function getMode() {
  return MODE === "live" && CONTRACT_ADDRESS ? "live" : "demo";
}

// Raw read passthrough for the live contract (view methods only, no wallet).
export async function readLive(functionName, args) {
  const client = await getLiveClient();
  return client.readContract({ address: CONTRACT_ADDRESS, functionName, args });
}

export function getContractAddress() {
  return CONTRACT_ADDRESS;
}

export function isPinnedIncident(incidentId) {
  return getMode() === "live" && incidentId === LIVE_INCIDENT_ID;
}

// ── local evidence cache ─────────────────────────────────────────────────────
// open_investigation receives the trace/mandate bytes as CALLDATA and stores
// only their sha256 commitments — the contract cannot serve the evidence back.
// So /investigate saves the exact bytes it submitted (they were hash-verified
// by the contract at open time) into localStorage, and the report page
// re-verifies them before rendering. A browser without the cache still gets
// the verdict — that one always comes from the chain.
const EVIDENCE_PREFIX = "faultline:evidence:";

export function saveEvidence(incidentId, ev) {
  try {
    localStorage.setItem(EVIDENCE_PREFIX + incidentId, JSON.stringify(ev));
  } catch { /* storage full / private mode — the report degrades to verdict-only */ }
}

export function loadEvidence(incidentId) {
  try {
    const s = localStorage.getItem(EVIDENCE_PREFIX + incidentId);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function listCachedIncidentIds() {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(EVIDENCE_PREFIX))
      .map((k) => k.slice(EVIDENCE_PREFIX.length));
  } catch { return []; }
}

export async function listIncidents() {
  // The contract has no enumeration view; the canonical list is the pinned
  // incident plus whatever this browser opened (evidence cache keys).
  if (getMode() !== "live") return [SAMPLE_INCIDENT_ID];
  const cached = listCachedIncidentIds().filter((id) => id !== LIVE_INCIDENT_ID);
  return [LIVE_INCIDENT_ID, ...cached];
}

export function primaryIncidentId() {
  return getMode() === "live" ? LIVE_INCIDENT_ID : SAMPLE_INCIDENT_ID;
}

// The trace schema uses `agent_id`; the UI components use `agent`.
function mapTrace(events) {
  return events.map((e) => ({ ...e, agent: e.agent ?? e.agent_id }));
}

function deriveGroundTruth(events) {
  const agents = [...new Set(events.map((e) => e.agent).filter(Boolean))];
  const recorders = new Set(events.map((e) => e.recorder).filter(Boolean));
  const handoff = [];
  for (const e of events) {
    if (e.agent && handoff[handoff.length - 1] !== e.agent) handoff.push(e.agent);
  }
  return {
    event_count: events.length,
    agents,
    first_actor: agents[0] ?? null,
    handoff_order: handoff,
    distinct_recorders: recorders.size,
    single_source_trace: recorders.size <= 1,
  };
}

export async function getVerdict(incidentId) {
  if (getMode() === "live") {
    // Any incident id reads from the chain — the verdict is never bundled.
    const raw = await readLive("get_verdict", [incidentId]);
    if (!raw) return null;
    const base = {
      incident_id: incidentId,
      ...JSON.parse(raw),
      network: "GenLayer Bradbury",
      consensus: "deterministic validation · leader-executed LLM",
    };
    // Timestamps/validator count are verified constants for the pinned
    // incident only — for others they would be guesses (the Incident record
    // has no public view), so they come from the local evidence cache or stay
    // blank. No guessing.
    if (incidentId === LIVE_INCIDENT_ID) {
      return { ...base, validators: 5, opened_at: OPENED_AT, finalized_at: FINALIZED_AT };
    }
    const ev = loadEvidence(incidentId);
    return { ...base, ...(ev && ev.openedAt ? { opened_at: ev.openedAt } : {}) };
  }
  return incidentId === SAMPLE_INCIDENT_ID ? SAMPLE_VERDICT : null;
}

// Parse + integrity-check the cached evidence bytes. Returns null when the
// cache is absent or no longer hashes to the anchored digest (tampered).
async function verifiedCachedTrace(incidentId) {
  const ev = loadEvidence(incidentId);
  if (!ev || !ev.traceText || !ev.traceSha) return null;
  const digest = await sha256Hex(ev.traceText);
  if (digest !== ev.traceSha) return null;
  return mapTrace(ev.traceText.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)));
}

export async function getTrace(incidentId) {
  if (getMode() === "live") {
    if (incidentId === LIVE_INCIDENT_ID) return mapTrace(LIVE_TRACE);
    return (await verifiedCachedTrace(incidentId)) ?? [];
  }
  return incidentId === SAMPLE_INCIDENT_ID ? SAMPLE_TRACE : [];
}

export async function getMandates(incidentId) {
  if (getMode() === "live") {
    if (incidentId === LIVE_INCIDENT_ID) return LIVE_MANDATES;
    // The contract re-hashed these exact bytes against the on-chain anchors
    // at open time — a successful open IS the verification.
    const ev = loadEvidence(incidentId);
    return ev && ev.mandates ? ev.mandates : {};
  }
  return incidentId === SAMPLE_INCIDENT_ID ? SAMPLE_MANDATES : {};
}

export async function getGroundTruth(incidentId) {
  if (getMode() === "live") {
    // mapTrace first: deriveGroundTruth reads `agent`, live events carry `agent_id`
    if (incidentId === LIVE_INCIDENT_ID) return deriveGroundTruth(mapTrace(LIVE_TRACE));
    const trace = await verifiedCachedTrace(incidentId);
    return trace ? deriveGroundTruth(trace) : null;
  }
  return incidentId === SAMPLE_INCIDENT_ID ? SAMPLE_GROUND_TRUTH : null;
}

// Provenance for the report header — only fully-verified on-chain references.
// Pinned incident: the recorded constants. Any other incident: what the local
// evidence cache carries from its own write receipt (tx hash, trace digest),
// never reconstructed guesses. Callers that want the headline incident
// (Landing) call this with no argument — the default keeps that contract.
export function getProvenance(incidentId = LIVE_INCIDENT_ID) {
  if (getMode() !== "live") return null;
  if (incidentId === LIVE_INCIDENT_ID) {
    return {
      contract: CONTRACT_ADDRESS,
      contractUrl: `${EXPLORER}/address/${CONTRACT_ADDRESS}`,
      investigationTx: INVESTIGATION_TX,
      investigationTxUrl: `${EXPLORER}/tx/${INVESTIGATION_TX}`,
      traceSha256: LIVE_TRACE_SHA256,
      traceUri: LIVE_TRACE_URI,
      mandateMeta: LIVE_MANDATE_META,
      network: "GenLayer Bradbury",
      openedAt: OPENED_AT,
      finalizedAt: FINALIZED_AT,
    };
  }
  const ev = loadEvidence(incidentId);
  return {
    contract: CONTRACT_ADDRESS,
    contractUrl: `${EXPLORER}/address/${CONTRACT_ADDRESS}`,
    investigationTx: ev && ev.txHash ? ev.txHash : null,
    investigationTxUrl: ev && ev.txHash ? `${EXPLORER}/tx/${ev.txHash}` : null,
    traceSha256: ev && ev.traceSha ? ev.traceSha : null,
    traceUri: ev && ev.traceUri ? ev.traceUri : null,
    network: "GenLayer Bradbury",
    openedAt: ev && ev.openedAt ? ev.openedAt : null,
  };
}

export async function getReport(incidentId) {
  const [verdict, trace, mandates, groundTruth] = await Promise.all([
    getVerdict(incidentId),
    getTrace(incidentId),
    getMandates(incidentId),
    getGroundTruth(incidentId),
  ]);
  if (!verdict) return null;
  const evidenceSource =
    getMode() !== "live" || incidentId === LIVE_INCIDENT_ID
      ? "bundled"
      : loadEvidence(incidentId)
        ? "cache"
        : "none";
  return { verdict, trace, mandates, groundTruth, provenance: getProvenance(incidentId), evidenceSource };
}
