"""
tools/check_business_alignment.py — detect drift between creative content and business_knowledge.products.

Phase 4 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
§7). The gap this closes: an operator can update `business_knowledge.products`
to one description ("influencer marketing platform"), but the actual live ads
may sell something else ("AI chatbot for websites"). The agent's diagnosis
heuristics — vertical, customer angle, brand voice — all key off products, so
a drift means the agent is reasoning about the wrong product.

For each non-archived gallery row with copy:
  1. Tokenize creative `primary_text` + `headline` into Hebrew n-grams.
  2. Tokenize each product's `description` + `name` the same way.
  3. Compute Jaccard overlap.
  4. Classify alignment per row: aligned / mixed / drifted.
  5. Return a per-row + aggregate verdict.

This is a deterministic check — no LLM call needed. v1.1 can add a Claude API
semantic compare for nuanced matches; v1 catches the obvious drift (Aiweon's
products text vs. its actual ads) which is the main use case.

Output: summary JSON with per-creative scores + aggregate `drift_band`
(`aligned` / `mixed` / `drifted`). §T_CR (Creative Reformat) lane reads this.

Contract: §11.6 (single JSON on stdout, exit 0/1/2).
"""

from __future__ import annotations

import argparse
import re
from typing import Any

from campaigner.lib.db import fetch_all, fetch_one
from campaigner.tools._contract import (
    emit_runtime_error,
    emit_success,
    with_db_retry,
)


# Hebrew-aware tokenization: words = sequences of Hebrew or Latin letters
# (with niqqud / cantillation stripped). Min length 2 to drop noise like
# "ה" / "ל" (Hebrew articles + prepositions).
_TOKEN_RE = re.compile(r"[֐-׿A-Za-z][֐-׿A-Za-z]+", re.UNICODE)
_NIQQUD_RE = re.compile(r"[֑-ֽֿ-ׇ]")

# Hebrew + English stopwords — operator-facing copy is full of these and they
# inflate Jaccard scores meaninglessly.
_STOPWORDS_HE = {
    "של", "את", "על", "עם", "כל", "הזה", "הזאת", "אנחנו", "אתם", "אתה", "אני",
    "הוא", "היא", "הם", "הן", "זה", "זאת", "אלה", "כאן", "שם", "אם", "כי",
    "כדי", "אבל", "רק", "גם", "לא", "כן", "יש", "אין", "היה", "להיות", "להיותם",
    "תרצו", "שלך", "שלכם", "שלנו", "שלהם", "וכל", "מאד", "מאוד", "יותר", "פחות",
    "הם", "הזה", "הזו", "ההוא", "ההיא", "מה", "מי", "איך", "אבל", "ולא", "וגם",
    "לכל", "לכן", "מכל", "וכן", "אז",
}
_STOPWORDS_EN = {
    "the", "and", "for", "are", "you", "your", "our", "with", "this", "that",
    "is", "of", "to", "in", "on", "at", "by", "as", "be", "an", "or",
}


def _normalize(text: str) -> str:
    return _NIQQUD_RE.sub("", text or "")


def _tokenize(text: str) -> set[str]:
    """Tokenize Hebrew+English text into a set of meaningful word tokens."""
    if not text:
        return set()
    norm = _normalize(text.lower())
    tokens = set(_TOKEN_RE.findall(norm))
    return {t for t in tokens if t not in _STOPWORDS_HE and t not in _STOPWORDS_EN}


def _bigrams(tokens: set[str]) -> set[str]:
    """No-op for sets — bigrams not meaningful out of order. Kept as a hook
    if we later want positional n-grams from a tokenized list."""
    return tokens


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    inter = a & b
    union = a | b
    return len(inter) / max(1, len(union))


def _row_band(score: float, max_per_product: float) -> str:
    """Convert a Jaccard score into a coarse band.

    `score` is the row's max alignment against ANY product.
    `max_per_product` is the highest score seen across all products — used
    only to surface "this row aligned with product X" in the verdict.
    """
    if score >= 0.15:
        return "aligned"
    if score >= 0.05:
        return "mixed"
    return "drifted"


def _check(business_id: str, days: int) -> dict:
    biz = fetch_one(
        "SELECT name, primary_kpi FROM businesses WHERE id = %s",
        (business_id,),
    )
    if not biz:
        return {"business_id": business_id, "error": "business_not_found"}

    knowledge = fetch_one(
        "SELECT products FROM business_knowledge WHERE business_id = %s",
        (business_id,),
    )
    products: list[dict] = []
    if knowledge:
        raw = knowledge.get("products") or []
        if isinstance(raw, list):
            products = raw

    if not products:
        return {
            "business_id": business_id,
            "business_name": biz.get("name"),
            "products_count": 0,
            "creatives_checked": 0,
            "drift_band": "no_baseline",
            "note": "business_knowledge.products is empty — no baseline to drift from",
        }

    # Build product term sets — keyed by product name.
    product_terms: list[tuple[str, set[str]]] = []
    for p in products:
        if not isinstance(p, dict):
            continue
        name = p.get("name") or "(unnamed)"
        text = " ".join(
            str(x)
            for x in (
                p.get("name"),
                p.get("description"),
                p.get("price_range"),
            )
            if x
        )
        terms = _tokenize(text)
        if terms:
            product_terms.append((name, terms))

    # Pull recent creatives — both meta_backfill (live ads) and our own
    # generations, last `days` days.
    rows = with_db_retry(
        lambda: fetch_all(
            """
            SELECT id::text AS id,
                   kind, headline, primary_text, marketing_angle,
                   generated_by, meta_creative_id,
                   created_at::text AS created_at
              FROM creative_gallery
             WHERE business_id = %s
               AND deleted_at IS NULL
               AND COALESCE(primary_text, headline) IS NOT NULL
               AND created_at >= now() - make_interval(days => %s)
             ORDER BY created_at DESC
             LIMIT 100
            """,
            (business_id, days),
        )
    )

    per_creative: list[dict[str, Any]] = []
    aligned = mixed = drifted = 0

    for r in rows:
        creative_text = " ".join(
            str(x or "")
            for x in (r.get("headline"), r.get("primary_text"))
        )
        c_terms = _tokenize(creative_text)
        if not c_terms:
            continue

        best_score = 0.0
        best_product = None
        per_product: dict[str, float] = {}
        for name, p_terms in product_terms:
            s = _jaccard(c_terms, p_terms)
            per_product[name] = round(s, 3)
            if s > best_score:
                best_score = s
                best_product = name

        band = _row_band(best_score, best_score)
        if band == "aligned":
            aligned += 1
        elif band == "mixed":
            mixed += 1
        else:
            drifted += 1

        per_creative.append(
            {
                "creative_id": r["id"],
                "meta_creative_id": r.get("meta_creative_id"),
                "kind": r.get("kind"),
                "generated_by": r.get("generated_by"),
                "headline_preview": (r.get("headline") or "")[:60],
                "best_aligned_product": best_product,
                "alignment_score": round(best_score, 3),
                "per_product_scores": per_product,
                "band": band,
            }
        )

    total = aligned + mixed + drifted
    if total == 0:
        agg = "no_creatives"
    elif drifted / total >= 0.5:
        agg = "drifted"
    elif aligned / total >= 0.5:
        agg = "aligned"
    else:
        agg = "mixed"

    return {
        "business_id": business_id,
        "business_name": biz.get("name"),
        "products": [name for name, _ in product_terms],
        "products_count": len(product_terms),
        "creatives_checked": total,
        "aligned_count": aligned,
        "mixed_count": mixed,
        "drifted_count": drifted,
        "drift_band": agg,
        "per_creative": per_creative,
        "thresholds": {
            "aligned_min_jaccard": 0.15,
            "mixed_min_jaccard": 0.05,
        },
    }


def main() -> None:
    p = argparse.ArgumentParser(
        description="Detect drift between creative content and business_knowledge.products."
    )
    p.add_argument("--business-id", required=True)
    p.add_argument(
        "--days",
        type=int,
        default=60,
        help="Window of creatives to check (default 60 days).",
    )
    args = p.parse_args()

    try:
        emit_success(_check(args.business_id, args.days))
    except Exception as e:
        emit_runtime_error(f"alignment check failed: {e}", e)


if __name__ == "__main__":
    main()
