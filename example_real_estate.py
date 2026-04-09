"""
Example: Batch ad creation for Aiweon — agency + SaaS campaigns.
"""
import json
from automation_main import AdAutomation
from dotenv import load_dotenv

load_dotenv()

automation = AdAutomation()

print("\n" + "=" * 60)
print("AIWEON AD EXAMPLES")
print("=" * 60)

# Example 1: Agency brand awareness
print("\nCreating ad: Agency Brand Awareness")
print("-" * 60)

agency_ad = automation.create_ad_with_ai_image(
    image_prompt=(
        "Modern AI marketing agency office, team collaborating around screens "
        "showing data analytics, professional and innovative atmosphere, "
        "natural lighting, high-end tech workspace"
    ),
    campaign_name="Aiweon - Brand Awareness IL",
    ad_title="Meet Aiweon: AI Marketing, Redefined",
    ad_body=(
        "Israel's AI-first digital marketing agency. "
        "We use machine learning to find your audience, craft your message, "
        "and maximize your ROI."
    ),
    link_url="https://aiweon.com",
    daily_budget=7000,  # 70 ILS/day
    targeting={
        'geo_locations': {'countries': ['IL']},
        'age_min': 28,
        'age_max': 55,
        'interests': [
            {'id': 6003384953570, 'name': 'Digital marketing'},
            {'id': 6003171473721, 'name': 'Entrepreneurship'},
        ],
    },
    objective="OUTCOME_TRAFFIC",
    call_to_action="LEARN_MORE",
)

if agency_ad['success']:
    print(f"Ad created! ID: {agency_ad['meta_ad']['ad_id']}")
else:
    print(f"Error: {agency_ad.get('error')}")


# Example 2: SaaS lead generation
print("\nCreating ad: SaaS Lead Generation")
print("-" * 60)

saas_ad = automation.create_ad_with_ai_image(
    image_prompt=(
        "Clean SaaS product screenshot showing marketing automation dashboard, "
        "campaign performance graphs, A/B testing results, "
        "modern UI with gradients, professional product mockup"
    ),
    campaign_name="Aiweon SaaS - Lead Gen IL",
    ad_title="Automate Your Marketing in Minutes",
    ad_body=(
        "From campaign creation to optimization — all powered by AI. "
        "Start your free trial and see results from day one."
    ),
    link_url="https://aiweon.com",
    daily_budget=10000,  # 100 ILS/day
    targeting={
        'geo_locations': {'countries': ['IL']},
        'age_min': 25,
        'age_max': 50,
        'interests': [
            {'id': 6003384953570, 'name': 'Digital marketing'},
            {'id': 6003020834693, 'name': 'Marketing automation'},
        ],
    },
    objective="OUTCOME_LEADS",
    call_to_action="SIGN_UP",
)

if saas_ad['success']:
    print(f"Ad created! ID: {saas_ad['meta_ad']['ad_id']}")
else:
    print(f"Error: {saas_ad.get('error')}")


# Summary
print("\n" + "=" * 60)
print("BATCH SUMMARY")
print("=" * 60)

results = [agency_ad, saas_ad]
successful = sum(1 for r in results if r.get('success'))
print(f"Created: {successful}/{len(results)} ads")
print(f"Logs: ./logs/")
print(f"Images: ./generated_images/")

if successful == len(results):
    print("\nAll ads created. Review and activate in Meta Ads Manager.")
    print("https://business.facebook.com/adsmanager")
else:
    failed = len(results) - successful
    print(f"\n{failed} ad(s) failed. Check logs for details.")

print("=" * 60 + "\n")
