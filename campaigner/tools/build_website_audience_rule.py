"""
tools/build_website_audience_rule.py — emit a Meta WEBSITE custom audience rule.

Block 13 follow-up (2026-05-13): §T_AUD Lane A (WEBSITE Custom) requires
`propose_audience --rule '<json>'`. Before this tool, the agent hand-rolled
the JSON each time from prompt knowledge — fragile, inconsistent across
runs, and execute_task only catches errors after the operator approves.

This tool produces a validated Meta-flavored inclusions/exclusions rule
from a small operator-language surface:

  --website-url     domain to match visitors against (from business_knowledge.website_url)
  --days-back       retention window for the rule (defaults to 30; max 180)
  --include-path    substring path filters that constitute INCLUSION (repeatable)
  --exclude-path    substring path filters that exclude visitors (e.g. thank-you pages)

The output JSON matches Meta's rule grammar (`inclusions.operator='or'`,
`exclusions.operator='or'`, leaf events on `url` with `i_contains`).

Contract: §11.6 (single JSON on stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
from urllib.parse import urlparse

from campaigner.tools._contract import emit_success, emit_validation_error


def _domain_of(url: str) -> str:
    """Strip scheme + path + leading 'www.' so the rule matches all hosts of the domain."""
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = (parsed.netloc or parsed.path or "").strip().lower()
    if host.startswith("www."):
        host = host[4:]
    # Remove any port suffix.
    if ":" in host:
        host = host.split(":", 1)[0]
    return host


def _leaf(value: str) -> dict:
    """One inclusion/exclusion leaf — Meta wants `url i_contains <value>`."""
    return {"event_sources": [], "filter": {"operator": "i_contains", "value": value}}


def build_rule(
    *,
    website_url: str,
    days_back: int = 30,
    include_paths: list[str] | None = None,
    exclude_paths: list[str] | None = None,
) -> dict:
    """Pure function — call from python directly if you need to skip the CLI.

    The structure matches `MULTI_VALUE_CUSTOMER_FILTER`-style rule schemas
    used by Meta's Custom Audience API v22+. We don't include `event_sources`
    (left as []) — the pixel attaches via the propose_audience `--pixel-id`
    arg / business_knowledge default pixel.
    """
    domain = _domain_of(website_url)
    if not domain:
        raise ValueError(f"could not parse a domain from {website_url!r}")

    # Build inclusions: domain-wide match, plus any extra include-path filters
    # (they AND-combine within Meta's rule semantics on a single event).
    domain_leaf = {
        "filter": {
            "operator": "and",
            "filters": [
                {"field": "url", "operator": "i_contains", "value": domain},
                # Meta uses a 'time' filter at the event level for retention.
                {"field": "event", "operator": "eq", "value": "PageView"},
            ],
        },
        "retention_seconds": days_back * 86400,
    }
    inclusion_rules: list[dict] = [domain_leaf]
    for p in include_paths or []:
        inclusion_rules.append(
            {
                "filter": {
                    "operator": "and",
                    "filters": [
                        {"field": "url", "operator": "i_contains", "value": domain},
                        {"field": "url", "operator": "i_contains", "value": p},
                    ],
                },
                "retention_seconds": days_back * 86400,
            }
        )

    rule: dict = {"inclusions": {"operator": "or", "rules": inclusion_rules}}

    if exclude_paths:
        rule["exclusions"] = {
            "operator": "or",
            "rules": [
                {
                    "filter": {
                        "operator": "and",
                        "filters": [
                            {"field": "url", "operator": "i_contains", "value": domain},
                            {"field": "url", "operator": "i_contains", "value": p},
                        ],
                    },
                    "retention_seconds": days_back * 86400,
                }
                for p in exclude_paths
            ],
        }

    return rule


def main() -> None:
    p = argparse.ArgumentParser(
        description=(
            "Emit a Meta WEBSITE custom-audience rule (JSON) from a website "
            "URL and optional path filters. Use the output verbatim as the "
            "--rule arg to `propose_audience --task-type create_custom_audience "
            "--subtype WEBSITE`."
        )
    )
    p.add_argument(
        "--website-url",
        required=True,
        help="Domain to match against — passed verbatim from business_knowledge.website_url.",
    )
    p.add_argument(
        "--days-back",
        type=int,
        default=30,
        help="Retention window in days (1..180, default 30).",
    )
    p.add_argument(
        "--include-path",
        action="append",
        default=[],
        help="Substring path that visitors must have matched (repeatable; AND-combined per leaf).",
    )
    p.add_argument(
        "--exclude-path",
        action="append",
        default=[],
        help=(
            "Substring path that excludes a visitor (repeatable; OR-combined). "
            "Use for thank-you pages, logged-in dashboards, etc."
        ),
    )
    args = p.parse_args()

    if args.days_back < 1 or args.days_back > 180:
        emit_validation_error(f"--days-back must be in [1, 180] (got {args.days_back})")
        return

    try:
        rule = build_rule(
            website_url=args.website_url,
            days_back=args.days_back,
            include_paths=args.include_path,
            exclude_paths=args.exclude_path,
        )
    except ValueError as e:
        emit_validation_error(str(e))
        return

    emit_success(
        {
            "rule": rule,
            "domain_matched": _domain_of(args.website_url),
            "retention_days": args.days_back,
            "include_paths": args.include_path,
            "exclude_paths": args.exclude_path,
        }
    )


if __name__ == "__main__":
    main()
