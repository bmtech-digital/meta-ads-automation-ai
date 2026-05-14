"""
Run Aiweon ad automation — generates images and creates Meta ads.
All ads are created PAUSED. Activate manually in Meta Ads Manager.
"""

import os
import sys

from dotenv import load_dotenv

from image_generator import ImageGenerator
from meta_ads_manager import MetaAdsManager

load_dotenv()

print("\n" + "=" * 60)
print("AIWEON AD AUTOMATION")
print("=" * 60)

try:
    # Initialize
    print("\n[1/4] Initializing APIs...")
    image_gen = ImageGenerator()
    meta_manager = MetaAdsManager()
    print("      [OK] APIs initialized.")

    # Ad 1: Agency services
    print("\n[2/4] Creating Ad 1: AI Marketing Agency")
    print("-" * 60)

    print("      Generating image...")
    os.makedirs("./generated_images", exist_ok=True)

    image1 = image_gen.generate_image(
        prompt=(
            "Professional AI-powered marketing dashboard showing analytics, "
            "growth charts, and campaign performance, modern clean design, "
            "blue and white color scheme, tech startup aesthetic"
        ),
        save_path="./generated_images/aiweon_agency.png",
    )
    print(f"      [OK] Image: {image1['local_path']}")

    print("      Creating Meta ad...")
    ad1 = meta_manager.create_complete_ad(
        campaign_name="Aiweon - AI Marketing Agency",
        ad_name="Aiweon Agency Services",
        image_path="./generated_images/aiweon_agency.png",
        title="AI-Powered Digital Marketing",
        body=(
            "Stop guessing. Start growing. "
            "Aiweon's AI-driven marketing delivers measurable results for your business."
        ),
        link_url="https://aiweon.com",
        daily_budget_usd=14,  # ~50 ILS/day
        targeting={
            "geo_locations": {"countries": ["IL"]},
            "age_min": 28,
            "age_max": 55,
        },
    )

    print("      [OK] Ad 1 created!")
    print(f"      Campaign ID: {ad1['campaign_id']}")
    print(f"      Ad ID: {ad1['ad_id']}")

    # Ad 2: SaaS platform
    print("\n[3/4] Creating Ad 2: SaaS Platform")
    print("-" * 60)

    print("      Generating image...")
    image2 = image_gen.generate_image(
        prompt=(
            "SaaS platform interface showing automated marketing workflows, "
            "drag-and-drop campaign builder, modern UI, "
            "futuristic and professional, purple and blue gradients"
        ),
        save_path="./generated_images/aiweon_saas.png",
    )
    print(f"      [OK] Image: {image2['local_path']}")

    print("      Creating Meta ad...")
    ad2 = meta_manager.create_complete_ad(
        campaign_name="Aiweon - SaaS Platform Launch",
        ad_name="Aiweon SaaS Platform",
        image_path="./generated_images/aiweon_saas.png",
        title="Marketing Automation, Simplified",
        body=(
            "One platform. Endless possibilities. "
            "Automate your campaigns, optimize with AI, and scale your growth."
        ),
        link_url="https://aiweon.com",
        daily_budget_usd=14,  # ~50 ILS/day
        targeting={
            "geo_locations": {"countries": ["IL"]},
            "age_min": 25,
            "age_max": 50,
        },
    )

    print("      [OK] Ad 2 created!")
    print(f"      Campaign ID: {ad2['campaign_id']}")
    print(f"      Ad ID: {ad2['ad_id']}")

    # Summary
    print("\n[4/4] Summary")
    print("=" * 60)
    print("All ads created successfully!")
    print("=" * 60)
    print("\nAds created: 2")
    print("Images generated: 2")
    print("Campaigns created: 2")
    print("\nImages: ./generated_images/")
    print("\nStatus: PAUSED (activate manually in Ads Manager)")
    print("\nMeta Ads Manager: https://business.facebook.com/adsmanager")
    print("\n" + "=" * 60)

except Exception as e:
    print(f"\n[ERROR] Automation failed: {str(e)}")
    import traceback

    traceback.print_exc()
    sys.exit(1)
