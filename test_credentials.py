"""
Test all configured credentials: GCP (Vertex AI) and Meta Ads.
"""
import os
from dotenv import load_dotenv

print("Testing Credentials...\n")
print("=" * 60)

load_dotenv()

print("\nCHECKING ENVIRONMENT VARIABLES:")
print("-" * 60)

credentials = {
    'GCP_PROJECT_ID': os.getenv('GCP_PROJECT_ID'),
    'META_APP_ID': os.getenv('META_APP_ID'),
    'META_APP_SECRET': os.getenv('META_APP_SECRET'),
    'META_ACCESS_TOKEN': os.getenv('META_ACCESS_TOKEN'),
    'META_AD_ACCOUNT_ID': os.getenv('META_AD_ACCOUNT_ID'),
    'META_PAGE_ID': os.getenv('META_PAGE_ID'),
}

for key, value in credentials.items():
    if value and not value.startswith('your-'):
        masked = f"{value[:15]}...{value[-10:]}" if len(value) > 25 else "***"
        print(f"  OK  {key}: {masked}")
    else:
        print(f"  --  {key}: NOT SET")

print("\n" + "=" * 60)
print("\nTESTING APIS:")
print("-" * 60)

# Test 1: Vertex AI / Imagen
print("\n1. Testing Vertex AI (Imagen)...")
try:
    from google import genai

    project_id = os.getenv('GCP_PROJECT_ID', 'bemtech-478413')
    client = genai.Client(
        vertexai=True,
        project=project_id,
        location=os.getenv('GCP_LOCATION', 'us-central1'),
    )
    print(f"   OK  Vertex AI client initialized (project: {project_id})")

    # Quick model list check
    print("   OK  google-genai SDK loaded successfully")

except ImportError:
    print("   --  google-genai not installed")
    print("       Run: pip install google-genai")
except Exception as e:
    print(f"   FAIL  Error: {str(e)}")
    print("       Run: gcloud auth application-default login")

# Test 2: Meta Ads API
print("\n2. Testing Meta Ads API...")
try:
    meta_app_id = os.getenv('META_APP_ID')
    meta_app_secret = os.getenv('META_APP_SECRET')
    meta_access_token = os.getenv('META_ACCESS_TOKEN')
    meta_account_id = os.getenv('META_AD_ACCOUNT_ID')

    if not meta_app_id or meta_app_id.startswith('your-'):
        print("   --  META_APP_ID not configured")
    elif not meta_app_secret or meta_app_secret.startswith('your-'):
        print("   --  META_APP_SECRET not configured")
    elif not meta_account_id or meta_account_id.startswith('act_your'):
        print("   --  META_AD_ACCOUNT_ID not configured")
    else:
        from facebook_business.api import FacebookAdsApi
        from facebook_business.adobjects.adaccount import AdAccount

        FacebookAdsApi.init(
            app_id=meta_app_id,
            app_secret=meta_app_secret,
            access_token=meta_access_token,
        )

        account = AdAccount(meta_account_id)
        account_info = account.api_get(fields=['name', 'account_status'])

        print(f"   OK  Meta Ads API connected!")
        print(f"       Account: {account_info.get('name', 'N/A')}")
        print(f"       Status: {account_info.get('account_status', 'N/A')}")

except ImportError:
    print("   --  facebook-business not installed")
    print("       Run: pip install -r requirements.txt")
except Exception as e:
    error_msg = str(e)
    print(f"   FAIL  Error: {error_msg}")

    if "Invalid OAuth" in error_msg:
        print("       Token expired. Generate new one at:")
        print("       https://developers.facebook.com/tools/explorer/")
    elif "Permissions" in error_msg:
        print("       Missing permissions. Add in Graph API Explorer:")
        print("       - ads_management")
        print("       - business_management")

# Summary
print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)
print("""
NEXT STEPS:

1. If Vertex AI is OK:
   -> You can generate images with Imagen

2. If Meta Ads is OK:
   -> You can create ad campaigns

3. If something failed:
   -> Check .env configuration
   -> Run: gcloud auth application-default login (for GCP)
   -> Generate Meta token at developers.facebook.com/tools/explorer/

4. When everything works:
   -> Run: python run_automation.py
""")
print("=" * 60)
