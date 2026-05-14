import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { decryptToken } from "@/lib/crypto";
import { getDataClient } from "@/lib/db";
import { loadMetaAppConfig } from "@/lib/meta-app-config";
import { getPixelsForAdAccount, MetaGraphError } from "@/lib/meta-graph";

/**
 * POST /api/meta/verify-pixel-capi
 *
 * Operator-triggered Day-Zero check. We query the active business's ad
 * account for its pixels and stage a `verify_pixel_capi` approval row with
 * the findings. The human review IS the verification — they confirm Pixel +
 * CAPI + AEM + domain are all set up by approving the row. On approve, the
 * approve action calls `markTrackingVerified` to flip the guardrail.
 *
 * Why this isn't a pure server action: the call to Meta Graph is slow
 * (~500ms-2s) and can fail in interesting ways. A route gives us proper
 * error redirects + structured failure messages back to the integrations
 * page, rather than a generic "server action failed" banner.
 */
const bodySchema = z.object({});

export async function POST(req: Request): Promise<NextResponse> {
  const session = await getAuth().getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const _ignored = bodySchema.safeParse(Object.fromEntries(await req.formData()));

  let origin: string;
  try {
    origin = loadMetaAppConfig().publicOrigin;
  } catch {
    origin = new URL(req.url).origin;
  }

  const business = await getActiveBusiness();
  if (!business) {
    return NextResponse.redirect(
      `${origin}/integrations?error=no_active_business`,
      303,
    );
  }
  const db = getDataClient();
  const connection = await db.getConnectionByAdAccountId(
    business.meta_ad_account_id,
  );
  if (!connection) {
    return NextResponse.redirect(
      `${origin}/integrations?error=no_connection`,
      303,
    );
  }

  const userToken = decryptToken(connection.long_lived_token_encrypted);

  let pixels: Awaited<ReturnType<typeof getPixelsForAdAccount>>;
  try {
    pixels = await getPixelsForAdAccount({
      adAccountId: business.meta_ad_account_id,
      userToken,
    });
  } catch (e) {
    const code =
      e instanceof MetaGraphError ? `graph_${e.code ?? "unknown"}` : "fetch";
    return NextResponse.redirect(
      `${origin}/integrations?error=pixel_${code}`,
      303,
    );
  }

  // Rationale is human-facing summary. We deliberately keep it terse and
  // factual — the per-pixel details live in payload.pixels for the approval
  // detail page to render row-by-row.
  let rationale: string;
  if (pixels.length === 0) {
    rationale =
      "לא נמצאו Pixel-ים בחשבון המודעות. אישור כאן יסמן \"מאומת\" — אבל ללא Pixel הקמפיינים יעבדו עיוורים. עדיף להוסיף Pixel לפני.";
  } else {
    const freshest = pixels.reduce((acc, p) => {
      if (p.hours_since_last_fired === null) return acc;
      if (acc === null) return p.hours_since_last_fired;
      return Math.min(acc, p.hours_since_last_fired);
    }, null as number | null);
    const freshnessTxt =
      freshest === null
        ? "אף Pixel לא ירה אירועים עדיין"
        : freshest <= 24
          ? `Pixel פעיל (אירוע אחרון לפני ${freshest} ש׳)`
          : `Pixel קיים אבל לא ירה זמן רב (${Math.round(freshest / 24)} ימים)`;
    rationale =
      `נמצאו ${pixels.length} pixel${pixels.length > 1 ? "ים" : ""}. ${freshnessTxt}. ` +
      "אשר את שורת ה-Pixel רק אחרי שווידאת ידנית ב-Events Manager: " +
      "(1) CAPI שולח אירועי server-side, (2) AEM priority events מוגדרים, " +
      "(3) הדומיין שלך מאומת. אישור = הסרת ה-Day-Zero guardrail.";
  }

  const result = await db.createPixelVerificationApproval({
    business_id: business.id,
    pixels,
    rationale,
    // user_triggered marks this as a non-cron-originated row. agent_decisions
    // table uses the same convention for manual operator actions.
    // `approvals.created_by_run_id` is UUID — agent flows use the run's uuid;
    // for operator-triggered checks like this one we generate a one-shot uuid.
    // The session email + timestamp lives in `payload.source` for traceability.
    created_by_run_id: randomUUID(),
  });

  return NextResponse.redirect(
    `${origin}/approvals/${result.id}?new=1`,
    303,
  );
}
