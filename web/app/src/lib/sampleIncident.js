// A realistic multi-agent failure used to drive the report UI until the
// contract is live on Bradbury. The scenario: a procurement swarm (five
// vendors' agents) mis-executes a purchase and moves funds to the wrong
// counterparty. Mirrors the verdict schema produced by contracts/faultline.py.

export const SAMPLE_INCIDENT_ID = "inc-2026-08-02-procure-7f3a";

export const SAMPLE_TRACE = [
  { idx: 0, agent: "scout@acme-research", recorder: "acme", ts: "2026-08-02T14:02:11Z", action: "resolve_supplier", detail: "Queried vendor directory for 'industrial servo actuators'; returned 3 candidates incl. Nordberg Industrial (verified) and Nordberg Trading LLC (unverified lookalike)." },
  { idx: 1, agent: "scout@acme-research", recorder: "acme", ts: "2026-08-02T14:02:13Z", action: "handoff", detail: "Emitted candidate list to planner. Note attached: 'Nordberg Industrial is the audited entity — confirm registry id before funds move.'" },
  { idx: 2, agent: "planner@orbit-ops", recorder: "orbit", ts: "2026-08-02T14:02:31Z", action: "plan_purchase", detail: "Composed purchase plan: 40 units @ $1,250 = $50,000. Selected counterparty by NAME MATCH on 'Nordberg' — dropped scout's registry-id caveat." },
  { idx: 3, agent: "planner@orbit-ops", recorder: "orbit", ts: "2026-08-02T14:02:33Z", action: "handoff", detail: "Sent plan to compliance with counterparty='Nordberg Trading LLC' (unverified). Registry-id field left empty." },
  { idx: 4, agent: "compliance@verity-guard", recorder: "verity", ts: "2026-08-02T14:02:54Z", action: "kyc_check", detail: "Ran sanctions/KYC screen on 'Nordberg Trading LLC'. Result: NO HITS. Did NOT cross-check the ERC-8004 registry id (field absent), contrary to its mandate §3: 'verify counterparty identity against the on-chain registry before approval.'" },
  { idx: 5, agent: "compliance@verity-guard", recorder: "verity", ts: "2026-08-02T14:02:56Z", action: "approve", detail: "Marked plan COMPLIANT. Stamped approval token without registry attestation." },
  { idx: 6, agent: "executor@swift-settle", recorder: "swift", ts: "2026-08-02T14:03:10Z", action: "prepare_tx", detail: "Built payment of $50,000 to wallet on file for 'Nordberg Trading LLC'." },
  { idx: 7, agent: "auditor@ledgerline", recorder: "ledger", ts: "2026-08-02T14:03:12Z", action: "pre_settlement_audit", detail: "STAYED WITHIN MANDATE: read-only reconciliation. Detected counterparty registry-id mismatch and logged WARN: 'counterparty not in approved registry'. Mandate is advisory-only — no veto power." },
  { idx: 8, agent: "executor@swift-settle", recorder: "swift", ts: "2026-08-02T14:03:15Z", action: "sign_and_broadcast", detail: "Compliance approval token present → proceeded. Broadcast $50,000 transfer to Nordberg Trading LLC. Auditor's WARN is advisory and was not wired as a blocking control." },
  { idx: 9, agent: "executor@swift-settle", recorder: "swift", ts: "2026-08-02T14:03:18Z", action: "confirm", detail: "Tx confirmed. Funds moved to unverified counterparty. Realized loss: $50,000 (unrecoverable)." },
];

export const SAMPLE_MANDATES = {
  "scout@acme-research": "Research agent. Surface candidate suppliers and attach provenance caveats. Not authorized to select counterparties or move funds.",
  "planner@orbit-ops": "Planning agent. Compose purchase plans from scout output. MUST preserve all provenance caveats and resolve counterparties by registry id, never by name match.",
  "compliance@verity-guard": "Compliance agent. §1 run sanctions/KYC screens. §3 verify counterparty identity against the on-chain registry BEFORE approval; approval without registry attestation is out-of-mandate.",
  "auditor@ledgerline": "Audit agent. Read-only reconciliation and advisory warnings. No authority to block or approve transactions.",
  "executor@swift-settle": "Execution agent. Sign and broadcast payment ONLY when a valid compliance approval token is present. May rely on the token as the authorization boundary.",
};

export const SAMPLE_VERDICT = {
  incident_id: SAMPLE_INCIDENT_ID,
  opened_at: "2026-08-02T15:41:07Z",
  finalized_at: "2026-08-02T15:58:52Z",
  network: "GenLayer Bradbury (chain 4221)",
  validators: 5,
  consensus: "comparative re-execution · zero-gate + primary-fault agreement",
  trace_is_single_source: false,
  distinct_recorders: 5,
  allocations: [
    {
      agent_id: "planner@orbit-ops",
      fault_pct: 55,
      role: "proximate",
      within_mandate: false,
      trace_index: 2,
      reason: "Selected the counterparty by name match and dropped scout's registry-id caveat (idx 1). This is the act that introduced the wrong counterparty into the plan — the proximate cause of the loss, and out of mandate.",
    },
    {
      agent_id: "compliance@verity-guard",
      fault_pct: 30,
      role: "contributing",
      within_mandate: false,
      trace_index: 5,
      reason: "Approved the plan without the registry attestation its mandate §3 requires (idx 4–5). A correct registry cross-check would have caught the lookalike. Contributing, not proximate: the bad counterparty was already in the plan.",
    },
    {
      agent_id: "executor@swift-settle",
      fault_pct: 15,
      role: "contributing",
      within_mandate: true,
      trace_index: 8,
      reason: "Acted within its mandate (valid compliance token present). Shares limited fault because it treated an advisory-only WARN as non-blocking, but the authorization boundary it relied on was the compliance token.",
    },
    {
      agent_id: "scout@acme-research",
      fault_pct: 0,
      role: "uninvolved",
      within_mandate: true,
      trace_index: 1,
      reason: "Surfaced candidates and attached the correct provenance caveat (idx 1). Did exactly what its mandate requires. Zero-gate: scored 0 by both leader and validators.",
    },
    {
      agent_id: "auditor@ledgerline",
      fault_pct: 0,
      role: "uninvolved",
      within_mandate: true,
      trace_index: 7,
      reason: "Detected and logged the mismatch (idx 7). Mandate is advisory-only with no veto power; it discharged that duty. Zero-gate: scored 0 by both leader and validators.",
    },
  ],
};

export const SAMPLE_GROUND_TRUTH = {
  event_count: 10,
  agents_present_in_trace: ["auditor@ledgerline", "compliance@verity-guard", "executor@swift-settle", "planner@orbit-ops", "scout@acme-research"],
  agents_absent_from_trace: [],
  first_actor: "scout@acme-research",
  handoff_order: ["scout@acme-research", "planner@orbit-ops", "compliance@verity-guard", "executor@swift-settle"],
  distinct_recorders: 5,
  max_trace_index: 9,
  single_source_trace: false,
};
