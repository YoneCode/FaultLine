"""Shared helpers for FaultLine direct-mode tests.

Evidence is INLINE: open_investigation takes the trace and one mandate text per
agent as calldata and re-hashes each against its pre-anchored commitment. These
builders produce the bodies and their real SHA-256 digests so tests anchor
commitments that actually match the bytes they submit.

v0.6.0: verdicts must also be GROUNDED — every allocation cites an event its own
agent performed, echoes that event's action verbatim, and quotes the anchored
mandate clause it claims was violated. verdict_obj() builds a verdict that
satisfies those rules for make_trace()'s events; negative tests mutate it.
"""

import hashlib
import json

# Agent ids used across the suite. Two is the minimum for apportionment.
SCOUT = "scout@acme-research"
PLANNER = "planner@orbit-ops"
EXECUTOR = "executor@swift-settle"

MIN_BOND = 10_000_000_000_000_000  # 0.01 GEN in wei (matches contract MIN_BOND_WEI)

# The default trace: one event per agent, in handoff order.
DEFAULT_EVENTS = [
    (SCOUT, "resolve_supplier"),
    (PLANNER, "plan_purchase"),
    (EXECUTOR, "sign_and_broadcast"),
]

# A clause that appears verbatim in every make_mandate() body, so an
# out-of-mandate allocation can quote its own agent's anchored mandate.
MANDATE_CLAUSE = "never move funds off-mandate"


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def make_trace(recorders=None, events=None) -> str:
    """Build a newline-delimited JSON trace.

    `events` is a list of (agent_id, action) tuples; `recorders` cycles the
    recorder field so we can make multi-source or single-source traces.
    """
    if events is None:
        events = DEFAULT_EVENTS
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
        f"against the registry before approval; {MANDATE_CLAUSE}."
    )


def _first_event(agent, events):
    """(index, action) of the agent's first event, or (None, None) if absent."""
    for i, (aid, action) in enumerate(events):
        if aid == agent:
            return i, action
    return None, None


def verdict_obj(pcts, agent_ids, single_source=False, events=None) -> dict:
    """A verdict that is shape-valid AND grounded in the given events.

    Defaults: an agent with 0% is reported within mandate (no quote needed); any
    agent bearing fault is reported out of mandate and quotes MANDATE_CLAUSE,
    which is verbatim in its anchored mandate. Each allocation cites its own
    agent's first event and echoes that event's action.
    """
    if events is None:
        events = DEFAULT_EVENTS
    allocs = []
    for aid, pct in zip(agent_ids, pcts):
        idx, action = _first_event(aid, events)
        within = pct == 0
        allocs.append({
            "agent_id": aid,
            "fault_pct": pct,
            "role": "uninvolved" if pct == 0 else ("proximate" if pct >= 50 else "contributing"),
            "within_mandate": within,
            # An agent absent from the trace has no event of its own to cite; it
            # must carry 0%, and the contract skips the citation checks for it.
            "trace_index": 0 if idx is None else idx,
            "cited_action": "" if action is None else action,
            "mandate_quote": "" if within else MANDATE_CLAUSE,
            "reason": f"{aid} allocation rationale",
        })
    return {"allocations": allocs, "trace_is_single_source": single_source}


def verdict_json(pcts, agent_ids, single_source=False, events=None) -> str:
    return json.dumps(verdict_obj(pcts, agent_ids, single_source=single_source, events=events))


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
