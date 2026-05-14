"""
Create a video ad campaign for Aiweon — influencer marketing platform.
Ad is created PAUSED — activate manually in Meta Ads Manager.
"""

import sys

from dotenv import load_dotenv

from meta_ads_manager import MetaAdsManager

load_dotenv()

VIDEO_PATH = "/Users/roihala/downloads/AI WEON חדש (1).mp4"

print("\n" + "=" * 60)
print("AIWEON VIDEO AD CAMPAIGN — Brands (V4)")
print("=" * 60)

try:
    manager = MetaAdsManager()

    result = manager.create_complete_video_ad(
        campaign_name="Aiweon — שיווק משפיענים למותגים",
        ad_name="Aiweon Brands V4 — Problem Agitation",
        video_path=VIDEO_PATH,
        title="שיווק משפיענים בלי הבלגן",
        body=(
            "מחפשים משפיענים לקמפיין ולא יודעים מאיפה להתחיל?\n\n"
            "Aiweon מרכזת יוצרי תוכן מאומתים עם סטטיסטיקות אמיתיות — "
            "עוקבים, אחוזי מעורבות, קטגוריות, דמוגרפיה. "
            "מפרסמים קמפיין, מקבלים מועמדויות, ובוחרים את היוצרים שמתאימים. "
            "הכל במקום אחד."
        ),
        link_url="https://aiweon.co.il",
        daily_budget_usd=14,  # ~50 ILS/day
        targeting={
            "geo_locations": {"countries": ["IL"]},
            "age_min": 25,
            "age_max": 55,
        },
        objective="OUTCOME_ENGAGEMENT",
        optimization_goal="THRUPLAY",
        call_to_action="LEARN_MORE",
    )

    print(f"\nResult: {result}")

except Exception as e:
    print(f"\n[ERROR] {str(e)}")
    import traceback

    traceback.print_exc()
    sys.exit(1)
