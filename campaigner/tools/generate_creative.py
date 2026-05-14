"""
tools/generate_creative.py — generate one or more image creatives via Vertex Imagen.

Used by Flow C (firehose). Saves generated images to disk AND records a row
in `creative_gallery` with `uploaded_to_meta_at=NULL` (upload happens later via
Flow B when a `new_creative` approval is approved).

Copy generation (headline / primary_text / cta) is NOT done here — that's
the agent's job via its LLM reasoning, passed in via --copy JSON. This tool
just produces the image asset.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.creative import CreativeClient
from campaigner.lib.db import get_connection
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    parse_json_arg,
    with_db_retry,
)

VALID_ANGLES = ("emotion", "urgency", "benefit", "social_proof", "comparison", "list")
VALID_ASPECTS = ("1:1", "3:4", "4:3", "9:16", "16:9")
VALID_PLACEMENTS = ("feed", "stories", "right_column", "reels")


_ASPECT_DIMENSIONS = {
    "1:1": (1080, 1080),
    "4:5": (1080, 1350),
    "9:16": (1080, 1920),
    "3:4": (1080, 1440),
    "4:3": (1440, 1080),
    "16:9": (1920, 1080),
}


def _dims(ar: str) -> tuple[int, int]:
    return _ASPECT_DIMENSIONS.get(ar, (1080, 1080))


def main() -> None:
    p = argparse.ArgumentParser(
        description="Generate an image creative and record it in the gallery."
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--prompt",
        required=True,
        help="base image prompt (English or Hebrew — Vertex handles both)",
    )
    p.add_argument("--aspect-ratio", default="1:1", choices=VALID_ASPECTS)
    p.add_argument(
        "--angle",
        choices=VALID_ANGLES,
        default=None,
        help="marketing angle tag for the gallery row",
    )
    p.add_argument("--placement", choices=VALID_PLACEMENTS, default="feed")
    p.add_argument(
        "--copy",
        default=None,
        help="JSON object with headline, primary_text, cta — recorded alongside the image",
    )
    p.add_argument("--model-tier", choices=("fast", "standard", "ultra"), default="fast")
    p.add_argument(
        "--output-dir",
        default="./generated_images",
        help="local filesystem dir to write the image to",
    )
    args = p.parse_args()

    copy = parse_json_arg(args.copy, "copy")
    if copy is not None and not isinstance(copy, dict):
        emit_validation_error("--copy must be a JSON object")
        return

    try:
        cfg = Config.load()
        cfg.require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    # Filename includes angle + aspect_ratio so gallery + disk correlate visually.
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_angle = args.angle or "untagged"
    safe_ar = args.aspect_ratio.replace(":", "x")
    filename = f"{args.business_id[:8]}_{safe_angle}_{safe_ar}_{os.urandom(4).hex()}.png"
    save_path = str(output_dir / filename)

    try:
        client = CreativeClient(cfg, model_tier=args.model_tier)
        result = client.generate_image(
            prompt=args.prompt,
            aspect_ratio=args.aspect_ratio,
            save_path=save_path,
        )
    except Exception as e:
        emit_runtime_error(f"image generation failed: {e}", exc=e)
        return

    width, height = _dims(args.aspect_ratio)
    dimensions = f"{width}x{height}"

    headline = (copy or {}).get("headline")
    primary_text = (copy or {}).get("primary_text")
    cta = (copy or {}).get("cta")

    def _insert() -> dict:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO creative_gallery (
                    business_id, kind,
                    storage_url, aspect_ratio, dimensions,
                    headline, primary_text, cta,
                    generated_by, generation_prompt, marketing_angle, placement
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, created_at
                """,
                (
                    args.business_id,
                    "image",
                    save_path,
                    args.aspect_ratio,
                    dimensions,
                    headline,
                    primary_text,
                    cta,
                    "imagen",
                    args.prompt,
                    args.angle,
                    args.placement,
                ),
            )
            return cur.fetchone()

    try:
        row = with_db_retry(_insert)
    except Exception as e:
        emit_runtime_error(
            f"creative_gallery insert failed: {e}. Image saved at {save_path}", exc=e
        )
        return

    emit_success(
        {
            "gallery_id": str(row["id"]),
            "business_id": args.business_id,
            "local_path": save_path,
            "aspect_ratio": args.aspect_ratio,
            "dimensions": dimensions,
            "angle": args.angle,
            "placement": args.placement,
            "model": result.get("model"),
            "copy_provided": copy is not None,
        }
    )


if __name__ == "__main__":
    main()
