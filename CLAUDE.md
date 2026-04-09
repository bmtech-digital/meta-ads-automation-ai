# CLAUDE.md

## Overview

**Campaigner** is a Meta Ads automation tool for **Aiweon** — an AI-based digital marketing agency and SaaS platform in Israel. It generates ad images with Vertex AI Imagen and creates paid ad campaigns on Meta (Facebook/Instagram) via the Marketing API.

Forked from `sandhere01/meta-ads-automation-ai`. This is a **bemtech client project**.

## What This Project Does

- Generates ad images using **Vertex AI Imagen** (`image_generator.py`)
- Creates full Meta Ads funnels: **Campaign -> Ad Set -> Creative -> Ad** (`meta_ads_manager.py`)
- Orchestrates end-to-end automation: image generation + ad publishing (`automation_main.py`)
- All ads are created in **PAUSED** status by default
- Ads are published under the configured Facebook Page (`META_PAGE_ID`)
- Target market: **Israel** (USD currency, `countries: ['IL']`)

## Ad Accounts

| Account | ID | Purpose |
|---------|-----|---------|
| Bemtech (professional) | `act_1390480923117690` | Production — real client campaigns |
| Ro'ee Halamish (personal) | `act_202495959` | Testing and development |

## Architecture

| File | Role |
|------|------|
| `meta_ads_manager.py` | Core — `MetaAdsManager` class wrapping the `facebook-business` SDK |
| `image_generator.py` | `ImageGenerator` class wrapping Vertex AI Imagen (`google-genai`) |
| `automation_main.py` | `AdAutomation` class combining both for end-to-end flows |
| `run_automation.py` | Main runner — creates 2 Aiweon ads (agency + SaaS) |
| `create_simple_ad.py` | Minimal ad creation with page-less fallback |
| `create_remaining_ads.py` | Batch creation with retry logic |
| `example_real_estate.py` | Example: agency + SaaS campaigns |
| `create_third_ad.py` | Single ad creation (useful after token renewal) |
| `test_credentials.py` | Tests GCP and Meta credentials |
| `diagnose_page_permissions.py` | Meta Page permission diagnostics |

## Tech Stack

- **Python 3.8+**
- `google-genai` (Vertex AI Imagen for image generation)
- `facebook-business` (Meta Marketing API SDK)
- `python-dotenv` (env config)
- `requests` + `pillow` (image handling)

## Setup & Configuration

### GCP Authentication

Imagen uses GCP credentials (not API keys):

```bash
gcloud auth application-default login
```

The GCP project defaults to `bemtech-478413`.

### Environment Variables (`.env`)

```
GCP_PROJECT_ID=bemtech-478413       # Defaults to bemtech-478413
GCP_LOCATION=us-central1            # Defaults to us-central1
META_APP_ID=...
META_APP_SECRET=...
META_ACCESS_TOKEN=...               # Expires ~60 days, manual rotation
META_AD_ACCOUNT_ID=act_...          # Must include act_ prefix
META_PAGE_ID=...                    # Facebook Page that publishes ads
```

### Install Dependencies

```bash
pip install -r requirements.txt
```

### Validate Setup

```bash
python test_credentials.py
python diagnose_page_permissions.py
```

## Running

```bash
python run_automation.py          # Create 2 Aiweon ads (PAUSED)
python automation_main.py         # Full automation example
python create_simple_ad.py        # Single ad, minimal setup
python create_third_ad.py         # Quick single ad test
```

## Imagen Model Tiers

| Tier | Model | Cost/Image | RPM |
|------|-------|-----------|-----|
| `fast` (default) | `imagen-3.0-fast-generate-001` | $0.02 | 200 |
| `standard` | `imagen-3.0-generate-002` | $0.04 | 20 |
| `ultra` | `imagen-4.0-ultra-generate-001` | $0.06 | — |

Change tier: `ImageGenerator(model_tier="standard")`

## Safety Notes

- **Real API calls**: Scripts create real objects in Meta Ads Manager and cost money (Imagen generation)
- **PAUSED by default**: Ads won't spend until manually activated
- **Token expiry**: `META_ACCESS_TOKEN` expires ~60 days, no auto-refresh
- **Budget units**: `daily_budget` is in **cents** (e.g., `5000` = $50/day)
- **No cleanup**: No delete scripts — manage via Meta Ads Manager UI
- **Meta App must be in Live Mode** to publish ads to real audiences

## Original Upstream

- Fork of: `sandhere01/meta-ads-automation-ai`
- Original was Brazilian real estate focused, in Portuguese
- Rewritten for Aiweon (Israel, English, Vertex AI Imagen)
