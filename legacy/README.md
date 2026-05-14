# Legacy — pre-rewrite scripts

These files are from the original upstream fork [`sandhere01/meta-ads-automation-ai`](https://github.com/sandhere01/meta-ads-automation-ai), which was a Brazilian-real-estate Meta Ads automation written as one-off scripts. They are kept for **reference only** — the current project uses the [`campaigner/`](../campaigner/) agent and the dual-flow [`runners/`](../runners/).

## What's here

### `scripts/` — one-off Python scripts

| File | What it did |
|---|---|
| `automation_main.py` | Top-level orchestration of the original automation (read brief → generate image → create campaign + ad set + ad). |
| `run_automation.py` | Wrapper that ran `automation_main.py` with hardcoded Aiweon parameters; created two PAUSED ads on each invocation. |
| `create_simple_ad.py` | Minimal ad creation flow (single image, single ad set). |
| `create_third_ad.py` | One-off third-ad helper from the rewrite period. |
| `create_video_ad.py` | One-off video-ad creation. |
| `create_remaining_ads.py` | Iterated over remaining ad briefs after the simple one was working. |
| `example_real_estate.py` | The original Brazilian real-estate example (PT comments). |
| `test_correct_page.py` | One-off Page-permissions verification (superseded by [`scripts/diagnose_page_permissions.py`](../scripts/diagnose_page_permissions.py)). |
| `test_credentials_simple.py` | Smoke-test of Meta + image generation creds (superseded by [`scripts/validate_credentials.py`](../scripts/validate_credentials.py)). |

### Top-level

| File | Purpose |
|---|---|
| `video_analysis.txt`, `video_analysis_v2.txt` | Output of an early Vertex/Imagen video analysis experiment. Not wired to anything. |

## Why kept (not deleted)

- They preserve the upstream attribution chain (this is a fork).
- Two of their imports (`meta_ads_manager.py` and `image_generator.py` at the repo root) are still in active use, wrapped by [`campaigner/lib/meta_client.py`](../campaigner/lib/meta_client.py) and [`campaigner/lib/creative.py`](../campaigner/lib/creative.py). Keeping the legacy callers around documents what those modules look like in their original use.
- A future contributor may want to compare a Meta-side gotcha against what the upstream did; deletion removes that reference.

## Why moved out of root

- Eight one-off scripts at the repo root were noise — they implied "this is how you run the project" when in fact the current entry points are the runners and the CLI.
- `pyproject.toml` excludes this folder from `ruff` so legacy style doesn't block CI.
- The deploy CI ([`../.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)) was updated to no longer trigger an agent rebuild on changes here.

## If you actually need to run a legacy script

They still work — `meta_ads_manager.py` and `image_generator.py` are importable from this folder via the repo root on `PYTHONPATH`:

```bash
docker compose run --rm campaigner python legacy/scripts/run_automation.py
```

But: prefer building what you need into [`campaigner/tools/`](../campaigner/tools/) instead. New code does not import from `legacy/`.

## Related legacy docs

- [`../docs/legacy/upstream-pt/`](../docs/legacy/upstream-pt/) — the original Portuguese setup/troubleshooting docs.
