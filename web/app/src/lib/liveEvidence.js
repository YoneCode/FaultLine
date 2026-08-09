// REAL evidence for the live incident — the exact bytes that hash to the
// on-chain commitments (sha256 verified against evidence/manifest.json). Bundled
// so the report renders the trace/mandates without a fetch; the on-chain verdict
// itself always comes from the contract via get_verdict. This is display data
// provenance — the authoritative record is the chain.

export const LIVE_INCIDENT_ID = "inc-2026-08-02-procure-7f3a";

export const LIVE_TRACE_SHA256 = "9274c46df8b97677bd9108ef7d3b6431d55fab281e3babea2daf97950d06d15e";
export const LIVE_TRACE_URI = "https://ipfs.io/ipfs/QmZtpUniwdVSVUaKAx8kek9Y4mfUD6jWWUW9HWkxWvJTMG";

export const LIVE_TRACE = [
  {
    "idx": 0,
    "agent_id": "scout@acme-research",
    "recorder": "acme",
    "ts": "2026-08-02T14:02:11Z",
    "action": "resolve_supplier",
    "detail": "Queried vendor directory for 'industrial servo actuators'; returned 3 candidates including Nordberg Industrial (registry-verified) and Nordberg Trading LLC (unverified lookalike)."
  },
  {
    "idx": 1,
    "agent_id": "scout@acme-research",
    "recorder": "acme",
    "ts": "2026-08-02T14:02:13Z",
    "action": "handoff",
    "detail": "Emitted candidate list to planner with caveat: 'Nordberg Industrial is the audited entity - confirm registry id before funds move.'"
  },
  {
    "idx": 2,
    "agent_id": "planner@orbit-ops",
    "recorder": "orbit",
    "ts": "2026-08-02T14:02:31Z",
    "action": "plan_purchase",
    "detail": "Composed purchase plan: 40 units @ $1,250 = $50,000. Selected counterparty by NAME MATCH on 'Nordberg' and dropped the scout's registry-id caveat."
  },
  {
    "idx": 3,
    "agent_id": "planner@orbit-ops",
    "recorder": "orbit",
    "ts": "2026-08-02T14:02:33Z",
    "action": "handoff",
    "detail": "Sent plan to compliance with counterparty='Nordberg Trading LLC' (unverified). Registry-id field left empty."
  },
  {
    "idx": 4,
    "agent_id": "compliance@verity-guard",
    "recorder": "verity",
    "ts": "2026-08-02T14:02:54Z",
    "action": "kyc_check",
    "detail": "Ran sanctions/KYC screen on 'Nordberg Trading LLC': NO HITS. Did NOT cross-check the on-chain registry id (field absent), contrary to mandate section 3 requiring registry verification before approval."
  },
  {
    "idx": 5,
    "agent_id": "compliance@verity-guard",
    "recorder": "verity",
    "ts": "2026-08-02T14:02:56Z",
    "action": "approve",
    "detail": "Marked plan COMPLIANT and stamped an approval token without registry attestation."
  },
  {
    "idx": 6,
    "agent_id": "executor@swift-settle",
    "recorder": "swift",
    "ts": "2026-08-02T14:03:10Z",
    "action": "prepare_tx",
    "detail": "Built payment of $50,000 to the wallet on file for 'Nordberg Trading LLC'."
  },
  {
    "idx": 7,
    "agent_id": "auditor@ledgerline",
    "recorder": "ledger",
    "ts": "2026-08-02T14:03:12Z",
    "action": "pre_settlement_audit",
    "detail": "Read-only reconciliation. Detected counterparty registry-id mismatch and logged WARN: 'counterparty not in approved registry'. Mandate is advisory-only with no veto power."
  },
  {
    "idx": 8,
    "agent_id": "executor@swift-settle",
    "recorder": "swift",
    "ts": "2026-08-02T14:03:15Z",
    "action": "sign_and_broadcast",
    "detail": "Compliance approval token present, so proceeded. Broadcast $50,000 transfer to Nordberg Trading LLC. The auditor's WARN is advisory and not wired as a blocking control."
  },
  {
    "idx": 9,
    "agent_id": "executor@swift-settle",
    "recorder": "swift",
    "ts": "2026-08-02T14:03:18Z",
    "action": "confirm",
    "detail": "Transaction confirmed. Funds moved to an unverified counterparty. Realized loss: $50,000, unrecoverable."
  }
];

export const LIVE_MANDATES = {
  "scout@acme-research": "SCOUT (acme-research) — research agent mandate.\nSurface candidate suppliers and attach provenance caveats. You are NOT authorized\nto select counterparties or to move funds. Always forward registry-verification\ncaveats to downstream agents unchanged.\n",
  "planner@orbit-ops": "PLANNER (orbit-ops) — planning agent mandate.\nCompose purchase plans from scout output. You MUST preserve all provenance\ncaveats and resolve counterparties by on-chain registry id, never by name match.\nDropping a registry-verification caveat is out of mandate.\n",
  "compliance@verity-guard": "COMPLIANCE (verity-guard) — compliance agent mandate.\nSection 1: run sanctions/KYC screens. Section 3: verify counterparty identity\nagainst the on-chain registry BEFORE approval. Approval without registry\nattestation is out of mandate.\n",
  "executor@swift-settle": "EXECUTOR (swift-settle) — execution agent mandate.\nSign and broadcast payment ONLY when a valid compliance approval token is present.\nYou may rely on the approval token as the authorization boundary.\n",
  "auditor@ledgerline": "AUDITOR (ledgerline) — audit agent mandate.\nRead-only reconciliation and advisory warnings. You have NO authority to block\nor approve transactions; your output is advisory only.\n"
};

export const LIVE_MANDATE_META = {
  "scout@acme-research": {
    "sha256": "387966d88be67bae219f28efc5e19046b10c6665638919a2ea5fdd4bd1af262e",
    "uri": "https://ipfs.io/ipfs/QmTae63UkUMSEf3afYokHgDEsEgU4E2daPZp2qGK1R9vGK"
  },
  "planner@orbit-ops": {
    "sha256": "c447512458e2160a37628d8c1e1e9fd7a4b339af869f31e098dfb372726d85af",
    "uri": "https://ipfs.io/ipfs/QmcP8w2h3AoG89VXTn5kAuvxYnwcquqWknaM2CBTfAhxxt"
  },
  "compliance@verity-guard": {
    "sha256": "73772d8a92b9eeb88854a5d603adb7733ef5b18db65481b7e8418cdb8159224f",
    "uri": "https://ipfs.io/ipfs/QmREVpAtRteo7tRiRfKXrogqYybL2R5mmAaXmHSkjBrPtQ"
  },
  "executor@swift-settle": {
    "sha256": "798206161c47b9f09b1d6928e585ef11fc45864b8c9e5342528e8b4336465782",
    "uri": "https://ipfs.io/ipfs/QmZG5eyk59PuLwZG9ZCZC2V9TM4VeXGmZu722DHDCF1cfp"
  },
  "auditor@ledgerline": {
    "sha256": "e22d4e3d258e319cdbfd52c6b454b963a841cb4be4391e073092834f0c085d57",
    "uri": "https://ipfs.io/ipfs/QmaLE79Un3E9F59FTsjPxM4gmt6tMbtAFjYPhmqbManr1i"
  }
};
