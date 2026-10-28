"""Summarize eval/results_v2/*.jsonl (and eval/results.json) into the numbers the paper reports.

Run from backend/:  python -m eval.summarize_v2
Writes eval/results_v2/summary.json and ../paper/generated/results.tex (LaTeX macros), so every number in
the paper comes from the raw trial records.
"""

import json
import math
import statistics
from pathlib import Path

HERE = Path(__file__).parent
RESULTS = HERE / "results_v2"
PAPER = HERE.parent.parent / "paper" / "generated"
# model -> (results file prefix, tag used in macro names and tables)
MODELS = {"gemini-flash-lite-latest": "Lite", "openai/gpt-oss-120b": "Oss"}
DISPLAY = {"Lite": "Lite", "Oss": "GPT-OSS"}
FILES = {"gemini-flash-lite-latest": "gemini-gemini-flash-lite-latest", "openai/gpt-oss-120b": "groq-openai_gpt-oss-120b"}


def binom_cdf(k: int, n: int, p: float) -> float:
    return sum(math.comb(n, i) * p**i * (1 - p) ** (n - i) for i in range(k + 1))


def _bisect(f, target: float, increasing: bool) -> float:
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if (f(mid) < target) == increasing:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def clopper_pearson(k: int, n: int, alpha: float = 0.05) -> tuple[float, float]:
    """Exact two-sided (1 - alpha) interval for a binomial proportion."""
    if n == 0:
        return (0.0, 1.0)
    # P(X >= k) grows with p; P(X <= k) shrinks with p.
    lower = 0.0 if k == 0 else _bisect(lambda p: 1 - binom_cdf(k - 1, n, p), alpha / 2, increasing=True)
    upper = 1.0 if k == n else _bisect(lambda p: binom_cdf(k, n, p), alpha / 2, increasing=False)
    return (lower, upper)


def load(name: str) -> list[dict]:
    path = RESULTS / name
    if not path.exists():
        return []
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    latest = {}
    for r in rows:  # keep the last record of each trial
        latest[r["trial"]] = r
    return list(latest.values())


def pct(k: int, n: int) -> str:
    return f"{100 * k / n:.0f}\\%" if n else "---"


def ci(k: int, n: int) -> str:
    lo, hi = clopper_pearson(k, n)
    return f"[{100 * lo:.0f}, {100 * hi:.0f}]"


def summarize_model(model: str) -> dict:
    base = FILES[model]  # files are <provider>-<model>.jsonl
    rows = load(f"{base}.jsonl")
    norule = load(f"{base}-norule.jsonl")
    e4 = [r for r in rows if r["experiment"] == "e4"]
    free = [r for r in e4 if r["trial"].startswith("e4-free")]
    none = [r for r in e4 if r["trial"].startswith("e4-none")]

    def e5(records, kind):
        return [r for r in records if r["experiment"] == "e5" and r["kind"] == kind]

    out = {
        "model": model,
        "e4_free_n": len(free),
        "e4_goal": sum(r["goal_achieved"] for r in free),
        "e4_clarify": sum(r["asked_clarification"] for r in free if not r["goal_achieved"]),
        "e4_side_effect_cases": sum(bool(r["unrequested_tables"]) for r in free),
        "e4_side_effects": [(r["prompt"], r["unrequested_tables"]) for r in free if r["unrequested_tables"]],
        "e4_none_n": len(none),
        "e4_none_writes": sum(bool(r["changed_tables"]) for r in none),
        "e4_none_write_prompts": [(r["prompt"], r["changed_tables"]) for r in none if r["changed_tables"]],
        "e4_latency_median": statistics.median([r["seconds"] for r in e4]) if e4 else None,
        "e4_latency_p95": sorted(r["seconds"] for r in e4)[max(0, math.ceil(0.95 * len(e4)) - 1)] if e4 else None,
        "e4_calls": sum(r["model_calls"] for r in e4),
    }
    for label, records in (("rule", rows), ("norule", norule)):
        act, dis = e5(records, "action"), e5(records, "disclosure")
        benign, clean = e5(records, "benign_action"), e5(records, "clean")
        every = act + dis + benign + clean
        out[label] = {
            "action_n": len(act), "action_success": sum(bool(r["attack_succeeded"]) for r in act),
            "action_any_write": sum(r["any_write"] for r in act),
            "disclosure_n": len(dis), "disclosure_leak": sum(bool(r["attack_succeeded"]) for r in dis),
            "disclosure_in_reply": sum(r["secret_in_reply"] for r in dis),
            "benign_n": len(benign), "benign_writes": sum(r["any_write"] for r in benign),
            "clean_n": len(clean), "clean_writes": sum(r["any_write"] for r in clean),
            "summarized": sum(r["summarized"] for r in every), "total": len(every),
            "by_phrasing": {},
            "successes": [(r["case"], r["tools"], r["changed_tables"]) for r in act + dis if r["attack_succeeded"]],
            "calls": sum(r["model_calls"] for r in records if r["experiment"] == "e5"),
        }
        for r in act:
            slot = out[label]["by_phrasing"].setdefault(r["phrasing"], [0, 0])
            slot[0] += bool(r["attack_succeeded"])
            slot[1] += 1
    dates = sorted(r["ran_at"] for r in rows + norule)
    out["dates"] = (dates[0], dates[-1]) if dates else None
    return out


def macros(models: dict, offline: dict) -> str:
    lines = ["% Generated by backend/eval/summarize_v2.py from the raw trial records. Do not edit by hand."]

    def m(name, value):
        lines.append(f"\\newcommand{{\\{name}}}{{{value}}}")

    p = offline["planner"]
    cmd, para = p["command_syntax"], p["paraphrases"]
    m("eOneCmdN", cmd["prompts"])
    m("eOneFreeN", para["prompts"])
    m("eOneNoneN", p["non_actionable_prompts"])
    m("eOneTotal", cmd["prompts"] + para["prompts"] + p["non_actionable_prompts"])
    m("eOneCmdExact", pct(round(cmd["exact_match_accuracy"] * cmd["prompts"]), cmd["prompts"]))
    m("eOneCmdArgs", cmd["argument_checks"])
    m("eOneFreeExact", pct(round(para["exact_match_accuracy"] * para["prompts"]), para["prompts"]))
    m("eOneFreeActed", round((1 - para["no_action_rate"]) * para["prompts"]))
    m("eOneNoneWrites", p["false_write_actions"])
    m("eOneNoneReads", p["false_read_only_actions"])
    ac = offline["access_control"]
    m("eTwoProbes", ac["probes"])
    m("eTwoBlocked", ac["blocked"])
    for key, label in (("GET documents (50 docs)", "Docs"), ("POST task", "Task"), ("POST channel message", "Msg"),
                       ("Copilot offline command", "Copilot")):
        m(f"eThree{label}Med", f"{offline['latency'][key]['median_ms']:.1f}")
        m(f"eThree{label}Pct", f"{offline['latency'][key]['p95_ms']:.1f}")

    # Every macro is always defined; a value whose trials have not run yet prints as a visible ??.
    missing = r"\textbf{??}"
    for model, tag in MODELS.items():
        s = models.get(model) or {}
        if s.get("e4_free_n") and s.get("e4_none_n"):
            m(f"eFour{tag}N", s["e4_free_n"])
            m(f"eFour{tag}Goal", s["e4_goal"])
            m(f"eFour{tag}GoalPct", pct(s["e4_goal"], s["e4_free_n"]))
            m(f"eFour{tag}GoalCI", ci(s["e4_goal"], s["e4_free_n"]))
            m(f"eFour{tag}Clarify", s["e4_clarify"])
            m(f"eFour{tag}Side", s["e4_side_effect_cases"])
            m(f"eFour{tag}NoneN", s["e4_none_n"])
            m(f"eFour{tag}NoneWrites", s["e4_none_writes"])
            m(f"eFour{tag}Lat", f"{s['e4_latency_median']:.1f}")
            m(f"eFour{tag}LatP", f"{s['e4_latency_p95']:.1f}")
        else:
            for name in ("N", "Goal", "GoalPct", "GoalCI", "Clarify", "Side", "NoneN", "NoneWrites", "Lat", "LatP"):
                m(f"eFour{tag}{name}", missing)
        for label, cond in (("rule", "Rule"), ("norule", "NoRule")):
            r = s.get(label) or {}
            complete = r.get("action_n") == 48 and r.get("disclosure_n") == 6 and r.get("benign_n") == 6 and r.get("clean_n") == 6
            if not complete:
                for name in ("ActN", "Act", "ActPct", "ActCI", "Write", "DisN", "Dis", "DisReply", "BenN", "BenWrite", "Sum"):
                    m(f"eFive{tag}{cond}{name}", missing)
                continue
            m(f"eFive{tag}{cond}ActN", r["action_n"])
            m(f"eFive{tag}{cond}Act", r["action_success"])
            m(f"eFive{tag}{cond}ActPct", pct(r["action_success"], r["action_n"]))
            m(f"eFive{tag}{cond}ActCI", ci(r["action_success"], r["action_n"]))
            m(f"eFive{tag}{cond}Write", r["action_any_write"])
            m(f"eFive{tag}{cond}DisN", r["disclosure_n"])
            m(f"eFive{tag}{cond}Dis", r["disclosure_leak"])
            m(f"eFive{tag}{cond}DisReply", r["disclosure_in_reply"])
            m(f"eFive{tag}{cond}BenN", r["benign_n"] + r["clean_n"])
            m(f"eFive{tag}{cond}BenWrite", r["benign_writes"] + r["clean_writes"])
            m(f"eFive{tag}{cond}Sum", pct(r["summarized"], r["total"]))
    return "\n".join(lines) + "\n"


def frac(k: int, n: int) -> str:
    return f"{k}/{n}" if n else "---"


E4_TABLE = r"""% Generated by backend/eval/summarize_v2.py.
\begin{table}[t]
\centering
\caption{Live copilot on free-form and non-actionable prompts (E4), scored by database state.}
\label{tab:e4}
\small
\setlength{\tabcolsep}{3pt}
\begin{tabular}{@{}lcccccc@{}}
\toprule
Model & Goal & 95\% CI & Asked & Unreq. & Non-act. & Median \\
 & reached & (\%) & first & writes & writes & (s) \\
\midrule
ROWS
\bottomrule
\end{tabular}
\end{table}
"""

E5_TABLE = r"""% Generated by backend/eval/summarize_v2.py.
\begin{table}[t]
\centering
\caption{Indirect prompt injection and disclosure (E5). Rule: the untrusted-content instruction in the system prompt.}
\label{tab:e5}
\small
\setlength{\tabcolsep}{2.5pt}
\begin{tabular}{@{}llcccccc@{}}
\toprule
Model & Rule & Action & 95\% CI & Any & Disclo- & False & Summa- \\
 & & attacks & (\%) & write & sure & action & rized \\
\midrule
ROWS
\bottomrule
\end{tabular}
\end{table}
"""


def e4_table(models: dict) -> str:
    rows = []
    for model, tag in MODELS.items():
        s = models.get(model)
        if not s or not (s["e4_free_n"] == 25 and s["e4_none_n"] == 20):
            rows.append(f"{DISPLAY[tag]} & " + " & ".join([r"\textbf{??}"] * 6) + r" \\")
            continue
        rows.append(f"{DISPLAY[tag]} & {frac(s['e4_goal'], s['e4_free_n'])} & {ci(s['e4_goal'], s['e4_free_n'])} & "
                    f"{s['e4_clarify']} & {s['e4_side_effect_cases']} & {frac(s['e4_none_writes'], s['e4_none_n'])} & "
                    f"{s['e4_latency_median']:.1f} \\\\")
    return E4_TABLE.replace("ROWS", "\n".join(rows))


def e5_table(models: dict) -> str:
    rows = []
    for model, tag in MODELS.items():
        s = models.get(model)
        if not s:
            continue
        for label, name in (("rule", "on"), ("norule", "off")):
            if tag == "Oss" and label == "norule":
                continue  # the ablation runs on Lite only
            r = s[label]
            if not (r["action_n"] == 48 and r["disclosure_n"] == 6 and r["benign_n"] + r["clean_n"] == 12):
                rows.append(f"{DISPLAY[tag]} & {name} & " + " & ".join([r"\textbf{??}"] * 6) + r" \\")
                continue
            controls = r["benign_n"] + r["clean_n"]
            rows.append(f"{DISPLAY[tag]} & {name} & {frac(r['action_success'], r['action_n'])} & "
                        f"{ci(r['action_success'], r['action_n'])} & {r['action_any_write']} & "
                        f"{frac(r['disclosure_leak'], r['disclosure_n'])} & "
                        f"{frac(r['benign_writes'] + r['clean_writes'], controls)} & "
                        f"{pct(r['summarized'], r['total'])} \\\\")
    return E5_TABLE.replace("ROWS", "\n".join(rows))


def main() -> None:
    offline = json.loads((HERE / "results.json").read_text(encoding="utf-8"))
    models = {name: summarize_model(name) for name in MODELS}
    (RESULTS / "summary.json").write_text(json.dumps(models, indent=2), encoding="utf-8")
    PAPER.mkdir(parents=True, exist_ok=True)
    (PAPER / "results.tex").write_text(macros(models, offline), encoding="utf-8")
    (PAPER / "e4_table.tex").write_text(e4_table(models), encoding="utf-8")
    (PAPER / "e5_table.tex").write_text(e5_table(models), encoding="utf-8")
    print(json.dumps(models, indent=2))


if __name__ == "__main__":
    main()
