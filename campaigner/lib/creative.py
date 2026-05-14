"""
Clean facade over the legacy `image_generator.ImageGenerator` (Vertex AI Imagen).

Same pattern as `meta_client.MetaClient`: wraps the legacy class, returns
JSON-safe dicts, and centralizes config loading. Copy generation (LLM) lives
elsewhere — this module is image-only.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Literal

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from image_generator import ImageGenerator  # noqa: E402

from .config import Config  # noqa: E402

ModelTier = Literal["fast", "standard", "ultra"]
AspectRatio = Literal["1:1", "3:4", "4:3", "9:16", "16:9"]


class CreativeClient:
    def __init__(
        self,
        config: Config | None = None,
        model_tier: ModelTier = "fast",
    ):
        self._config = config or Config.load()
        self._model_tier: ModelTier = model_tier
        self._generator: ImageGenerator | None = None

    def _g(self) -> ImageGenerator:
        if self._generator is None:
            self._generator = ImageGenerator(
                project_id=self._config.gcp_project_id,
                location=self._config.gcp_location,
                model_tier=self._model_tier,
            )
        return self._generator

    def generate_image(
        self,
        prompt: str,
        aspect_ratio: AspectRatio = "1:1",
        save_path: str | None = None,
    ) -> dict:
        """
        Generate a single image. If `save_path` is given, the image is written
        to disk and `local_path` is returned; otherwise raw `image_bytes` are
        returned in the result (be mindful of payload size).
        """
        result = self._g().generate_image(
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            save_path=save_path,
        )
        out: dict = {
            "model_tier": self._model_tier,
            "model": result.get("model"),
            "aspect_ratio": result.get("aspect_ratio", aspect_ratio),
        }
        if "local_path" in result:
            out["local_path"] = result["local_path"]
        if "image_bytes" in result:
            out["image_bytes"] = result["image_bytes"]
        return out

    def generate_variations(
        self,
        base_prompt: str,
        variations: list[str],
        aspect_ratio: AspectRatio = "1:1",
        save_dir: str | None = None,
    ) -> list[dict]:
        """Generate one image per variation. If `save_dir`, files are written as `variation_{i}.png`."""
        results: list[dict] = []
        for i, variation in enumerate(variations, 1):
            full_prompt = f"{base_prompt}. {variation}"
            save_path = f"{save_dir.rstrip('/')}/variation_{i}.png" if save_dir else None
            result = self.generate_image(
                prompt=full_prompt,
                aspect_ratio=aspect_ratio,
                save_path=save_path,
            )
            results.append({"variation": variation, **result})
        return results
