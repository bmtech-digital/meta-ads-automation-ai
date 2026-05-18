# Claude-at-`campaigner/lib/` — shared library boundary

> Loaded automatically when cwd is here. Active alongside [root CLAUDE.md](../../CLAUDE.md) and [`../CLAUDE.md`](../CLAUDE.md).

## What this folder is

The shared Python library every tool imports from. **No CLI surface.** No `__main__`. No `argparse`. If you find yourself adding `if __name__ == "__main__"` here — stop. That belongs in [`../tools/`](../tools/) or [`../cli/`](../cli/).

## Direction of dependency (never reverse)

```
runners/*.sh
       │
       ▼
campaigner/cli/        campaigner/tools/
       │                       │
       └──────────┬────────────┘
                  ▼
           campaigner/lib/   ←──── you are here
                  │
                  ▼
       Postgres · Meta API · Vertex · env
```

- `tools/` and `cli/` import from `lib/`. ✅
- `lib/` does **not** import from `tools/` or `cli/`. ❌
- `lib/` modules can import each other but should avoid circular pairs.

## Module map

| File | Purpose | Owns |
|---|---|---|
| [`config.py`](config.py) | Env loading + validation (`Config` dataclass, `ConfigError`). | All env reads. Tools/CLI must not call `os.getenv` directly. |
| [`db.py`](db.py) | Postgres connection + thin helpers (`execute`, `fetch_all`, `fetch_one`). | Connection pooling. Cursor lifecycle. |
| [`meta_client.py`](meta_client.py) | Wraps `facebook-business` SDK. The only place that imports it. | Auth, retries on Meta API errors, mapping our task_types to Meta calls. |
| [`creative.py`](creative.py) | Vertex Imagen client. The only place that imports `google-genai`. | Image generation, model tier selection, GCS upload. |
| [`baselines.py`](baselines.py) | Compute & query baselines from the `baselines` table. | The math behind §6.4 baseline windows. |
| [`seasonal.py`](seasonal.py) | Seasonality hints (Israel/Hebrew calendar). | When a campaign should expect lift / drop windows. |
| [`thresholds.py`](thresholds.py) | **Generated** Python constants for every tunable rule threshold + the `SCHEMA_VERSION` string. Source: [`../../config/thresholds.yaml`](../../config/thresholds.yaml) via [`scripts/generate_from_thresholds.py`](../../scripts/generate_from_thresholds.py). Hand-edits to this file are overwritten by `make generate`. | Consumed by `log_decision.py` for schema-version stamping; available for any future lib/tool code that needs the literal values. |

## Rules

1. **Single SDK ownership.** `facebook-business` is imported only in `meta_client.py`. `google-genai` only in `creative.py`. `psycopg` only in `db.py`. If a tool needs to talk to Meta, it goes through `meta_client.py` — full stop.
2. **No I/O at import time.** Modules are imported many times across tools; opening a DB connection or calling `Config()` at module top is forbidden. Initialize lazily, inside functions.
3. **Errors are typed.** Raise `ConfigError`, `psycopg.OperationalError`, or domain errors. Don't raise bare `Exception`. The tool layer catches and routes through `_contract.emit_*`.
4. **Hebrew strings stay out of `lib/`.** All operator-/customer-facing text is generated in [`../prompts/`](../prompts/) by Claude. `lib/` returns data; it doesn't return phrasing.
5. **No business logic gating in `lib/`.** Two-gate evaluation, guardrails, anti-flood — those are in tools or in prompts. `lib/` answers "what is the data?" not "what should we do?"

## Adding a new module

- Name it for what it owns (`gallery.py`, `tracking.py`), not how it's used (`utils.py`, `helpers.py`).
- If it wraps a third-party SDK, this should be the only file that imports that SDK.
- Add a short module docstring stating the purpose and what callers it's intended for.
- No tests live here — `tests/tools/` covers the tool layer end-to-end. If you want a unit test for a pure function, add `tests/lib/test_<module>.py` and propose the structure first.

## Legacy

The repo root still contains `meta_ads_manager.py` and `image_generator.py` (pre-rewrite scripts). They are reference only. New code goes through `meta_client.py` / `creative.py` here. See [root CLAUDE.md "Existing legacy files"](../../CLAUDE.md#existing-legacy-files-kept-as-reference-wrapped-by-campaignerlib).

## Where truth lives

| Question | Read |
|---|---|
| Schema a `lib/` query reads | [`../../migrations/`](../../migrations/) |
| Meta API method semantics | [Meta Marketing API docs](https://developers.facebook.com/docs/marketing-apis) + the spec for what we use |
| Vertex Imagen tier costs | [root CLAUDE.md "Imagen Model Tiers"](../../CLAUDE.md#imagen-model-tiers) |
| Why `meta_client` looks the way it does | [`../../docs/plans/campaigner-spec.md`](../../docs/plans/campaigner-spec.md) §11.6 |
