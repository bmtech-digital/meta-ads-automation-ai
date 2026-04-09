"""
Quick credential check — lightweight, no API calls.
"""
import os
from dotenv import load_dotenv

print("Quick Credential Check...\n")
print("=" * 60)

load_dotenv()

print("\nENVIRONMENT VARIABLES:")
print("-" * 60)

credentials = {
    'GCP_PROJECT_ID': os.getenv('GCP_PROJECT_ID'),
    'META_APP_ID': os.getenv('META_APP_ID'),
    'META_APP_SECRET': os.getenv('META_APP_SECRET'),
    'META_ACCESS_TOKEN': os.getenv('META_ACCESS_TOKEN'),
    'META_AD_ACCOUNT_ID': os.getenv('META_AD_ACCOUNT_ID'),
    'META_PAGE_ID': os.getenv('META_PAGE_ID'),
}

all_ok = True
for key, value in credentials.items():
    if value and not value.startswith('your-'):
        masked = f"{value[:15]}...{value[-10:]}" if len(value) > 25 else "***"
        print(f"[OK] {key}: {masked}")
    else:
        print(f"[--] {key}: NOT SET")
        all_ok = False

print("\n" + "=" * 60)

if all_ok:
    print("\nAll credentials configured.")
    print("Run 'python test_credentials.py' for full API validation.")
else:
    print("\nSome credentials missing. Update your .env file.")
    print("See .env.example for the required variables.")

print("=" * 60)
