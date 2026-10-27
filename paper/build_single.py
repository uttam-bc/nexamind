"""Inline every \\input of nexamind.tex into one file (nexamind_full.tex) and run basic checks.

Run from paper/:  python build_single.py
Checks: every \\eXxx number macro used is defined, \\begin/\\end environments balance, braces balance,
and lists values still waiting for experiment runs (printed as ??).
"""

import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
INPUT = re.compile(r"\\input\{([^}]+)\}")


def inline(text: str) -> str:
    def repl(match: re.Match) -> str:
        name = match.group(1)
        path = HERE / (name if name.endswith(".tex") else f"{name}.tex")
        return f"% ---- begin {name} ----\n{inline(path.read_text(encoding='utf-8')).rstrip()}\n% ---- end {name} ----"
    return INPUT.sub(repl, text)


def check(text: str) -> list[str]:
    problems = []
    body = re.sub(r"(?<!\\)%.*", "", text)  # drop comments
    defined = set(re.findall(r"\\newcommand\{\\(\w+)\}", body))
    used = set(re.findall(r"\\(e(?:One|Two|Three|Four|Five)\w+)", body))
    for name in sorted(used - defined):
        problems.append(f"undefined macro \\{name}")
    stack = []
    for kind, env in re.findall(r"\\(begin|end)\{([^}]+)\}", body):
        if kind == "begin":
            stack.append(env)
        elif not stack or stack.pop() != env:
            problems.append(f"unbalanced \\end{{{env}}}")
    problems += [f"unclosed \\begin{{{env}}}" for env in stack]
    depth = 0
    for ch in re.sub(r"\\[{}]", "", body):
        depth += ch == "{"
        depth -= ch == "}"
        if depth < 0:
            problems.append("a closing brace without an opening one")
            break
    if depth > 0:
        problems.append(f"{depth} unclosed brace(s)")
    return problems


def main() -> None:
    full = inline((HERE / "nexamind.tex").read_text(encoding="utf-8"))
    (HERE / "nexamind_full.tex").write_text(full, encoding="utf-8")
    problems = check(full)
    pending = sorted(set(re.findall(r"\\newcommand\{\\(\w+)\}\{\\textbf\{\?\?\}\}", full)))
    print(f"wrote nexamind_full.tex ({len(full.splitlines())} lines)")
    print(f"values still waiting for runs: {len(pending)}")
    for p in problems:
        print("PROBLEM:", p)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
