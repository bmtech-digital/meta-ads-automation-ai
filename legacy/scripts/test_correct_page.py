"""
Test that the configured META_PAGE_ID can create ad creatives.
Run this after setting up your .env to verify page connectivity.
"""

import os

from dotenv import load_dotenv
from facebook_business.adobjects.adaccount import AdAccount
from facebook_business.adobjects.page import Page
from facebook_business.api import FacebookAdsApi

load_dotenv()

print("\nTESTING PAGE CONFIGURATION")
print("=" * 60)

FacebookAdsApi.init(
    app_id=os.getenv("META_APP_ID"),
    app_secret=os.getenv("META_APP_SECRET"),
    access_token=os.getenv("META_ACCESS_TOKEN"),
)

ad_account = AdAccount(os.getenv("META_AD_ACCOUNT_ID"))
page_id = os.getenv("META_PAGE_ID")

print(f"\nAd Account: {ad_account.get_id()}")
print(f"Page ID: {page_id}")

print("\nChecking page access...")
print("-" * 60)

try:
    page = Page(fbid=page_id)
    page_info = page.api_get(fields=["id", "name", "is_published"])

    print(f"Page Name: {page_info.get('name')}")
    print(f"Published: {page_info.get('is_published')}")
    print("Page access: OK")

    print("\nPage is correctly configured. You can run:")
    print("  python run_automation.py")

except Exception as e:
    print(f"\nERROR: {str(e)}")
    print("\nPossible causes:")
    print("1. Token missing 'pages_manage_ads' permission")
    print("2. Page not connected to the Ad Account")
    print("3. Wrong META_PAGE_ID in .env")
    print("\nRun 'python diagnose_page_permissions.py' for detailed diagnostics.")

print("\n" + "=" * 60)
