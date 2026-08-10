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

export async function listIncidents() {
  // The contract stores per-incident records; enumeration comes from verdict
  // events via an indexer. The known incidents are the canonical list.
  return [getMode() === "live" ? LIVE_INCIDENT_ID : SAMPLE_INCIDENT_ID];
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
    if (incidentId !== LIVE_INCIDENT_ID) return null;
    const client = await getLiveClient();
    const raw = await client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_verdict",
      args: [incidentId],
    });
    if (!raw) return null;
    return {
      incident_id: incidentId,
      ...JSON.parse(raw),
      network: "GenLayer Bradbury",
      consensus: "deterministic validation · leader-executed LLM",
      validators: 5,
      opened_at: OPENED_AT,
      finalized_at: FINALIZED_AT,
    };
  }
  return incidentId === SAMPLE_INCIDENT_ID ? SAMPLE_VERDICT : null;
}

export async function getTrace(incidentId) {
  if (getMode() === "live") {
    return incidentId === LIVE_INCIDENT_ID ? mapTrace(LIVE_TRACE) : [];
  }
  return incidentId === SAMPLE_INCIDENT_ID ? SAMPLE_TRACE : [];
}

export async function getMandates(incidentId) {
  if (getMode() === "live") {
    return incidentId === LIVE_INCIDENT_ID ? LIVE_MANDATES : {};
  }
  return incidentId === SAMPLE_INCIDENT_ID ? SAMPLE_MANDATES : {};
}

export async function getGroundTruth(incidentId) {
  if (getMode() === "live") {
    // mapTrace first: deriveGroundTruth reads `agent`, live events carry `agent_id`
    return incidentId === LIVE_INCIDENT_ID ? deriveGroundTruth(mapTrace(LIVE_TRACE)) : null;
  }
  return incidentId === SAMPLE_INCIDENT_ID ? SAMPLE_GROUND_TRUTH : null;
}

// Provenance for the report header — only fully-verified on-chain references.
// The trace-anchor tx hash was never recorded in full, so it is NOT linked
// (no guessing); the trace itself is content-addressed by sha256 + IPFS CID.
export function getProvenance() {
  if (getMode() !== "live") return null;
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

export async function getReport(incidentId) {
  const [verdict, trace, mandates, groundTruth] = await Promise.all([
    getVerdict(incidentId),
    getTrace(incidentId),
    getMandates(incidentId),
    getGroundTruth(incidentId),
  ]);
  if (!verdict) return null;
  return { verdict, trace, mandates, groundTruth, provenance: getProvenance() };
}
