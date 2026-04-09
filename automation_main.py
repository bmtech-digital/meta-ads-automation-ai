"""
Main automation: AI image generation + Meta ad publishing for Aiweon.
"""
import os
import json
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv

from image_generator import ImageGenerator
from meta_ads_manager import MetaAdsManager


DEFAULT_TARGETING = {
    'geo_locations': {'countries': ['IL']},
    'age_min': 25,
    'age_max': 55,
}


class AdAutomation:
    """End-to-end ad automation: generate image with Imagen, publish via Meta Ads."""

    def __init__(self):
        load_dotenv()

        print("Initializing Ad Automation")
        print("=" * 60)

        self.image_generator = ImageGenerator()
        self.meta_manager = MetaAdsManager()

        print("Automation ready.")
        print("=" * 60 + "\n")

    def create_ad_with_ai_image(
        self,
        # Image params
        image_prompt: str,
        image_aspect_ratio: str = "1:1",

        # Ad params
        campaign_name: Optional[str] = None,
        ad_title: Optional[str] = None,
        ad_body: Optional[str] = None,
        link_url: Optional[str] = None,
        daily_budget_usd: float = 14,

        # Targeting
        targeting: Optional[dict] = None,

        # Additional
        objective: str = "OUTCOME_TRAFFIC",
        call_to_action: str = "LEARN_MORE",
        special_ad_categories: Optional[list] = None,
    ) -> dict:
        """
        Create a complete ad: generate image with AI then publish to Meta.

        Args:
            image_prompt: Text description for Imagen
            image_aspect_ratio: Aspect ratio for the image
            campaign_name: Campaign name (auto-generated if None)
            ad_title: Ad headline
            ad_body: Ad body text
            link_url: Destination URL
            daily_budget_usd: Daily budget in USD (converted to ILS via live rate)
            targeting: Audience targeting dict
            objective: Campaign objective
            call_to_action: CTA type
            special_ad_categories: Special categories (e.g. ['HOUSING'])

        Returns:
            Dict with image info and Meta ad IDs
        """
        print("\n" + "=" * 60)
        print("STARTING FULL AUTOMATION")
        print("=" * 60)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        # 1. Generate image
        print("\n[1/2] Generating image with AI")
        print("-" * 60)

        os.makedirs("./generated_images", exist_ok=True)
        image_path = f"./generated_images/ad_image_{timestamp}.png"

        image_result = self.image_generator.generate_image(
            prompt=image_prompt,
            aspect_ratio=image_aspect_ratio,
            save_path=image_path,
        )

        print(f"Image saved: {image_path}")

        # 2. Publish to Meta
        print("\n[2/2] Publishing ad to Meta")
        print("-" * 60)

        targeting = targeting or DEFAULT_TARGETING
        campaign_name = campaign_name or f"Aiweon Campaign {timestamp}"
        ad_title = ad_title or "AI-Powered Marketing by Aiweon"
        ad_body = ad_body or "Transform your business with AI-driven marketing."
        link_url = link_url or "https://aiweon.com"

        meta_result = self.meta_manager.create_complete_ad(
            campaign_name=campaign_name,
            ad_name=f"Ad_{timestamp}",
            image_path=image_path,
            title=ad_title,
            body=ad_body,
            link_url=link_url,
            daily_budget_usd=daily_budget_usd,
            targeting=targeting,
            objective=objective,
            call_to_action=call_to_action,
            special_ad_categories=special_ad_categories,
        )

        # 3. Compile results
        final_result = {
            'success': True,
            'timestamp': timestamp,
            'image': {
                'local_path': image_path,
                'model': image_result['model'],
                'aspect_ratio': image_result['aspect_ratio'],
            },
            'meta_ad': {
                'campaign_id': meta_result['campaign_id'],
                'ad_set_id': meta_result['ad_set_id'],
                'creative_id': meta_result['creative_id'],
                'ad_id': meta_result['ad_id'],
                'campaign_name': campaign_name,
                'title': ad_title,
                'body': ad_body,
                'link': link_url,
                'daily_budget_usd': daily_budget_usd,
            },
        }

        # Save log
        os.makedirs("./logs", exist_ok=True)
        log_path = f"./logs/automation_log_{timestamp}.json"
        with open(log_path, 'w', encoding='utf-8') as f:
            json.dump(final_result, f, indent=2, ensure_ascii=False)

        print("\n" + "=" * 60)
        print("AUTOMATION COMPLETE")
        print("=" * 60)
        print(f"Log: {log_path}")
        print(f"Image: {image_path}")
        print(f"Campaign ID: {meta_result['campaign_id']}")
        print(f"Ad ID: {meta_result['ad_id']}")
        print("=" * 60 + "\n")

        return final_result

    def create_multiple_ads(self, ads_config: list[dict]) -> list[dict]:
        """Create multiple ads in batch."""
        print(f"\nCreating {len(ads_config)} ads in batch...")

        results = []
        for i, config in enumerate(ads_config, 1):
            print(f"\n{'='*60}")
            print(f"Ad {i}/{len(ads_config)}")
            print(f"{'='*60}")

            try:
                result = self.create_ad_with_ai_image(**config)
            except Exception as e:
                result = {'success': False, 'error': str(e)}
            results.append(result)

        successful = sum(1 for r in results if r.get('success'))
        print(f"\nDone: {successful}/{len(ads_config)} ads created successfully.")

        return results


if __name__ == "__main__":
    automation = AdAutomation()

    # Example: Single Aiweon ad
    result = automation.create_ad_with_ai_image(
        image_prompt=(
            "Professional AI marketing dashboard, futuristic analytics interface, "
            "clean modern design, data visualizations, blue and white color scheme"
        ),
        campaign_name="Aiweon - AI Marketing Platform",
        ad_title="Supercharge Your Marketing with AI",
        ad_body=(
            "Aiweon uses cutting-edge AI to optimize your digital marketing. "
            "More leads, lower costs, better results."
        ),
        link_url="https://aiweon.com",
        daily_budget_usd=14,  # ~50 ILS/day
        targeting={
            'geo_locations': {'countries': ['IL']},
            'age_min': 25,
            'age_max': 55,
        },
    )

    print(f"\nResult: {json.dumps(result, indent=2, ensure_ascii=False)}")
