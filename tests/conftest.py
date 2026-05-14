"""
Shared pytest fixtures for campaigner tests.

Tests run against the *same* local Postgres as dev — we're validating the
contract + SQL wiring, not mocked behavior. Each test gets a fresh `run_id`
and is responsible (via fixtures here) for cleaning up anything it wrote.
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import Callable
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return REPO_ROOT


@pytest.fixture(scope="session")
def business_id() -> str:
    """The Aiweon business_id seeded into local Postgres (see scripts/seed_local.sh)."""
    bid = os.environ.get("BUSINESS_ID", "").strip()
    if not bid:
        pytest.skip("BUSINESS_ID not set — run `bash scripts/seed_local.sh` first")
    return bid


@pytest.fixture
def run_id() -> str:
    """Fresh run_id per test. Cleanup happens via `cleanup_run` fixture."""
    return str(uuid.uuid4())


@pytest.fixture
def cleanup_run(run_id: str):
    """
    Yield the same run_id, then DELETE anything written under it at teardown.
    Use instead of `run_id` when the test writes to approvals/agent_decisions.
    """
    yield run_id
    # teardown — best-effort; test failures must not mask cleanup errors
    from campaigner.lib.db import execute

    try:
        execute("DELETE FROM agent_decisions WHERE run_id = %s", (run_id,))
        execute("DELETE FROM approvals WHERE created_by_run_id = %s", (run_id,))
    except Exception as e:
        print(f"WARN: cleanup failed for run_id={run_id}: {e}", file=sys.stderr)


@pytest.fixture
def invoke_tool() -> Callable[..., subprocess.CompletedProcess]:
    """
    Helper that invokes a tool as a subprocess and captures stdout/stderr.

    Tools are invoked exactly as Claude would invoke them — no in-process
    imports, no mocked argv. This is what the contract promises.
    """

    # Default 120s — Python + DB import warm-up runs 20-30s on Docker-on-Windows
    # cold spawns; with the Phase 1-4 expansion (CustomAudience SDK, lead_fetching
    # httpx, etc.) cold import of `campaigner.lib.meta_client` can hit 45s. The
    # previous 60s default was on the edge after the Phase 3 chain methods landed.
    # Override via CAMPAIGNER_TEST_TIMEOUT_S if you need a deliberately-slow path.
    invoke_timeout = int(os.environ.get("CAMPAIGNER_TEST_TIMEOUT_S", "120"))

    def _invoke(tool_module: str, *cli_args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, "-m", f"campaigner.tools.{tool_module}", *cli_args],
            capture_output=True,
            text=True,
            cwd=str(REPO_ROOT),
            env={**os.environ, "PYTHONPATH": str(REPO_ROOT)},
            timeout=invoke_timeout,
        )

    return _invoke
