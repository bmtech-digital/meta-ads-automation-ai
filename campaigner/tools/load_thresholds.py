"""
tools/load_thresholds.py — read the tunable rule thresholds the agent reasons against.

Source of truth: `config/thresholds.yaml`. The Python constants module
`campaigner/lib/thresholds.py` is regenerated from it by
`scripts/generate_from_thresholds.py`.

The agent does NOT need to call this tool to apply thresholds — the
prompts it loads already contain a `{{<domain>.<name>}}` placeholder for
every threshold, and `campaigner/CAMPAIGNER.md` carries the resolution
table inline. This tool exists for two narrow purposes:

  1. Diagnostic — an operator running `python -m campaigner.tools.load_thresholds`
     locally wants to see exactly what's loaded.
  2. Run start — a flow that wants to echo the loaded schema version in
     its boot `log_decision` (every subsequent row already carries the
     same version, stamped by `log_decision.py` from the constants
     module, so the boot echo is informational, not load-bearing).

PRD Step 3 (2026-05-18).
"""

from __future__ import annotations

import argparse

from campaigner.lib.thresholds import SCHEMA_VERSION
from campaigner.tools._contract import emit_success


def _all_constants_as_dict() -> dict[str, int | float | str]:
    """Return every UPPER_SNAKE_CASE constant in campaigner.lib.thresholds.

    Skips `SCHEMA_VERSION` (returned separately) and any private name.
    """
    from campaigner.lib import thresholds as t

    result: dict[str, int | float | str] = {}
    for name in dir(t):
        if name.startswith("_") or name == "SCHEMA_VERSION":
            continue
        if not name.isupper():
            continue
        value = getattr(t, name)
        if isinstance(value, int | float | str):
            result[name] = value
    return result


def main() -> None:
    p = argparse.ArgumentParser(
        description=(
            "Emit the loaded thresholds.yaml schema version + (optionally) all "
            "constants. The agent doesn't need this tool to apply thresholds — "
            "see the docstring."
        )
    )
    p.add_argument(
        "--include-values",
        action="store_true",
        help=(
            "Include every threshold constant in the output (default: just "
            "schema_version). Useful for diagnostic / debugging contexts."
        ),
    )
    args = p.parse_args()

    payload: dict = {"schema_version": SCHEMA_VERSION}
    if args.include_values:
        payload["values"] = _all_constants_as_dict()
    emit_success(payload)


if __name__ == "__main__":
    main()
