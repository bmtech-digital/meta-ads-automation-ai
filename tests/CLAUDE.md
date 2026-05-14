# Claude-at-`tests/` — testing strategy

> Loaded automatically when cwd is here. Active alongside [root CLAUDE.md](../CLAUDE.md).

## What this folder is

The Python test suite. **Two layers**, distinct on purpose:

| Layer | Folder | What it tests | Hits real services? |
|---|---|---|---|
| Contract | [`tools/`](tools/) | Each `campaigner.tools.*` CLI obeys the I/O contract: argparse exposes `--help`, exits with documented codes, returns JSON on success, errors on stderr. | No — runs `python -m` and asserts on stdout/exit code |
| Golden | [`golden/`](golden/) | The full diagnose-and-propose decision logic against frozen scenario JSONs. Replays a Meta-state fixture and asserts expected `(label, action, guardrail outcomes)`. | No — pure offline replay |

The frontend has its own unit + e2e tests under [`../web/`](../web/) (Vitest + Playwright); see [`../web/CLAUDE.md`](../web/CLAUDE.md). They don't run from this folder.

## How to run

Per the [project Docker rule](../CLAUDE.md):

```bash
# All Python tests
docker compose run --rm campaigner bash scripts/test.sh

# Just one layer
docker compose run --rm campaigner python -m pytest tests/golden/ -v
docker compose run --rm campaigner python -m pytest tests/tools/ -v

# One scenario
docker compose run --rm campaigner python -m pytest tests/golden/ -v -k "02_winner"
```

[`scripts/test.sh`](../scripts/test.sh) is what CI runs. Don't bypass it locally just because pytest works on the host — Python paths, env vars, and DB URLs differ.

## Golden tests — the philosophy

Files under [`golden/`](golden/) are JSON scenarios named `<NN>_<short-name>.json`. Each is a frozen Meta state + the expected diagnosis label and proposed actions. Read [`golden/README.md`](golden/README.md) for the full contract.

Why this matters:
- **A golden test is a documented case.** "What does the agent do when CPL spikes 3x in 24h?" → look at `10_cpl_spike.json`.
- **Adding a scenario is cheap; debugging a regression without one is expensive.** When you fix a wrong proposal in production, write the golden first.
- **Renumbering breaks history.** Append new scenarios as `14_*`, `15_*`. Don't reorder.
- **`13_deprecated_rule_canary.json`** is intentional — it asserts that deprecated pre-Andromeda rules (CAMPAIGN_EVALUATION.md §8) do NOT trigger. If this test starts failing, someone reintroduced a banned rule.

## Tool contract tests

[`tools/test_contract.py`](tools/test_contract.py) iterates every tool and asserts:

- `--help` exits 0 and prints argparse output.
- Bad args produce exit code 2 with `error: validation_error` JSON.
- Output is single-line JSON (or pretty-printed JSON; either is fine, but it must parse).

When you add a tool to [`../campaigner/tools/`](../campaigner/tools/), the contract test should pick it up via the registry list at the top of `test_contract.py`. Update that list.

## conftest

[`conftest.py`](conftest.py) wires the test DB connection (separate schema or test database — never the dev one). Pytest fixtures live there, not scattered.

Rule: tests must not require a live Meta or Vertex API. Use the offline JSON fixtures or mock at the `lib/` boundary.

## What's NOT in this folder

- **Frontend tests** → [`../web/e2e/`](../web/e2e/) (Playwright), [`../web/src/lib/**/*.test.ts`](../web/src/lib/) (Vitest)
- **Integration tests against real Meta** — they don't exist. Real Meta is exercised by the production runners with the `paused` defaults; live verification is via Meta Ads Manager UI, not pytest.
- **Schema-shape tests** — those are implicit in `migrate.sh` succeeding against a clean DB.

## Where truth lives

| Question | Read |
|---|---|
| Golden scenario format | [`golden/README.md`](golden/README.md) |
| What a tool's contract is | [`../campaigner/tools/_contract.py`](../campaigner/tools/_contract.py) |
| What metric thresholds drive golden labels | [`../docs/CAMPAIGN_EVALUATION.md`](../docs/CAMPAIGN_EVALUATION.md) §6 |
| CI test command | [`../scripts/test.sh`](../scripts/test.sh) |
