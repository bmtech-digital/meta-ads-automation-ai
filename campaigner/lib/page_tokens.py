"""
Resolve and decrypt page access tokens for a business — the bridge between
`businesses.meta_page_id` / selected IG and the Graph publishing helpers in
`page_publishing.py`.

The Page Access Token is what publishing endpoints require. For Facebook
posts that's straightforward (the Page's own token). For Instagram, Meta's
Graph design routes everything through a linked Page — IG publish endpoints
authenticate with the linked Page's token, not a separate IG token. We
encapsulate that here so callers don't have to know the quirk.
"""

from __future__ import annotations

from typing import Literal

from .crypto import decrypt_token
from .db import fetch_one


class TokenLookupError(RuntimeError):
    """No page/IG selected, or no token persisted for the active business."""


def get_fb_publishing_target(business_id: str) -> tuple[str, str]:
    """
    Resolve (page_id, decrypted_page_token) for the active business's
    selected Facebook Page. Source of truth: `businesses.meta_page_id`,
    joined to `meta_pages` for the token.

    Raises TokenLookupError if the business hasn't selected a Page.
    """
    row = fetch_one(
        """
        SELECT p.page_id, p.page_access_token_encrypted
          FROM businesses b
          JOIN meta_pages p ON p.page_id = b.meta_page_id
                            AND p.connection_id IN (
                              SELECT id FROM meta_connections
                               WHERE business_id = b.id OR id IN (
                                 SELECT connection_id FROM meta_ad_accounts
                                  WHERE ad_account_id = b.meta_ad_account_id
                               )
                            )
         WHERE b.id = %s
         LIMIT 1
        """,
        (business_id,),
    )
    if row is None or not row.get("page_access_token_encrypted"):
        raise TokenLookupError(
            f"no selected Facebook Page for business {business_id} — "
            f"go to /integrations and pick a Page"
        )
    return row["page_id"], decrypt_token(row["page_access_token_encrypted"])


def get_ig_publishing_target(business_id: str) -> tuple[str, str]:
    """
    Resolve (ig_user_id, decrypted_page_token) for the active business's
    selected IG account. The token is the LINKED PAGE'S access token — Meta's
    IG Graph endpoints authenticate via the page that has the IG attached.

    For BM-owned IGs without a Page link, we fall back to the business's
    selected Page's token (Meta accepts cross-page tokens as long as the
    underlying business user has access).

    Raises TokenLookupError if no IG is selected OR no page token can be
    found to authenticate the publish with.
    """
    # Path 1: IG with a linked Page — use that Page's token.
    row = fetch_one(
        """
        SELECT ig.ig_user_id, p.page_access_token_encrypted
          FROM meta_ig_accounts ig
          JOIN meta_pages p ON p.id = ig.linked_page_id
          JOIN meta_connections c ON c.id = ig.connection_id
         WHERE ig.selected = true
           AND c.business_id IN (
             SELECT id FROM businesses WHERE id = %s
             UNION
             SELECT business_id FROM meta_connections
              WHERE id = ig.connection_id
           )
         LIMIT 1
        """,
        (business_id,),
    )
    if row and row.get("page_access_token_encrypted"):
        return row["ig_user_id"], decrypt_token(row["page_access_token_encrypted"])

    # Path 2: BM-owned IG without a linked Page — fall back to the business's
    # selected Page (must exist; otherwise nothing can authenticate).
    fallback = fetch_one(
        """
        SELECT ig.ig_user_id, p.page_access_token_encrypted
          FROM meta_ig_accounts ig,
               businesses b
          JOIN meta_pages p ON p.page_id = b.meta_page_id
         WHERE b.id = %s
           AND ig.selected = true
           AND ig.connection_id = p.connection_id
         LIMIT 1
        """,
        (business_id,),
    )
    if fallback and fallback.get("page_access_token_encrypted"):
        return fallback["ig_user_id"], decrypt_token(
            fallback["page_access_token_encrypted"]
        )

    raise TokenLookupError(
        f"no selected IG account (or no Page token to authenticate publish) "
        f"for business {business_id} — go to /integrations and select both"
    )


def get_publishing_target(
    business_id: str,
    network: Literal["facebook", "instagram"],
) -> tuple[str, str]:
    """Unified dispatcher. Returns (entity_id, page_token)."""
    if network == "facebook":
        return get_fb_publishing_target(business_id)
    if network == "instagram":
        return get_ig_publishing_target(business_id)
    raise ValueError(f"unknown network: {network}")
