"""Shared helpers for FaultLine direct-mode tests.

The contract's judge fetches a pre-anchored trace plus one mandate per agent and
hashes each against its on-chain commitment. These builders produce the bodies and
their real SHA-256 digests so tests register commitments that actually match what
the judge will download — anything else would fail the hash check by construction.
"""

import hashlib
import json

# Agent ids used across the suite. Two is the minimum for apportionment.
SCOUT = "scout@acme-research"
PLANNER = "planner@orbit-ops"
EXECUTOR = "executor@swift-settle"

MIN_BOND = 10_000_000_000_000_000  # 0.01 GEN in wei (matches contract MIN_BOND_WEI)


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def make_trace(recorders=None, events=None) -> str:
    """Build a newline-delimited JSON trace.

    `events` is a list of (agent_id, action) tuples; `recorders` cycles the
    recorder field so we can make multi-source or single-source traces.
    """
    if events is None:
        events = [
            (SCOUT, "resolve_supplier"),
            (PLANNER, "plan_purchase"),
            (EXECUTOR, "sign_and_broadcast"),
        ]
    if recorders is None:
        recorders = ["acme", "orbit", "swift"]
    lines = []
    for i, (agent, action) in enumerate(events):
        lines.append(json.dumps({
            "idx": i,
            "agent_id": agent,
            "recorder": recorders[i % len(recorders)],
            "ts": f"2026-08-02T14:0{i}:00Z",
            "action": action,
            "detail": f"{agent} performed {action}",
        }))
    return "\n".join(lines)


def make_mandate(agent: str) -> str:
    return (
        f"{agent} mandate. Stay within your declared role; verify counterparties "
        f"against the registry before approval; never move funds off-mandate."
    )


def verdict_json(pcts, agent_ids, single_source=False, trace_index=1) -> str:
    """A shape-valid verdict for the given agents. pcts must sum to 100."""
    allocs = []
    for aid, pct in zip(agent_ids, pcts):
        role = "uninvolved" if pct == 0 else ("proximate" if pct == max(pcts) else "contributing")
        allocs.append({
            "agent_id": aid,
            "fault_pct": pct,
            "role": role,
            "within_mandate": pct == 0,
            "trace_index": trace_index,
            "reason": f"{aid} allocation rationale",
        })
    return json.dumps({"allocations": allocs, "trace_is_single_source": single_source})


def mock_evidence(vm, trace, mandates: dict, trace_status=200):
    """Register web mocks so the judge's fetches resolve.

    The trace is fetched from the URI recorded at record_trace_hash time; the
    mandates from the URIs registered per agent. We key mocks by URL substring so
    each agent's mandate returns its own body (first-match-wins in gltest).
    """
    vm.mock_web(r".*trace\.json.*", {"status": trace_status, "body": trace})
    for aid, body in mandates.items():
        # mandate URLs are https://evidence.test/mandate/<agent-with-dashes>.txt
        slug = aid.replace("@", "-").replace(".", "-")
        vm.mock_web(r".*mandate/" + slug.replace("-", r"\-") + r"\..*", {"status": 200, "body": body})


def mandate_url(agent: str) -> str:
    slug = agent.replace("@", "-").replace(".", "-")
    return f"https://evidence.test/mandate/{slug}.txt"
