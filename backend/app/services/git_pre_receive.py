"""pre-receive hook for pushes (stdlib only; runs as `python -I` in git's hook environment).

The API decides the policy for the pushing user and passes it in NEXAMIND_REF_POLICY:
{"protected": [branch, ...], "default_branch": str, "can_manage": bool}. A push is refused as a
whole when any of its updates breaks the policy, and git shows our messages to the user.
"""

import json
import os
import sys

ZERO = "0" * 40


def main() -> int:
    policy = json.loads(os.environ.get("NEXAMIND_REF_POLICY") or "{}")
    protected = set(policy.get("protected") or [])
    default_branch = policy.get("default_branch")
    can_manage = bool(policy.get("can_manage"))
    problems = []
    for line in sys.stdin:
        parts = line.split()
        if len(parts) != 3:
            continue
        old, new, ref = parts
        if ref.startswith("refs/heads/"):
            branch = ref[len("refs/heads/"):]
            if branch in protected:
                problems.append(f"'{branch}' is a protected branch: open a pull request in NexaMind to change it.")
            elif new == ZERO and branch == default_branch:
                problems.append(f"'{branch}' is the default branch and can't be deleted.")
        elif ref.startswith("refs/tags/"):
            if not can_manage:
                problems.append(f"Only maintainers can push tags ({ref[len('refs/tags/'):]}).")
            elif old != ZERO:
                problems.append(f"Tag '{ref[len('refs/tags/'):]}' already exists; tags can't be moved or deleted by push.")
        else:
            problems.append(f"{ref}: only branches and tags can be pushed.")
    for problem in problems:
        print(f"NexaMind: {problem}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
