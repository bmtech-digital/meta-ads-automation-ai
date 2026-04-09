"""
Image generation module using Vertex AI Imagen
"""
import os
from typing import Optional, Literal
from google import genai
from google.genai.types import GenerateImagesConfig


class ImageGenerator:
    """Generate images using Vertex AI Imagen API"""

    ASPECT_RATIOS = ("1:1", "3:4", "4:3", "9:16", "16:9")
    MODELS = {
        "fast": "imagen-3.0-fast-generate-001",
        "standard": "imagen-3.0-generate-002",
        "ultra": "imagen-4.0-ultra-generate-001",
    }

    def __init__(
        self,
        project_id: Optional[str] = None,
        location: Optional[str] = None,
        model_tier: Literal["fast", "standard", "ultra"] = "fast",
    ):
        self.project_id = project_id or os.getenv("GCP_PROJECT_ID", "bemtech-478413")
        self.location = location or os.getenv("GCP_LOCATION", "us-central1")
        self.model = self.MODELS[model_tier]

        self.client = genai.Client(
            vertexai=True,
            project=self.project_id,
            location=self.location,
        )

    def generate_image(
        self,
        prompt: str,
        aspect_ratio: str = "1:1",
        save_path: Optional[str] = None,
    ) -> dict:
        """
        Generate an image from a text prompt.

        Args:
            prompt: Text description of the desired image (max 4000 chars)
            aspect_ratio: One of 1:1, 3:4, 4:3, 9:16, 16:9
            save_path: Local path to save the image (optional)

        Returns:
            dict with 'local_path', 'model', 'aspect_ratio'
        """
        if len(prompt) > 4000:
            raise ValueError("Prompt too long. Max 4000 characters for Imagen.")

        if aspect_ratio not in self.ASPECT_RATIOS:
            raise ValueError(f"Invalid aspect ratio. Must be one of {self.ASPECT_RATIOS}")

        print(f"Generating image with {self.model}...")
        print(f"Prompt: {prompt[:100]}...")

        response = self.client.models.generate_images(
            model=self.model,
            prompt=prompt,
            config=GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio=aspect_ratio,
                safety_filter_level="block_medium_and_above",
                person_generation="allow_adult",
            ),
        )

        if not response.generated_images:
            raise RuntimeError("No image generated — may have been blocked by safety filter.")

        result = {
            "model": self.model,
            "aspect_ratio": aspect_ratio,
        }

        if save_path:
            os.makedirs(os.path.dirname(save_path) or ".", exist_ok=True)
            response.generated_images[0].image.save(save_path)
            result["local_path"] = save_path
            print(f"Image saved: {save_path}")
        else:
            result["image_bytes"] = response.generated_images[0].image.image_bytes

        return result

    def generate_multiple_variations(
        self,
        base_prompt: str,
        variations: list[str],
        **kwargs,
    ) -> list[dict]:
        """
        Generate multiple image variations from a base prompt.

        Args:
            base_prompt: Base prompt text
            variations: List of suffixes to append to the base prompt
            **kwargs: Additional args passed to generate_image

        Returns:
            List of result dicts, one per variation
        """
        results = []
        for i, variation in enumerate(variations, 1):
            full_prompt = f"{base_prompt}. {variation}"
            print(f"\nGenerating variation {i}/{len(variations)}")
            result = self.generate_image(prompt=full_prompt, **kwargs)
            results.append({"variation": variation, **result})
        return results


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    generator = ImageGenerator()

    result = generator.generate_image(
        prompt="Professional digital marketing agency workspace, modern and sleek, "
               "AI-powered dashboards on screens, clean design",
        aspect_ratio="1:1",
        save_path="./generated_images/test_aiweon.png",
    )

    print(f"\nResult: {result}")
