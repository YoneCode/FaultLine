// Data layer for FaultLine.
//
// Today it serves the built-in sample incident so the report UI is fully
// functional with no chain connection. When the contract is deployed on
// Bradbury, the same functions switch to reading it via genlayer-js — the
// call sites (the React components) do not change.
//
// To go live:
//   1. deploy contracts/faultline.py to Bradbury, set VITE_FAULTLINE_ADDRESS
//      and VITE_GENLAYER_RPC (default https://rpc-bradbury.genlayer.com)
//   2. flip MODE to "live" (or set VITE_FAULTLINE_MODE=live)

import {
  SAMPLE_INCIDENT_ID,
  SAMPLE_TRACE,
  SAMPLE_VERDICT,
  SAMPLE_GROUND_TRUTH,
  SAMPLE_MANDATES,
} from "./sampleIncident.js";

const MODE = import.meta.env.VITE_FAULTLINE_MODE || "demo";
const CONTRACT_ADDRESS = import.meta.env.VITE_FAULTLINE_ADDRESS || null;
const RPC = import.meta.env.VITE_GENLAYER_RPC || "https://rpc-bradbury.genlayer.com";

let liveClientPromise = null;
async function getLiveClient() {
  // Loaded lazily so the demo path never bundles/initializes the chain client.
  if (!liveClientPromise) {
    liveClientPromise = import("genlayer-js").then(({ createClient, chains }) => {
      const client = createClient({ chain: chains.bradbury, endpoint: RPC });
      return client;
    });
  }
  return liveClientPromise;
}

export function getMode() {
  return MODE === "live" && CONTRACT_ADDRESS ? "live" : "demo";
}

export async function listIncidents() {
  if (getMode() === "live") {
    // The contract stores per-incident records; enumeration comes from the
    // verdict events via the indexer. Until then the demo list is canonical.
    return [SAMPLE_INCIDENT_ID];
  }
  return [SAMPLE_INCIDENT_ID];
}

export async function getVerdict(incidentId) {
  if (getMode() === "live") {
    const client = await getLiveClient();
    const raw = await client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_verdict",
      args: [incidentId],
    });
    return raw ? { incident_id: incidentId, ...JSON.parse(raw) } : null;
  }
  return incidentId === SAMPLE_INCIDENT_ID ? SAMPLE_VERDICT : null;
}

export async function getTrace(incidentId) {
  if (getMode() === "live") {
    // Trace bodies live off-chain (Arweave/IPFS); the verdict references the
    // URI. Demo returns the embedded trace.
  }
  return incidentId === SAMPLE_INCIDENT_ID ? SAMPLE_TRACE : [];
}

export async function getMandates(incidentId) {
  if (getMode() === "live") {
    // Resolved per-agent from the contract's mandate registry.
  }
  return incidentId === SAMPLE_INCIDENT_ID ? SAMPLE_MANDATES : {};
}

export async function getGroundTruth(incidentId) {
  if (getMode() === "live") {
    // Recomputed deterministically on-chain; surfaced in the verdict metadata.
  }
  return incidentId === SAMPLE_INCIDENT_ID ? SAMPLE_GROUND_TRUTH : null;
}

export async function getReport(incidentId) {
  const [verdict, trace, mandates, groundTruth] = await Promise.all([
    getVerdict(incidentId),
    getTrace(incidentId),
    getMandates(incidentId),
    getGroundTruth(incidentId),
  ]);
  if (!verdict) return null;
  return { verdict, trace, mandates, groundTruth };
}
