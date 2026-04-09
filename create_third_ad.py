"""
Create a single ad — useful for testing after token renewal.
"""
import sys
import os

from dotenv import load_dotenv
from image_generator import ImageGenerator
from meta_ads_manager import MetaAdsManager

load_dotenv()

print("\n" + "=" * 60)
print("CREATING SINGLE TEST AD")
print("=" * 60)

print("\n[1/4] Initializing APIs...")
image_gen = ImageGenerator()
meta_manager = MetaAdsManager()
print("      [OK] APIs initialized.")

print("\n[2/4] Generating image...")
os.makedirs("./generated_images", exist_ok=True)
image = image_gen.generate_image(
    prompt=(
        "Modern AI-powered marketing analytics, abstract data visualization, "
        "clean professional design, blue tones"
    ),
    save_path="./generated_images/test_single.png",
)
print(f"      [OK] Image: {image['local_path']}")

print("\n[3/4] Creating Meta ad...")
result = meta_manager.create_complete_ad(
    campaign_name="Aiweon - Single Test",
    ad_name="Aiweon Test Ad",
    image_path=image['local_path'],
    title="AI Marketing by Aiweon",
    body="Smart marketing. Real results. Try Aiweon today.",
    link_url="https://aiweon.com",
    daily_budget=3000,  # 30 ILS/day
    targeting={
        'geo_locations': {'countries': ['IL']},
        'age_min': 25,
        'age_max': 50,
    },
)

print("\n[4/4] Done!")
print("=" * 60)
print(f"Campaign ID: {result['campaign_id']}")
print(f"Ad ID: {result['ad_id']}")
print("\nMeta Ads Manager: https://business.facebook.com/adsmanager")
print("=" * 60)
