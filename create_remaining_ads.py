"""
Batch ad creation with retry logic for transient Meta API errors.
"""
import sys
import os
import time

from dotenv import load_dotenv
from image_generator import ImageGenerator
from meta_ads_manager import MetaAdsManager

load_dotenv()

print("\n" + "=" * 60)
print("CREATING BATCH ADS WITH RETRY")
print("=" * 60)

print("\n[1/3] Initializing APIs...")
image_gen = ImageGenerator()
meta_manager = MetaAdsManager()
print("      [OK] APIs initialized.")


def create_ad_with_retry(ad_config, max_retries=3):
    """Create an ad with retry logic for transient errors."""
    for attempt in range(1, max_retries + 1):
        try:
            print(f"\n[Attempt {attempt}/{max_retries}]")

            print("      Generating image...")
            image = image_gen.generate_image(
                prompt=ad_config['prompt'],
                save_path=ad_config['image_path'],
            )
            print(f"      [OK] Image: {image['local_path']}")

            print("      Creating Meta ad...")
            result = meta_manager.create_complete_ad(
                campaign_name=ad_config['campaign_name'],
                ad_name=ad_config['ad_name'],
                image_path=image['local_path'],
                title=ad_config['title'],
                body=ad_config['body'],
                link_url=ad_config['link_url'],
                daily_budget=ad_config['daily_budget'],
                targeting=ad_config['targeting'],
                special_ad_categories=ad_config.get('special_ad_categories'),
            )

            print(f"      [OK] Ad created!")
            print(f"      Campaign ID: {result['campaign_id']}")
            print(f"      Ad ID: {result['ad_id']}")
            return result

        except Exception as e:
            error_msg = str(e)

            if '"is_transient": true' in error_msg or 'code": 2' in error_msg:
                if attempt < max_retries:
                    wait_time = attempt * 5
                    print(f"      [WARN] Transient Meta API error")
                    print(f"      Waiting {wait_time}s before retry...")
                    time.sleep(wait_time)
                    continue
                else:
                    print(f"      [ERROR] Failed after {max_retries} attempts")
                    raise
            else:
                print(f"      [ERROR] {error_msg}")
                raise

    raise Exception("Max retries exceeded")


ads_config = [
    {
        'name': 'Ad: Agency Services',
        'campaign_name': 'Aiweon - Agency Services',
        'ad_name': 'Aiweon Agency',
        'image_path': './generated_images/agency_services.png',
        'prompt': (
            'Professional digital marketing team working with AI tools, '
            'modern office, data dashboards, collaborative atmosphere'
        ),
        'title': 'AI Marketing That Works',
        'body': 'Data-driven campaigns. AI-optimized results. Grow with Aiweon.',
        'link_url': 'https://aiweon.com',
        'daily_budget': 5000,  # 50 ILS/day
        'targeting': {
            'geo_locations': {'countries': ['IL']},
            'age_min': 28,
            'age_max': 55,
        },
    },
    {
        'name': 'Ad: SaaS Platform',
        'campaign_name': 'Aiweon - SaaS Platform',
        'ad_name': 'Aiweon SaaS',
        'image_path': './generated_images/saas_platform.png',
        'prompt': (
            'Marketing automation platform UI, clean dashboard design, '
            'workflow builder, campaign analytics, modern SaaS product'
        ),
        'title': 'Your Marketing, On Autopilot',
        'body': 'Automate campaigns, optimize spend, and scale — all with AI.',
        'link_url': 'https://aiweon.com',
        'daily_budget': 5000,  # 50 ILS/day
        'targeting': {
            'geo_locations': {'countries': ['IL']},
            'age_min': 25,
            'age_max': 50,
        },
    },
]

results = []
failed = []

for i, config in enumerate(ads_config, start=1):
    print(f"\n[{i + 1}/3] Creating {config['name']}")
    print("-" * 60)

    try:
        result = create_ad_with_retry(config)
        results.append(result)
    except Exception as e:
        print(f"\n[ERROR] Failed: {config['name']}: {e}")
        failed.append(config['name'])

print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)

print(f"\nAds created: {len(results)}")
print(f"Ads failed: {len(failed)}")

if results:
    print("\nCreated:")
    for i, result in enumerate(results, start=1):
        print(f"\n  Ad {i}:")
        print(f"    Campaign ID: {result['campaign_id']}")
        print(f"    Ad ID: {result['ad_id']}")

if failed:
    print("\nFailed:")
    for name in failed:
        print(f"  - {name}")

print("\nMeta Ads Manager: https://business.facebook.com/adsmanager")
print("=" * 60)
