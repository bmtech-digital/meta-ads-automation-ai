#!/usr/bin/env python3
"""Generate the thresholds reference table + Python constants from config/thresholds.yaml.

`config/thresholds.yaml` is the single source of truth for tunable rule
thresholds (winner ratio, anti-flood caps, utilization bands, etc.). This
script regenerates the artifacts derived from it:

    - The "Thresholds — Reference" table inside campaigner/CAMPAIGNER.md
      (between `<!-- BEGIN GENERATED:thresholds:reference-table -->` markers)
    - The schema-version banner inside campaigner/CAMPAIGNER.md
      (between `<!-- BEGIN GENERATED:thresholds:schema-version -->` markers)
    - campaigner/lib/thresholds.py  (Python constants — consumed by
      log_decision.py for schema-version stamping, and available to any
      lib code that needs the literals)

Run modes:

    python scripts/generate_from_thresholds.py            # write
    python scripts/generate_from_thresholds.py --check    # exit 1 on drift (CI)

The --check mode does not modify any files. It computes what the output
would be and compares against what is on disk. Drift means either a
hand-edit slipped past review or the YAML was changed without rerunning
the generator — rerun without --check to fix.
"""

from __future__ import annotations

import argparse
import difflib
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
THRESHOLDS_YAML = REPO_ROOT / "config" / "thresholds.yaml"
CAMPAIGNER_MD = REPO_ROOT / "campaigner" / "CAMPAIGNER.md"
THRESHOLDS_PY = REPO_ROOT / "campaigner" / "lib" / "thresholds.py"

SENTINEL_REFERENCE = "thresholds:reference-table"
SENTINEL_SCHEMA_VERSION = "thresholds:schema-version"

PY_HEADER = '''\
"""Generated from config/thresholds.yaml — do not edit by hand.

This module exposes the tunable rule thresholds the agent's prompts
reference as `{{<domain>.<name>}}` placeholders. The schema version is
stamped on every `agent_decisions` row by `log_decision.py`, so any past
run's decisions can be re-evaluated against the threshold snapshot that
was loaded for them.

Regenerate by editing `config/thresholds.yaml` and running
`make generate`. CI's `make verify-generated` rejects drift.
"""

from __future__ import annotations

'''


@dataclass(frozen=True)
class Threshold:
    domain: str
    name: str
    value: int | float
    unit: str | None
    description: str

    @property
    def dotted(self) -> str:
        return f"{self.domain}.{self.name}"

    @property
    def constant_name(self) -> str:
        return f"{self.domain}_{self.name}".upper()

    @property
    def formatted_value(self) -> str:
        # Render value + unit the way the markdown reference shows it.
        # The unit follows the value with no space for "%" and "×" (idiomatic
        # in Hebrew/English prose), and with a space otherwise ("ILS", "days").
        if self.unit is None:
            return self._raw_value_str()
        if self.unit in {"%", "×"}:
            return f"{self._raw_value_str()}{self.unit}"
        return f"{self._raw_value_str()} {self.unit}"

    def _raw_value_str(self) -> str:
        if isinstance(self.value, float):
            # Keep trailing zeros stable (0.50 stays 0.50, not 0.5).
            return f"{self.value}"
        return str(self.value)


def load_registry() -> tuple[str, list[Threshold]]:
    raw = yaml.safe_load(THRESHOLDS_YAML.read_text())
    schema_version = raw["schema_version"]
    thresholds: list[Threshold] = []
    for domain, entries in raw.items():
        if domain == "schema_version":
            continue
        if not isinstance(entries, dict):
            raise SystemExit(f"ERROR: domain '{domain}' must be a mapping, got {type(entries).__name__}.")
        for name, spec in entries.items():
            if not isinstance(spec, dict) or "value" not in spec:
                raise SystemExit(
                    f"ERROR: threshold '{domain}.{name}' must be a mapping with at least a `value` key."
                )
            thresholds.append(
                Threshold(
                    domain=domain,
                    name=name,
                    value=spec["value"],
                    unit=spec.get("unit"),
                    description=spec.get("description", ""),
                )
            )
    return schema_version, thresholds


def render_reference_table(thresholds: list[Threshold]) -> str:
    lines = [
        "| Name | Value | Description |",
        "| --- | --- | --- |",
    ]
    current_domain = None
    for t in thresholds:
        if t.domain != current_domain:
            current_domain = t.domain
            lines.append(f"| **`{t.domain}.*`** | | |")
        lines.append(f"| `{{{{{t.dotted}}}}}` | {t.formatted_value} | {t.description} |")
    return "\n".join(lines)


def render_schema_version_banner(schema_version: str) -> str:
    return (
        f"**Thresholds schema version:** `{schema_version}` — "
        "stamped on every `agent_decisions` row this run writes. "
        "Tune values in [`config/thresholds.yaml`](../config/thresholds.yaml); "
        "renames bump the second digit, value tweaks bump the third."
    )


def render_python_module(schema_version: str, thresholds: list[Threshold]) -> str:
    lines = [PY_HEADER]
    lines.append(f'SCHEMA_VERSION = "{schema_version}"\n')
    current_domain = None
    for t in thresholds:
        if t.domain != current_domain:
            current_domain = t.domain
            lines.append(f"\n# {t.domain}")
        # Choose a literal repr that round-trips (ints as ints, floats as floats).
        if isinstance(t.value, bool):
            value_repr = "True" if t.value else "False"
        elif isinstance(t.value, float):
            value_repr = repr(t.value)
        else:
            value_repr = repr(t.value)
        lines.append(f"{t.constant_name} = {value_repr}")
    lines.append("")  # trailing newline
    return "\n".join(lines)


def replace_between_sentinels(text: str, sentinel: str, new_body: str) -> str:
    """Replace content between `<!-- BEGIN GENERATED:<sentinel> -->` and
    `<!-- END GENERATED:<sentinel> -->` markers.

    Raises if either marker is missing — sentinels must be added manually
    once; the generator owns the contents between them thereafter.
    """
    begin = f"<!-- BEGIN GENERATED:{sentinel} -->"
    end = f"<!-- END GENERATED:{sentinel} -->"
    pattern = re.compile(
        re.escape(begin) + r".*?" + re.escape(end),
        flags=re.DOTALL,
    )
    if not pattern.search(text):
        raise SystemExit(
            f"ERROR: sentinel pair '{sentinel}' not found in {CAMPAIGNER_MD.relative_to(REPO_ROOT)}.\n"
            f"  Expected: {begin} ... {end}\n"
            f"  Add the markers to the target file once; the generator "
            f"replaces everything between them."
        )
    replacement = f"{begin}\n{new_body}\n{end}"
    return pattern.sub(replacement, text)


def planned_outputs() -> dict[Path, str]:
    """Return {path: content} for every file the generator owns."""
    schema_version, thresholds = load_registry()
    outputs: dict[Path, str] = {}

    campaigner_text = CAMPAIGNER_MD.read_text()
    campaigner_text = replace_between_sentinels(
        campaigner_text, SENTINEL_SCHEMA_VERSION, render_schema_version_banner(schema_version)
    )
    campaigner_text = replace_between_sentinels(
        campaigner_text, SENTINEL_REFERENCE, render_reference_table(thresholds)
    )
    outputs[CAMPAIGNER_MD] = campaigner_text

    outputs[THRESHOLDS_PY] = render_python_module(schema_version, thresholds)
    return outputs


def write_mode() -> int:
    outputs = planned_outputs()
    changed: list[Path] = []
    for path, content in outputs.items():
        existing = path.read_text() if path.exists() else None
        if existing != content:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
            changed.append(path)
    if changed:
        print(f"Wrote {len(changed)} file(s):")
        for p in changed:
            print(f"  {p.relative_to(REPO_ROOT)}")
    else:
        print("Already up to date.")
    return 0


def check_mode() -> int:
    outputs = planned_outputs()
    drift: list[tuple[Path, str]] = []
    for path, content in outputs.items():
        existing = path.read_text() if path.exists() else ""
        if existing != content:
            diff = "\n".join(
                difflib.unified_diff(
                    existing.splitlines(),
                    content.splitlines(),
                    fromfile=f"a/{path.relative_to(REPO_ROOT)}",
                    tofile=f"b/{path.relative_to(REPO_ROOT)}",
                    lineterm="",
                )
            )
            drift.append((path, diff))
    if drift:
        print("DRIFT — generated files are out of sync with config/thresholds.yaml:")
        for path, diff in drift:
            print(f"\n--- {path.relative_to(REPO_ROOT)} ---")
            print(diff)
        print(
            "\nRun `make generate` to regenerate, then commit the result.\n"
            "If the change is intentional, edit config/thresholds.yaml first — "
            "hand-edits to generated files are rejected at review.",
        )
        return 1
    print("OK — generated files match config/thresholds.yaml.")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify generated files are in sync; exit 1 on drift. Used in CI.",
    )
    args = parser.parse_args(argv)
    if args.check:
        return check_mode()
    return write_mode()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
