"""
Simple ad creation — minimal setup, uses MetaAdsManager directly.
"""

import os

from dotenv import load_dotenv
from facebook_business.adobjects.ad import Ad
from facebook_business.adobjects.adaccount import AdAccount
from facebook_business.adobjects.adimage import AdImage
from facebook_business.adobjects.adset import AdSet
from facebook_business.adobjects.campaign import Campaign
from facebook_business.api import FacebookAdsApi

from image_generator import ImageGenerator

load_dotenv()

print("\nCREATING SIMPLE AD")
print("=" * 60)

# Initialize
print("\n[1/4] Initializing...")
image_gen = ImageGenerator()

FacebookAdsApi.init(
    app_id=os.getenv("META_APP_ID"),
    app_secret=os.getenv("META_APP_SECRET"),
    access_token=os.getenv("META_ACCESS_TOKEN"),
)
ad_account = AdAccount(os.getenv("META_AD_ACCOUNT_ID"))
print("      [OK] APIs ready.")

# Generate image
print("\n[2/4] Generating image...")
os.makedirs("./generated_images", exist_ok=True)
image = image_gen.generate_image(
    prompt="Professional AI marketing concept, clean modern design, technology",
    save_path="./generated_images/simple_ad.png",
)
print(f"      [OK] Image: {image['local_path']}")

# Upload image
print("\n[3/4] Uploading to Meta...")
ad_image = AdImage(parent_id=ad_account.get_id())
ad_image[AdImage.Field.filename] = "./generated_images/simple_ad.png"
ad_image.remote_create()
image_hash = ad_image[AdImage.Field.hash]
print(f"      [OK] Hash: {image_hash}")

# Create ad structure
print("\n[4/4] Creating ad structure...")
campaign = ad_account.create_campaign(
    params={
        Campaign.Field.name: "Aiweon - Simple Test",
        Campaign.Field.objective: "OUTCOME_TRAFFIC",
        Campaign.Field.status: "PAUSED",
        "is_adset_budget_sharing_enabled": False,
    }
)
print(f"      [OK] Campaign: {campaign.get_id()}")

ad_set = ad_account.create_ad_set(
    params={
        AdSet.Field.name: "Aiweon Test AdSet",
        AdSet.Field.campaign_id: campaign.get_id(),
        AdSet.Field.daily_budget: 5000,  # 50 ILS/day
        AdSet.Field.billing_event: "IMPRESSIONS",
        AdSet.Field.optimization_goal: "LINK_CLICKS",
        AdSet.Field.targeting: {
            "geo_locations": {"countries": ["IL"]},
            "age_min": 25,
            "age_max": 55,
        },
        AdSet.Field.status: "PAUSED",
        AdSet.Field.bid_amount: 500,
    }
)
print(f"      [OK] AdSet: {ad_set.get_id()}")

creative_params = {
    "name": "Aiweon Test Creative",
    "object_story_spec": {
        "page_id": os.getenv("META_PAGE_ID"),
        "link_data": {
            "image_hash": image_hash,
            "link": "https://aiweon.com",
            "message": "AI-powered marketing that delivers real results.",
            "call_to_action": {
                "type": "LEARN_MORE",
                "value": {"link": "https://aiweon.com"},
            },
        },
    },
}

try:
    creative = ad_account.create_ad_creative(params=creative_params)
    print(f"      [OK] Creative: {creative.get_id()}")

    ad = ad_account.create_ad(
        params={
            Ad.Field.name: "Aiweon Test Ad",
            Ad.Field.adset_id: ad_set.get_id(),
            Ad.Field.creative: {"creative_id": creative.get_id()},
            Ad.Field.status: "PAUSED",
        }
    )

    print(f"      [OK] Ad: {ad.get_id()}")
    print("\n" + "=" * 60)
    print("Ad created successfully!")
    print(f"Campaign ID: {campaign.get_id()}")
    print(f"Ad ID: {ad.get_id()}")
    print("\nMeta Ads Manager: https://business.facebook.com/adsmanager")
    print("=" * 60)

except Exception as e:
    print(f"\n[ERROR] {e}")
    print("\nTrying without page_id...")
    creative_params2 = {
        "name": "Aiweon Test Creative 2",
        "object_story_spec": {
            "link_data": {
                "image_hash": image_hash,
                "link": "https://aiweon.com",
                "message": "AI-powered marketing by Aiweon.",
            },
        },
    }

    try:
        creative2 = ad_account.create_ad_creative(params=creative_params2)
        print(f"      [OK] Creative: {creative2.get_id()}")

        ad2 = ad_account.create_ad(
            params={
                Ad.Field.name: "Aiweon Test Ad 2",
                Ad.Field.adset_id: ad_set.get_id(),
                Ad.Field.creative: {"creative_id": creative2.get_id()},
                Ad.Field.status: "PAUSED",
            }
        )

        print(f"      [OK] Ad: {ad2.get_id()}")
        print("\nCreated with fallback format.")
    except Exception as e2:
        print(f"[ERROR] Also failed: {e2}")
