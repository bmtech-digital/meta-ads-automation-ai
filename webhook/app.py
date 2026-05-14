"""
Meta Lead Ads → Trello webhook server.

Receives leadgen webhook notifications from Meta, fetches lead details,
and creates a Trello card for each new lead.
"""

import hashlib
import hmac
import json
import logging
import os

import requests
from flask import Flask, jsonify, request

app = Flask(__name__)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Config (from env) ────────────────────────────────────────────────────────

VERIFY_TOKEN = os.environ["WEBHOOK_VERIFY_TOKEN"]
META_APP_SECRET = os.environ["META_APP_SECRET"]
META_ACCESS_TOKEN = os.environ["META_ACCESS_TOKEN"]
TRELLO_API_KEY = os.environ["TRELLO_API_KEY"]
TRELLO_TOKEN = os.environ["TRELLO_TOKEN"]
TRELLO_LIST_ID = os.environ["TRELLO_LIST_ID"]

GRAPH_API = "https://graph.facebook.com/v25.0"


# ── Helpers ──────────────────────────────────────────────────────────────────


def verify_signature(payload: bytes, signature_header: str) -> bool:
    """Verify the X-Hub-Signature-256 header against META_APP_SECRET."""
    if not signature_header:
        return False
    expected = (
        "sha256=" + hmac.new(META_APP_SECRET.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    )
    return hmac.compare_digest(expected, signature_header)


def fetch_lead(lead_id: str) -> dict:
    """Fetch lead details from the Meta Graph API."""
    resp = requests.get(
        f"{GRAPH_API}/{lead_id}",
        params={
            "access_token": META_ACCESS_TOKEN,
            "fields": "created_time,field_data,ad_id,form_id,campaign_name",
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def parse_lead_fields(field_data: list[dict]) -> dict:
    """Convert Meta's field_data array into a flat dict."""
    return {f["name"]: f["values"][0] if f.get("values") else "" for f in field_data}


def create_trello_card(lead: dict, fields: dict) -> dict:
    """Create a Trello card from lead data."""
    name = fields.get("full_name") or fields.get("name", "Unknown")
    email = fields.get("email", "")
    phone = fields.get("phone_number") or fields.get("phone", "")

    card_name = name
    desc_lines = [
        f"**Name:** {name}",
        f"**Email:** {email}",
        f"**Phone:** {phone}",
        f"**Lead ID:** {lead.get('id', '')}",
        f"**Form ID:** {lead.get('form_id', '')}",
        f"**Ad ID:** {lead.get('ad_id', '')}",
        f"**Created:** {lead.get('created_time', '')}",
    ]
    # Include any extra fields from the form
    known = {"full_name", "name", "email", "phone_number", "phone"}
    for key, val in fields.items():
        if key not in known and val:
            desc_lines.append(f"**{key}:** {val}")

    resp = requests.post(
        "https://api.trello.com/1/cards",
        params={
            "key": TRELLO_API_KEY,
            "token": TRELLO_TOKEN,
        },
        json={
            "idList": TRELLO_LIST_ID,
            "name": card_name,
            "desc": "\n".join(desc_lines),
            "pos": "top",
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


# ── Routes ───────────────────────────────────────────────────────────────────


@app.route("/webhook", methods=["GET"])
def verify():
    """Meta webhook verification (GET challenge)."""
    mode = request.args.get("hub.mode")
    token = request.args.get("hub.verify_token")
    challenge = request.args.get("hub.challenge")

    if mode == "subscribe" and token == VERIFY_TOKEN:
        log.info("Webhook verified successfully")
        return challenge, 200
    log.warning("Webhook verification failed (bad token)")
    return "Forbidden", 403


@app.route("/webhook", methods=["POST"])
def handle_webhook():
    """Receive leadgen notifications and create Trello cards."""
    payload = request.get_data()
    signature = request.headers.get("X-Hub-Signature-256", "")

    if not verify_signature(payload, signature):
        log.warning("Invalid signature — ignoring request")
        return "Bad signature", 403

    data = request.get_json(force=True)
    log.info("Webhook received: %s", json.dumps(data, indent=2))

    if data.get("object") != "page":
        return "OK", 200

    for entry in data.get("entry", []):
        for change in entry.get("changes", []):
            if change.get("field") != "leadgen":
                continue

            lead_id = change["value"].get("leadgen_id")
            if not lead_id:
                continue

            log.info("Processing lead %s", lead_id)
            try:
                lead = fetch_lead(str(lead_id))
                fields = parse_lead_fields(lead.get("field_data", []))
                card = create_trello_card(lead, fields)
                log.info(
                    "Trello card created: %s (id=%s)",
                    card.get("name"),
                    card.get("id"),
                )
            except Exception:
                log.exception("Failed to process lead %s", lead_id)

    return "OK", 200


@app.route("/health", methods=["GET"])
def health():
    """Health check for Cloud Run."""
    return jsonify({"status": "ok"}), 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)
