"""Reproducible evaluation for the NexaMind paper.

Run from backend/:  python -m eval.run_eval
Writes eval/results.json. Uses an in-memory SQLite database and no AI provider keys.
"""

import asyncio
import json
import os
import platform
import statistics
import sys
import time
import uuid
from pathlib import Path

os.environ.update({
    "APP_ENV": "test",
    "GEMINI_API_KEY": "",
    "GROQ_API_KEY": "",
    "REDIS_URL": "",
    "RATE_LIMIT_ENABLED": "false",
    "REQUIRE_EMAIL_VERIFICATION": "false",  # eval users live only in the in-memory database
    "RUN_BACKGROUND_JOBS": "false",
    "AUTO_CREATE_SCHEMA": "false",
    "UPLOAD_DIR": str(Path(__file__).parent / ".eval_uploads"),
})


import app.models  # noqa: E402,F401
from app.services.agent_planner import plan  # noqa: E402
from eval.harness import Harness  # noqa: E402
from eval.planner_dataset import ACTIONABLE, NON_ACTIONABLE, PARAPHRASES  # noqa: E402

READ_ONLY_TOOLS = {"search_finance", "search_sessions", "search_documents", "get_document", "list_tasks",
                   "list_channels", "list_repos", "switch_workspace"}


# ------------------------------------------------------------------------------------------
# E1: offline command parser
# ------------------------------------------------------------------------------------------

def score_set(dataset) -> dict:
    exact, tool_match, arg_checks, arg_correct, no_action = 0, 0, 0, 0, 0
    failures = []
    for prompt, expected in dataset:
        calls = plan(prompt).calls
        if not calls:
            no_action += 1
        got_tools = [c.tool for c in calls]
        want_tools = [t for t, _ in expected]
        tools_ok = got_tools == want_tools
        args_ok = tools_ok
        if tools_ok:
            tool_match += 1
            for call, (_, want_args) in zip(calls, expected):
                for key, value in want_args.items():
                    arg_checks += 1
                    if call.args.get(key) == value:
                        arg_correct += 1
                    else:
                        args_ok = False
        else:
            arg_checks += sum(len(a) for _, a in expected)
        if tools_ok and args_ok:
            exact += 1
        else:
            failures.append({"prompt": prompt, "expected": expected,
                             "got": [(c.tool, c.args) for c in calls]})
    n = len(dataset)
    return {
        "prompts": n,
        "tool_sequence_accuracy": tool_match / n,
        "exact_match_accuracy": exact / n,
        "argument_accuracy": arg_correct / arg_checks if arg_checks else None,
        "argument_checks": arg_checks,
        "no_action_rate": no_action / n,
        "wrong_action_rate": (n - tool_match - no_action) / n,
        "failures": failures,
    }


def evaluate_planner() -> dict:

    false_write, false_read = 0, 0
    false_actions = []
    for prompt in NON_ACTIONABLE:
        calls = plan(prompt).calls
        if not calls:
            continue
        if any(c.tool not in READ_ONLY_TOOLS for c in calls):
            false_write += 1
        else:
            false_read += 1
        false_actions.append({"prompt": prompt, "got": [(c.tool, c.args) for c in calls]})

    return {
        "command_syntax": score_set(ACTIONABLE),
        "paraphrases": score_set(PARAPHRASES),
        "non_actionable_prompts": len(NON_ACTIONABLE),
        "false_write_actions": false_write,
        "false_read_only_actions": false_read,
        "false_actions": false_actions,
    }


# ------------------------------------------------------------------------------------------
# E2: access-control probe
# ------------------------------------------------------------------------------------------

async def evaluate_access_control() -> dict:
    """Every request an outsider or a non-participant should NOT be able to make.

    Each probe is (description, method, url, token, json). A probe passes when the
    server refuses it (401/403/404) and leaks no protected content.
    """
    async with Harness() as hx:
        c = hx.client
        alice, bob, eve, mallory = [await hx.user(n) for n in ("alice", "bob", "eve", "mallory")]

        team = (await c.post("/workspaces", headers=hx.h(alice["token"]), json={"name": "Team"})).json()
        for member in (bob, eve):
            await c.post("/workspaces/join", headers=hx.h(member["token"]), json={"join_code": team["join_code"]})
        tid = team["id"]

        doc = (await c.post(f"/workspaces/{alice['personal']}/documents", headers=hx.h(alice["token"]),
                            json={"title": "Private plan", "content": {"text": "secret-doc-marker"}})).json()
        await c.post(f"/workspaces/{alice['personal']}/finance/transactions", headers=hx.h(alice["token"]),
                     json={"type": "income", "amount": 999, "category": "secret-fin-marker", "date": "2026-10-01"})
        dm = (await c.post(f"/workspaces/{tid}/channels/dm", headers=hx.h(alice["token"]),
                           json={"target_username": "bob"})).json()
        await c.post(f"/workspaces/{tid}/channels/{dm['id']}/messages", headers=hx.h(alice["token"]),
                     json={"content": "secret-dm-marker"})
        priv = (await c.post(f"/workspaces/{tid}/channels", headers=hx.h(alice["token"]),
                             json={"name": "hr", "is_private": True})).json()
        await c.post(f"/workspaces/{tid}/channels/{priv['id']}/messages", headers=hx.h(alice["token"]),
                     json={"content": "secret-private-marker"})
        chat = (await c.post(f"/workspaces/{tid}/ai/chat", headers=hx.h(alice["token"]),
                             json={"prompt": "secret-ai-marker notes"})).json()
        meeting = (await c.post(f"/workspaces/{alice['personal']}/meetings/instant", headers=hx.h(alice["token"]),
                                json={"title": "Board", "client_request_id": "eval-board-meeting"})).json()

        # A DM opened by Alice toward Mallory must not give Mallory access to Alice's personal workspace.
        await c.post(f"/workspaces/{alice['personal']}/channels/dm", headers=hx.h(alice["token"]),
                     json={"target_username": "mallory"})

        ap, m, e = alice["personal"], mallory["token"], eve["token"]
        probes = [
            ("outsider reads documents", "GET", f"/workspaces/{ap}/documents", m, None),
            ("outsider reads a document by id", "GET", f"/workspaces/{ap}/documents/{doc['id']}", m, None),
            ("outsider reads finances", "GET", f"/workspaces/{ap}/finance/transactions", m, None),
            ("outsider reads finance summary", "GET", f"/workspaces/{ap}/finance/summary", m, None),
            ("outsider lists tasks", "GET", f"/workspaces/{ap}/tasks", m, None),
            ("outsider lists files", "GET", f"/workspaces/{ap}/files", m, None),
            ("outsider lists meetings", "GET", f"/workspaces/{ap}/sessions", m, None),
            ("outsider lists calendar", "GET", f"/workspaces/{ap}/calendar/events", m, None),
            ("outsider lists members", "GET", f"/workspaces/{ap}/members", m, None),
            ("outsider uses copilot", "POST", f"/workspaces/{ap}/ai/chat", m, {"prompt": "list everything"}),
            ("DM target reads sender's workspace docs", "GET", f"/workspaces/{ap}/documents", m, None),
            ("team member reads others' DM", "GET", f"/workspaces/{tid}/channels/{dm['id']}/messages", e, None),
            ("team member posts into others' DM", "POST", f"/workspaces/{tid}/channels/{dm['id']}/messages", e,
             {"content": "hi"}),
            ("team member reads private channel", "GET", f"/workspaces/{tid}/channels/{priv['id']}/messages", e, None),
            ("team member reads others' AI chat", "GET", f"/workspaces/{tid}/ai/sessions/{chat['session_id']}", e, None),
            ("outsider reads AI chat via own workspace", "GET",
             f"/workspaces/{mallory['personal']}/ai/sessions/{chat['session_id']}", m, None),
            ("outsider ends another workspace's meeting", "POST",
             f"/workspaces/{mallory['personal']}/meetings/{meeting['id']}/end", m, {"scope": "all"}),
            ("outsider assigns task to themselves in foreign workspace", "POST", f"/workspaces/{ap}/tasks", m,
             {"title": "x"}),
            ("anonymous reads documents", "GET", f"/workspaces/{ap}/documents", None, None),
            ("forged token reads documents", "GET", f"/workspaces/{ap}/documents", "eyJhbGciOiJub25lIn0.e30.", None),
        ]

        results = []
        markers = ("secret-doc-marker", "secret-fin-marker", "secret-dm-marker", "secret-private-marker",
                   "secret-ai-marker")
        for name, method, url, token, body in probes:
            headers = hx.h(token) if token else {}
            res = await c.request(method, url, headers=headers, json=body)
            leaked = any(mk in res.text for mk in markers)
            blocked = res.status_code in (401, 403, 404) and not leaked
            results.append({"probe": name, "status": res.status_code, "leaked": leaked, "blocked": blocked})

        # Listing channels as Eve must not reveal the DM or private channel names.
        listed = (await c.get(f"/workspaces/{tid}/channels", headers=hx.h(e))).json()
        hidden = all(ch["id"] not in (dm["id"], priv["id"]) for ch in listed)
        results.append({"probe": "team member's channel list hides DM and private channel", "status": 200,
                        "leaked": not hidden, "blocked": hidden})

        # Mallory's workspace list must still contain only her own workspace after Alice DM'd her.
        ws_list = (await c.get("/workspaces", headers=hx.h(m))).json()
        only_own = [w["id"] for w in ws_list] == [mallory["personal"]]
        results.append({"probe": "DM target gains no workspace membership", "status": 200,
                        "leaked": not only_own, "blocked": only_own})

    return {"probes": len(results), "blocked": sum(r["blocked"] for r in results), "results": results}


# ------------------------------------------------------------------------------------------
# E3: latency
# ------------------------------------------------------------------------------------------

async def evaluate_latency(iterations: int = 200) -> dict:
    async with Harness() as hx:
        c = hx.client
        u = await hx.user("bench")
        ws, h = u["personal"], hx.h(u["token"])
        for i in range(50):
            await c.post(f"/workspaces/{ws}/documents", headers=h,
                         json={"title": f"Doc {i}", "content": {"text": f"Notes about topic {i} and pricing"}})
        channel = (await c.get(f"/workspaces/{ws}/channels", headers=h)).json()[0]["id"]

        cases = {
            "GET documents (50 docs)": ("GET", f"/workspaces/{ws}/documents", None),
            "POST task": ("POST", f"/workspaces/{ws}/tasks", {"title": "bench task"}),
            "POST channel message": ("POST", f"/workspaces/{ws}/channels/{channel}/messages", {"content": "hello"}),
            "Copilot offline command": ("POST", f"/workspaces/{ws}/ai/chat", {"prompt": "create task 'Bench item'"}),
        }
        out = {}
        for name, (method, url, body) in cases.items():
            for _ in range(10):  # warm-up
                await c.request(method, url, headers=h, json=body)
            samples = []
            for _ in range(iterations):
                start = time.perf_counter()
                res = await c.request(method, url, headers=h, json=body)
                samples.append((time.perf_counter() - start) * 1000)
                assert res.status_code < 300, (name, res.status_code, res.text)
            samples.sort()
            out[name] = {
                "median_ms": round(statistics.median(samples), 2),
                "p95_ms": round(samples[int(0.95 * len(samples)) - 1], 2),
                "iterations": iterations,
            }
    return out


async def main() -> None:
    results = {
        "environment": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "processor": platform.processor(),
            "database": "SQLite (in-memory, aiosqlite)",
        },
        "planner": evaluate_planner(),
        "access_control": await evaluate_access_control(),
        "latency": await evaluate_latency(),
    }
    out = Path(__file__).parent / "results.json"
    out.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    p, a = results["planner"], results["access_control"]
    for label in ("command_syntax", "paraphrases"):
        q = p[label]
        print(f"E1 {label} (n={q['prompts']}): tools {q['tool_sequence_accuracy']:.1%}, exact {q['exact_match_accuracy']:.1%}, "
              f"args {q['argument_accuracy']}, no-action {q['no_action_rate']:.1%}, wrong-action {q['wrong_action_rate']:.1%}")
    print(f"E1 non-actionable: false writes {p['false_write_actions']}/{p['non_actionable_prompts']}, "
          f"false reads {p['false_read_only_actions']}: {p['false_actions']}")
    print(f"E2 access control: {a['blocked']}/{a['probes']} blocked")
    for name, r in results["latency"].items():
        print(f"E3 {name}: median {r['median_ms']} ms, p95 {r['p95_ms']} ms")
    print(f"wrote {out}")


if __name__ == "__main__":
    uuid.uuid4()
    asyncio.run(main())
