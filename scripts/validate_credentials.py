"""Validate that all external credentials for Phase 1 dev work end-to-end.

Supersedes the legacy `test_credentials.py` (fork artifact). Adds Anthropic
coverage, GCP auth coverage, and a consistent pass/fail exit status.

Checks:
  1. ANTHROPIC_API_KEY present and Claude Code CLI responds (uses `claude -p`
     in the container — the exact entrypoint the agent will use in prod).
  2. GCP Application Default Credentials mounted and Vertex AI client inits
     against GCP_PROJECT_ID + GCP_LOCATION. (No Imagen generation by default —
     pass --with-imagen to actually generate one image (~$0.02 on fast tier).)
  3. Meta access token valid — reads ad account name + status via Marketing API.

Usage:
  docker compose run --rm campaigner python scripts/validate_credentials.py
  docker compose run --rm campaigner python scripts/validate_credentials.py --with-imagen

Exits 0 on full pass, 1 on any failure. Each check prints a masked value of the
credential it's using so you can see wiring without exposing secrets.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _ok(msg: str) -> None:
    print(f"  \u2713 {msg}")


def _fail(msg: str) -> None:
    print(f"  \u2717 {msg}", file=sys.stderr)


def _skip(msg: str) -> None:
    print(f"  - {msg}")


def _mask(value: str | None, *, keep: int = 6) -> str:
    if not value:
        return "(unset)"
    if len(value) <= keep * 2:
        return "***"
    return f"{value[:keep]}...{value[-keep:]}"


def check_anthropic() -> bool:
    print("[1/3] Anthropic — Claude Code CLI (headless)")
    key = os.getenv("ANTHROPIC_API_KEY")
    print(f"      ANTHROPIC_API_KEY = {_mask(key)}")
    if not key or key.startswith("sk-ant-your"):
        _fail("ANTHROPIC_API_KEY is unset or placeholder")
        return False

    try:
        result = subprocess.run(
            ["claude", "-p", "Reply with the single word OK.", "--output-format", "text"],
            capture_output=True,
            text=True,
            timeout=60,
            env={**os.environ, "ANTHROPIC_API_KEY": key},
        )
    except FileNotFoundError:
        _fail(
            "`claude` CLI not found on PATH. Dockerfile installs @anthropic-ai/claude-code; rebuild image."
        )
        return False
    except subprocess.TimeoutExpired:
        _fail("`claude -p` timed out after 60s")
        return False

    if result.returncode != 0:
        _fail(f"`claude -p` exited {result.returncode}")
        if result.stderr:
            print(f"      stderr: {result.stderr.strip()[:300]}", file=sys.stderr)
        return False

    output = result.stdout.strip()
    if not output:
        _fail("`claude -p` returned empty output")
        return False
    _ok(f"Claude Code responded: {output[:80]}")
    return True


def check_gcp(with_imagen: bool) -> bool:
    print("[2/3] GCP — Vertex AI (Imagen)")
    project = os.getenv("GCP_PROJECT_ID", "bemtech-478413")
    location = os.getenv("GCP_LOCATION", "us-central1")
    creds_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    print(f"      GCP_PROJECT_ID = {project}")
    print(f"      GCP_LOCATION   = {location}")
    print(f"      ADC file       = {creds_path or '(unset)'}")

    if creds_path and not Path(creds_path).exists():
        _fail(f"GOOGLE_APPLICATION_CREDENTIALS points to missing file: {creds_path}")
        print("      Run on host: gcloud auth application-default login", file=sys.stderr)
        return False

    try:
        from google import genai  # type: ignore
    except ImportError:
        _fail("google-genai not installed — check requirements.txt")
        return False

    try:
        client = genai.Client(vertexai=True, project=project, location=location)
    except Exception as e:  # noqa: BLE001
        _fail(f"Vertex AI client init failed: {e}")
        print("      Run on host: gcloud auth application-default login", file=sys.stderr)
        return False

    _ok("Vertex AI client initialized")

    if not with_imagen:
        _skip("skipped live Imagen generation (pass --with-imagen to test, ~$0.02)")
        return True

    try:
        response = client.models.generate_images(
            model="imagen-3.0-fast-generate-001",
            prompt="A simple blue square on white background, for credential test.",
            config={"number_of_images": 1},
        )
        count = len(response.generated_images) if response.generated_images else 0
        if count != 1:
            _fail(f"Imagen returned {count} images (expected 1)")
            return False
        _ok("Imagen generation succeeded (1 image, fast tier)")
        return True
    except Exception as e:  # noqa: BLE001
        _fail(f"Imagen generation failed: {e}")
        return False


def check_meta() -> bool:
    print("[3/3] Meta — Marketing API")
    app_id = os.getenv("META_APP_ID")
    app_secret = os.getenv("META_APP_SECRET")
    token = os.getenv("META_ACCESS_TOKEN")
    account_id = os.getenv("META_AD_ACCOUNT_ID")
    print(f"      META_APP_ID          = {_mask(app_id)}")
    print(f"      META_APP_SECRET      = {_mask(app_secret)}")
    print(f"      META_ACCESS_TOKEN    = {_mask(token)}")
    print(f"      META_AD_ACCOUNT_ID   = {account_id or '(unset)'}")

    for name, value, placeholder_prefix in [
        ("META_APP_ID", app_id, "your-"),
        ("META_APP_SECRET", app_secret, "your-"),
        ("META_ACCESS_TOKEN", token, "your-"),
        ("META_AD_ACCOUNT_ID", account_id, "act_your"),
    ]:
        if not value or value.startswith(placeholder_prefix):
            _fail(f"{name} is unset or placeholder")
            return False

    try:
        from facebook_business.adobjects.adaccount import AdAccount  # type: ignore
        from facebook_business.api import FacebookAdsApi  # type: ignore
    except ImportError:
        _fail("facebook-business not installed — check requirements.txt")
        return False

    try:
        FacebookAdsApi.init(app_id=app_id, app_secret=app_secret, access_token=token)
        account = AdAccount(account_id)
        info = account.api_get(fields=["name", "account_status"])
    except Exception as e:  # noqa: BLE001
        err = str(e)
        # Facebook SDK exceptions often embed the full JSON response — surface it verbatim for debugging.
        _fail("Meta API error:")
        for line in err.splitlines():
            print(f"      {line}", file=sys.stderr)
        body = getattr(e, "body", None) or getattr(e, "_body", None)
        if body:
            print(f"      body: {body}", file=sys.stderr)
        hint = None
        if "Invalid OAuth" in err or "expired" in err.lower() or 'code":190' in err:
            hint = "Token expired/invalid — regenerate at https://developers.facebook.com/tools/explorer/"
        elif 'code":200' in err or "permission" in err.lower():
            hint = "Missing permissions — token needs ads_management, ads_read, business_management, pages_show_list, pages_read_engagement, instagram_basic"
        elif 'code":10' in err or 'code":803' in err or "does not exist" in err.lower():
            hint = f"Ad account {account_id} not visible to this token — check: (a) account ID correct, (b) token's user has access, (c) app is linked to the Business owning the account"
        if hint:
            print(f"      HINT: {hint}", file=sys.stderr)
        return False

    name = info.get("name", "?")
    status = info.get("account_status", "?")
    _ok(f"Meta API connected — account '{name}' (status {status})")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--with-imagen",
        action="store_true",
        help="actually generate a test image (~$0.02); default skips generation",
    )
    args = parser.parse_args()

    print("Campaigner credentials check")
    print("=" * 60)
    results = {
        "anthropic": check_anthropic(),
        "gcp": check_gcp(args.with_imagen),
        "meta": check_meta(),
    }
    print("=" * 60)

    passed = sum(1 for v in results.values() if v)
    total = len(results)
    if passed == total:
        print(f"\u2713 All {total} checks passed.")
        return 0

    print(f"\u2717 {passed}/{total} passed.", file=sys.stderr)
    for name, ok in results.items():
        if not ok:
            print(f"   FAIL: {name}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
