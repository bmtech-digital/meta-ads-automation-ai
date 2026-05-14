"""
tools/compose_copy_brief.py — assemble the structured context the agent needs
to write Hebrew customer-facing copy.

Built 2026-05-13 PM as the second leg of the "consultant fills the form"
capability (after draft_new_campaign_payload). The tool itself does NOT
generate copy — that's the agent's job per the lib boundary rules (no Hebrew
in lib/tools, all phrasing happens in prompts). What this tool does is
**load + collate** the structured inputs that hebrew-copy-style §§2-9 say the
agent must consult before writing copy:

  - Service-specific pain point + USP (from business_knowledge.products[tag])
  - Target customer description (ideal_customer + segment selection rules §1)
  - Brand voice dimensions (formality / energy / humor / tech register)
  - Forbidden lexicon (§3 pan-Israeli + Aiweon-specific)
  - Length constraints per copy field
  - Available CTAs that cohere with the objective
  - Marketing-angle-specific opening patterns (§5-§7 examples)

Output is a single JSON brief the agent reads. It then writes 1-3 variants
itself and passes them to propose_task (or to draft_new_campaign_payload's
--copy-* args).

Until 2026-05-13 the agent wrote copy "from scratch" each time — no consistent
brand voice, no per-service nuance, no awareness of forbidden tokens beyond
what it remembered from hebrew-copy-style. After this tool, every copy session
starts from the same explicit brief, which is also stored via `log_decision`
for audit.

Contract: §11.6 (JSON stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import json

from campaigner.lib.config import Config, ConfigError
from campaigner.lib.db import fetch_one
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    emit_validation_error,
    with_db_retry,
)

# CTA per objective coherence — Meta enum tokens. The agent receives these
# as the legal options for the objective; picking outside the list is a
# §38 violation at propose-time.
_CTA_FOR_OBJECTIVE: dict[str, list[str]] = {
    "OUTCOME_LEADS": ["MESSAGE_PAGE", "SIGN_UP", "LEARN_MORE", "GET_QUOTE", "CONTACT_US", "SUBSCRIBE"],
    "OUTCOME_SALES": ["SHOP_NOW", "GET_OFFER", "ORDER_NOW", "BUY_NOW", "ADD_TO_CART"],
    "OUTCOME_ENGAGEMENT": ["MESSAGE_PAGE", "SEND_MESSAGE", "LIKE_PAGE", "LEARN_MORE"],
    "OUTCOME_TRAFFIC": ["LEARN_MORE", "WATCH_MORE", "DOWNLOAD", "VIEW_INSTAGRAM_PROFILE"],
    "OUTCOME_AWARENESS": ["LEARN_MORE", "WATCH_MORE"],
    "OUTCOME_APP_PROMOTION": ["INSTALL_NOW", "USE_APP", "OPEN_LINK"],
}

# Per hebrew-copy-style §3 — pan-Israeli forbidden phrases (always reject).
# The agent reads this list and avoids these tokens in its copy.
_FORBIDDEN_PAN_ISRAELI = [
    "לחץ כאן",
    "מוגבל בזמן!",
    "הזדמנות של פעם בחיים",
    "מהפכה",
    "פריצת דרך",
    "בלעדי",
    "!!!",
    "???",
    "חינם!!",
    "רק היום",
]

# Aiweon-specific forbidden (hebrew-copy-style §3 Aiweon hard-ban).
_FORBIDDEN_AIWEON = [
    "X3 לידים",  # any specific-ROI claim without business-specific data
    "חיסכון של %",
    "פי N מכירות",
    "המוביל",
    "מספר 1",
    "הטוב ביותר",
    "פתרון 360",
    "end-to-end",
    "holistic",
    "ecosystem",
    "synergy",
    "workflow",
    "engagement",  # transliterated marketing-ese; agent uses Hebrew equivalent
    "funnel",
]

# Length constraints per copy field per channel — derived from hebrew-copy-style
# §12 (organic) but applied here for ads too. Conservative; Meta truncates
# differently per placement.
_LENGTH_RULES = {
    "headline": {"max_chars": 40, "ideal_words": "3-5"},
    "primary_text": {"max_chars": 150, "min_chars": 80, "ideal_words": "15-25"},
    "description": {"max_chars": 30, "ideal_words": "3-5"},
}

# Per marketing-angle, the opening pattern the agent should follow.
# These are not templates to fill — they're rhythms.
_OPENING_PATTERNS = {
    "social_proof": "Open with what others-like-the-customer are doing/seeing. NOT 'אלפי משתמשים' (vague) — specific behavior or outcome they recognize.",
    "comparison": "Open by contrasting the customer's current path against a better one. Be concrete: 'במקום X — Y'.",
    "urgency": "Use only with real time-bound reason. Open by naming the deadline + what's at stake if missed. NEVER 'מוגבל בזמן!' or 'רק היום' unless literally true.",
    "utility": "Open with a number or a hard fact about how the product saves time/money. NOT a claim of magic ('AI מהפכני') — a process description ('סורק 500 פרופילים בדקות').",
    "educational": "Open with a misconception the customer holds. Then correct it gently with the product's process. Aiweon-voice friendly: 'רוב המפרסמים חושבים ש...'",
}


def main() -> None:
    p = argparse.ArgumentParser(
        description="Compose a structured copy brief for the agent to write "
        "Hebrew customer-facing ad copy from. Reads business_knowledge and "
        "the hebrew-copy-style canonical constraints; outputs a single brief.",
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--service-tag",
        default=None,
        help="business_knowledge.products[].service_tag — required when business "
        "has multiple products. The brief becomes service-specific.",
    )
    p.add_argument(
        "--objective",
        required=True,
        choices=list(_CTA_FOR_OBJECTIVE.keys()),
    )
    p.add_argument(
        "--marketing-angle",
        default=None,
        choices=list(_OPENING_PATTERNS.keys()) + [None],
        help="If set, the brief includes the opening pattern for that angle. "
        "Agent can override but should justify in the rationale.",
    )
    p.add_argument(
        "--channel",
        default="feed",
        choices=["feed", "stories", "reels", "messaging"],
        help="Affects length guidance and CTA priority (stories/reels are visual-first).",
    )
    p.add_argument(
        "--variants",
        type=int,
        default=3,
        help="How many variants to brief the agent to write (default 3 per creative-guide §7 firehose).",
    )
    args = p.parse_args()

    try:
        Config.load().require_db()
    except ConfigError as e:
        emit_validation_error(str(e))
        return

    try:
        biz = with_db_retry(
            lambda: fetch_one(
                """
                SELECT b.id, b.name, b.target_cpl_ils,
                       bk.vertical, bk.products, bk.brand_voice,
                       bk.questionnaire_answers, bk.service_regions,
                       bk.customer_age_min, bk.customer_age_max
                  FROM businesses b
             LEFT JOIN business_knowledge bk ON bk.business_id = b.id
                 WHERE b.id = %s
                """,
                (args.business_id,),
            )
        )
    except Exception as e:
        emit_runtime_error(f"business lookup failed: {e}", exc=e)
        return

    if not biz:
        emit_validation_error(f"business {args.business_id} not found")
        return

    # Extract products and find the one matching service_tag.
    products = biz.get("products") or []
    if isinstance(products, str):
        try:
            products = json.loads(products)
        except (TypeError, ValueError):
            products = []

    service: dict | None = None
    available_tags: list[str] = []
    if isinstance(products, list):
        for p_item in products:
            if not isinstance(p_item, dict):
                continue
            tag = p_item.get("service_tag")
            if tag:
                available_tags.append(tag)
            if args.service_tag and tag == args.service_tag:
                service = p_item
    if args.service_tag and not service and available_tags:
        emit_validation_error(
            f"service_tag={args.service_tag!r} not found. "
            f"Available: {sorted(available_tags)}"
        )
        return

    # Extract brand voice rules.
    brand_voice = biz.get("brand_voice") or {}
    if isinstance(brand_voice, str):
        try:
            brand_voice = json.loads(brand_voice)
        except (TypeError, ValueError):
            brand_voice = {}

    # Extract ideal_customer description.
    qa = biz.get("questionnaire_answers") or {}
    if isinstance(qa, str):
        try:
            qa = json.loads(qa)
        except (TypeError, ValueError):
            qa = {}
    ideal_customer = qa.get("ideal_customer") if isinstance(qa, dict) else None

    # Channel-specific guidance.
    channel_length = {
        "feed": "primary_text 80-150, headline 3-5 words, no hashtags on FB / 3-7 on IG.",
        "stories": "Visual-first, NO API caption. Text overlay baked into asset only.",
        "reels": "Caption 50-100 words, hook in line 1, 3-5 hashtags, no link in body.",
        "messaging": "Headline 3-5 words. Primary text frames the conversation invite.",
    }[args.channel]

    # Persona selection per hebrew-copy-style §1 multi-segment rules.
    persona_hint = "ברירת מחדל: סגמנט 1 (מנהלי שיווק בחברות בינוניות-גדולות) — הקהל הרחב ביותר ל-B2B SaaS ישראלי 2026."
    if isinstance(qa, dict) and ideal_customer:
        persona_hint = f"מתוך business_knowledge.ideal_customer: {ideal_customer}"

    brief: dict = {
        "business_id": args.business_id,
        "business_name": biz.get("name"),
        "vertical": biz.get("vertical"),
        "service_tag": args.service_tag,
        "service_offering": service.get("offering") if service else None,
        "service_pain": service.get("pain_point") if service else None,
        "service_usp": service.get("usp") if service else None,
        "available_service_tags": available_tags,
        "objective": args.objective,
        "marketing_angle": args.marketing_angle,
        "channel": args.channel,
        "variants_to_write": args.variants,
        # ─── audience ───
        "audience": {
            "persona": persona_hint,
            "age_min": biz.get("customer_age_min"),
            "age_max": biz.get("customer_age_max"),
            "region": biz.get("service_regions"),
        },
        # ─── voice rules ───
        "voice": {
            "formality": brand_voice.get("formality") or "ידידותי-מקצועי (Option A — singular את/אתה)",
            "energy": brand_voice.get("energy") or "calm / advisory — מומחה שמסביר",
            "humor": brand_voice.get("humor") or "straight-faced, no humor (B2B IL)",
            "register": brand_voice.get("technical_register") or "plain Hebrew, no acronyms in customer copy",
        },
        # ─── constraints ───
        "length_rules": _LENGTH_RULES,
        "channel_length_note": channel_length,
        "cta_allowed": _CTA_FOR_OBJECTIVE[args.objective],
        "forbidden_tokens": {
            "pan_israeli": _FORBIDDEN_PAN_ISRAELI,
            "aiweon_specific": _FORBIDDEN_AIWEON,
            "rule": "Any presence of any token above → regenerate the variant.",
        },
        # ─── opening pattern by angle ───
        "opening_pattern": (
            _OPENING_PATTERNS.get(args.marketing_angle)
            if args.marketing_angle
            else "No specific angle pre-selected. Pick one and state in the rationale."
        ),
        # ─── meta-rules the agent applies ───
        "writing_rules": [
            "AI mentioned exactly ONCE per copy, never as buzzword — only as 'מה זה עושה'.",
            "First line must stand alone (IG cuts at ~80 chars, FB at ~120).",
            "No specific-ROI claims (X3 leads, 70% improvement) unless backed by what_worked_before in business_knowledge.",
            "Reader is the customer, not the operator — translate every technical concept.",
            "If headline can't be read aloud without explanation, rewrite.",
        ],
        "audit_note": (
            "Pass each variant through forbidden_tokens before returning. If any "
            "match → regenerate that variant. The agent must self-check; the tool "
            "doesn't see the output."
        ),
    }

    emit_success({
        "business_id": args.business_id,
        "brief": brief,
        "ready_for_agent": True,
    })


if __name__ == "__main__":
    main()
