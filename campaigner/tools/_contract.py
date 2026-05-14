"""
Shared helpers for the `campaigner/tools/*` CLI tools.

Contract (spec §11.6):
  - Input: CLI args only.
  - Output: JSON on stdout; logs on stderr.
  - Exit codes: 0 success, 1 runtime error, 2 validation error.

Every tool routes all its exits through `emit_*` so the contract is
enforced in one place. Tools never call `sys.exit` or `print` directly.
"""

from __future__ import annotations

import json
import sys
import time
import traceback
from collections.abc import Callable
from typing import Any, TypeVar

import psycopg

T = TypeVar("T")


def emit_success(data: Any) -> None:
    """Write `data` as JSON to stdout and exit 0."""
    json.dump(data, sys.stdout, ensure_ascii=False, default=_json_default)
    sys.stdout.write("\n")
    sys.stdout.flush()
    sys.exit(0)


def emit_validation_error(message: str, detail: Any = None) -> None:
    """Exit 2 — caller passed invalid or missing args / malformed payloads."""
    payload: dict[str, Any] = {"error": "validation_error", "message": message}
    if detail is not None:
        payload["detail"] = detail
    json.dump(payload, sys.stdout, ensure_ascii=False, default=_json_default)
    sys.stdout.write("\n")
    sys.stdout.flush()
    print(f"VALIDATION: {message}", file=sys.stderr)
    sys.exit(2)


def emit_runtime_error(message: str, exc: BaseException | None = None) -> None:
    """Exit 1 — operation failed at runtime (DB down, API error, etc.)."""
    payload: dict[str, Any] = {"error": "runtime_error", "message": message}
    if exc is not None:
        payload["exception_type"] = type(exc).__name__
    json.dump(payload, sys.stdout, ensure_ascii=False, default=_json_default)
    sys.stdout.write("\n")
    sys.stdout.flush()
    print(f"ERROR: {message}", file=sys.stderr)
    if exc is not None:
        traceback.print_exception(type(exc), exc, exc.__traceback__, file=sys.stderr)
    sys.exit(1)


def parse_json_arg(raw: str | None, arg_name: str) -> dict | list | None:
    """Parse a CLI arg that is expected to hold a JSON literal. Returns None if raw is None."""
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        emit_validation_error(f"--{arg_name} is not valid JSON: {e.msg}")
        return None  # unreachable — emit_validation_error exits


def with_db_retry(
    func: Callable[[], T],
    *,
    attempts: int = 3,
    initial_delay_s: float = 0.5,
) -> T:
    """
    Retry `func()` on transient psycopg connection errors.

    Only retries on `psycopg.OperationalError` (connection refused, server gone
    away, network blip). Does NOT retry on `IntegrityError` or `ProgrammingError`
    — those are bugs the caller must fix.

    Delays: 0.5s, 1.5s, 3s (exponential, base 3). Total ~5s over 3 attempts.
    """
    delay = initial_delay_s
    for attempt in range(1, attempts + 1):
        try:
            return func()
        except psycopg.OperationalError as e:
            if attempt == attempts:
                raise
            print(
                f"WARN: DB operation failed (attempt {attempt}/{attempts}): {e}. "
                f"Retrying in {delay:.1f}s...",
                file=sys.stderr,
            )
            time.sleep(delay)
            delay *= 3
    raise RuntimeError("unreachable")  # type-checker appeasement


def _json_default(obj: Any) -> Any:
    """Fallback serializer for types json can't handle by default (datetime, UUID, Decimal)."""
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if hasattr(obj, "hex"):  # UUID
        return str(obj)
    return str(obj)
