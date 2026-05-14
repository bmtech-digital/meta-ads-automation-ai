import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shell, PageHeader } from "@/components/shell";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import type { AgentMode, SeasonalHint, SeasonalHints } from "@/lib/db/types";
import {
  overlappingPairs,
  seasonalHintSchema,
  type SeasonalHintsForm,
} from "@/lib/schemas/seasonal-hints";
import {
  tokenExpiryState,
  tokenStateLabelHe,
  tokenStateStyles,
} from "@/lib/token-expiry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "הגדרות" };

async function addSeasonalWindowAction(formData: FormData) {
  "use server";
  const session = await getAuth().getSession();
  if (!session) redirect("/login?next=/settings");

  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/settings?error=missing_id");

  const parsed = seasonalHintSchema.safeParse({
    name: formData.get("window_name") ?? "",
    start: formData.get("window_start") ?? "",
    end: formData.get("window_end") ?? "",
    multiplier: formData.get("window_multiplier") ?? "",
    confidence: "user_stated",
  });

  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    redirect(`/settings?error=${encodeURIComponent(msg)}#seasonal`);
  }

  const db = getDataClient();
  const current = await db.getBusinessById(id);
  if (!current) redirect("/settings?error=business_not_found");

  const existing: SeasonalHint[] = current!.seasonal_hints?.windows ?? [];
  const next: SeasonalHints = { windows: [...existing, parsed.data] };
  await db.updateSeasonalHints(id, next);
  redirect("/settings?saved=1#seasonal");
}

async function setAgentModeAction(formData: FormData) {
  "use server";
  const session = await getAuth().getSession();
  if (!session) redirect("/login?next=/settings");

  const id = String(formData.get("id") ?? "");
  const modeRaw = String(formData.get("agent_mode") ?? "");
  const allowed: AgentMode[] = ["insight", "draft", "action"];
  if (!id || !(allowed as string[]).includes(modeRaw)) {
    redirect("/settings?error=bad_agent_mode#agent-mode");
  }
  await getDataClient().setAgentMode(id, modeRaw as AgentMode);
  redirect("/settings?saved=1#agent-mode");
}

async function removeSeasonalWindowAction(formData: FormData) {
  "use server";
  const session = await getAuth().getSession();
  if (!session) redirect("/login?next=/settings");

  const id = String(formData.get("id") ?? "");
  const indexRaw = String(formData.get("index") ?? "");
  const index = Number(indexRaw);
  if (!id || !Number.isInteger(index) || index < 0) {
    redirect("/settings?error=bad_remove_request#seasonal");
  }

  const db = getDataClient();
  const current = await db.getBusinessById(id);
  if (!current) redirect("/settings?error=business_not_found");

  const existing: SeasonalHint[] = current!.seasonal_hints?.windows ?? [];
  if (index >= existing.length)
    redirect("/settings?error=index_out_of_range#seasonal");

  // Safety: never remove 'learned' rows via this action (v2 War Chest entries).
  if (existing[index]?.confidence === "learned") {
    redirect("/settings?error=cannot_remove_learned_window#seasonal");
  }

  const next: SeasonalHints = {
    windows: existing.filter((_, i) => i !== index),
  };
  await db.updateSeasonalHints(id, next);
  redirect("/settings?saved=1#seasonal");
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/settings");

  const { error, saved } = await searchParams;
  const db = getDataClient();
  const business = await getActiveBusiness();
  // Read the connection's real expiry (single source of truth across all
  // businesses that share an OAuth handshake) and fold it onto the local
  // copy so the token banner shows accurate state even if the column wasn't
  // mirrored at OAuth time.
  const connection = business
    ? await db.getConnectionByAdAccountId(business.meta_ad_account_id)
    : null;
  const businessWithLiveExpiry = business
    ? {
        ...business,
        meta_access_token_expires_at:
          connection?.token_expires_at ??
          business.meta_access_token_expires_at,
      }
    : null;

  if (!business) {
    return (
      <Shell active="/settings">
        <PageHeader eyebrow="הגדרות" title="פרטי עסק" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק ב-DB</CardTitle>
            <CardDescription>
              הרץ את ה-migrations ו-seed_local.py לפני עריכת הגדרות.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell active="/settings">
      <PageHeader
        eyebrow="הגדרות"
        title="פרטי עסק"
        subtitle="הקלט המינימלי שהסוכן קורא לפני כל ריצה."
        actions={
          <Link href="/">
            <Button variant="outline" size="sm">
              חזרה לדשבורד
            </Button>
          </Link>
        }
      />

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">DB: {db.mode}</Badge>
          {saved ? <Badge>נשמר</Badge> : null}
        </div>

        {(() => {
          const state = tokenExpiryState(businessWithLiveExpiry ?? business);
          const expiresAtIso =
            connection?.token_expires_at ??
            business.meta_access_token_expires_at;
          const expiresAtHuman = expiresAtIso
            ? new Date(expiresAtIso).toLocaleString("he-IL", {
                dateStyle: "short",
                timeStyle: "short",
              })
            : null;
          return (
            <Card>
              <CardHeader>
                <CardTitle>טוקן גישה ל-Meta</CardTitle>
                <CardDescription>
                  OAuth User Token (~60 יום). חידוש בלחיצה אחת ב-/integrations
                  כשמתקרב לסוף החיים.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${tokenStateStyles(state)}`}
                  >
                    {tokenStateLabelHe(state)}
                  </span>
                </div>
                {expiresAtHuman ? (
                  <div className="text-xs text-muted-foreground">
                    תאריך תפוגה:{" "}
                    <span dir="ltr" className="font-mono">
                      {expiresAtHuman}
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    עדיין לא חובר. עבור ל-/integrations ולחץ &quot;התחבר ל-Meta&quot;.
                  </div>
                )}
                {state.kind === "critical" ||
                state.kind === "expired" ||
                state.kind === "warning" ? (
                  <div className="rounded-md border border-current/20 bg-background/60 p-3 text-xs">
                    <p className="font-semibold">איך מחדשים?</p>
                    <ol className="mt-1 list-inside list-decimal space-y-1 text-muted-foreground">
                      <li>
                        עבור ל{" "}
                        <Link
                          href="/integrations"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          /integrations
                        </Link>{" "}
                        → &quot;נתק חיבור&quot; → &quot;התחבר ל-Meta&quot;.
                      </li>
                      <li>
                        אשר את ההרשאות ב-Meta — הטוקן ייכתב מוצפן אוטומטית,
                        תאריך התפוגה החדש יופיע כאן.
                      </li>
                    </ol>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })()}

        <Card id="agent-mode">
          <CardHeader>
            <CardTitle>מצב פעולת הסוכן</CardTitle>
            <CardDescription>
              שולט במה הסוכן רשאי לעשות. ברירת מחדל: טיוטות (HITL). מעבר ל-
              &quot;פעולה&quot; פותח כתיבה ישירה ל-Meta אחרי אישור ב-/approvals.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={setAgentModeAction}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <input type="hidden" name="id" value={business.id} />
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="agent_mode">מצב נוכחי</Label>
                <select
                  id="agent_mode"
                  name="agent_mode"
                  defaultValue={business.agent_mode}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="insight">
                    תובנות בלבד — קריאה וניתוח, ללא כתיבה
                  </option>
                  <option value="draft">
                    טיוטות — כותב הצעות ל-/approvals, ממתין לאישור (ברירת מחדל)
                  </option>
                  <option value="action">
                    פעולה — מבצע אחרי אישור ב-/approvals
                  </option>
                </select>
              </div>
              <Button type="submit" size="sm">
                שמור מצב
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>נכסי Meta של העסק הפעיל</CardTitle>
            <CardDescription>
              חשבון המודעות + ה-Page נקבעים ב-/integrations מתוך הנכסים שנמצאו
              ב-OAuth. שם העסק והתקציב החודשי עברו ל-/business-knowledge.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* RTL rule: parent <dd> stays in document RTL direction. Only
                the LTR code/ID is wrapped in `.mono-ltr` (which sets
                `dir:ltr` + `unicode-bidi: isolate`). Mixing LTR onto the
                whole row would flip the Hebrew "ערוך ב-..." link to the
                wrong side of the separator. */}
            <dl className="grid grid-cols-1 gap-y-2 gap-x-6 text-[13.5px] sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">שם עסק</dt>
              <dd className="font-medium">
                {business.name}
                <span className="mx-2 text-muted-foreground/60">·</span>
                <Link
                  href="/business-knowledge"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  ערוך ב-העסק שלי
                </Link>
              </dd>
              <dt className="text-muted-foreground">Meta Ad Account ID</dt>
              <dd>
                <span className="mono-ltr text-[12.5px]">
                  {business.meta_ad_account_id}
                </span>
                <span className="mx-2 text-muted-foreground/60">·</span>
                <Link
                  href="/integrations"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  שנה ב-integrations
                </Link>
              </dd>
              <dt className="text-muted-foreground">Meta Page ID</dt>
              <dd>
                {business.meta_page_id ? (
                  <span className="mono-ltr text-[12.5px]">
                    {business.meta_page_id}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    — לא נבחר עדיין —
                  </span>
                )}
                <span className="mx-2 text-muted-foreground/60">·</span>
                <Link
                  href="/integrations"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  שנה ב-integrations
                </Link>
              </dd>
              <dt className="text-muted-foreground">תקציב חודשי (₪)</dt>
              <dd>
                {business.monthly_budget_ils
                  ? `₪${Number(business.monthly_budget_ils).toLocaleString("he-IL")}`
                  : "— לא הוגדר —"}
                <span className="mx-2 text-muted-foreground/60">·</span>
                <Link
                  href="/business-knowledge"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  ערוך ב-העסק שלי
                </Link>
              </dd>
              <dt className="text-muted-foreground">מזהה עסק</dt>
              <dd>
                <span className="mono-ltr text-[12.5px]">{business.id}</span>
              </dd>
            </dl>
            {error ? (
              <p className="mt-4 text-sm text-destructive">{error}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card id="seasonal">
          <CardHeader>
            <CardTitle>עונתיות (חלונות ידניים)</CardTitle>
            <CardDescription>
              חלונות שמכפילים את התקציב החודשי בתקופות מוגדרות (פסח, BFCM, חזרה
              ללימודים, וכו&apos;). הסוכן משתמש בזה ב-pace monitor וב-§T10
              demand-driven raise. מקבץ חופף = מכפלה של המכפילים. ל-v2 (War
              Chest) תתווסף למידה אוטומטית עם{" "}
              <code dir="ltr">confidence=&quot;learned&quot;</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {(() => {
              const hintsForm: SeasonalHintsForm = {
                windows: (business.seasonal_hints?.windows ??
                  []) as SeasonalHintsForm["windows"],
              };
              const overlaps = overlappingPairs(hintsForm);
              const extreme = overlaps.find(
                (o) => o.product > 2.0 || o.product < 0.5,
              );
              if (!overlaps.length) return null;
              return (
                <div
                  className={`rounded-md border p-3 text-xs ${
                    extreme
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : "border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-300"
                  }`}
                >
                  <p className="font-semibold">חלונות חופפים זוהו:</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {overlaps.map((o, i) => (
                      <li key={i}>
                        {o.a.name} × {o.b.name} → מכפלה ×{o.product.toFixed(2)}
                      </li>
                    ))}
                  </ul>
                  {extreme ? (
                    <p className="mt-2">
                      מכפלה מחוץ לטווח [0.5, 2.0] — ודא שזה באמת מה שאתה מתכוון
                      אליו.
                    </p>
                  ) : (
                    <p className="mt-2">לא חוסם; רק מודיע על ההשלכה.</p>
                  )}
                </div>
              );
            })()}

            {(business.seasonal_hints?.windows ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                עדיין לא הגדרת חלונות עונתיים. הסוכן ישתמש בתקציב החודשי המלא.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="text-right text-xs uppercase text-muted-foreground">
                      <th className="pb-2 font-medium">שם</th>
                      <th className="pb-2 font-medium">מתאריך</th>
                      <th className="pb-2 font-medium">עד תאריך</th>
                      <th className="pb-2 font-medium">מכפיל</th>
                      <th className="pb-2 font-medium">מקור</th>
                      <th className="pb-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(business.seasonal_hints?.windows ?? []).map((w, i) => (
                      <tr
                        key={`${w.name}-${w.start}-${i}`}
                        className="border-t"
                      >
                        <td className="py-2">{w.name}</td>
                        <td className="py-2" dir="ltr">
                          {w.start}
                        </td>
                        <td className="py-2" dir="ltr">
                          {w.end}
                        </td>
                        <td className="py-2" dir="ltr">
                          ×{Number(w.multiplier).toFixed(2)}
                        </td>
                        <td className="py-2">
                          <Badge
                            variant={
                              w.confidence === "learned"
                                ? "secondary"
                                : "outline"
                            }
                            className="text-[10px]"
                          >
                            {w.confidence === "learned"
                              ? "נלמד אוטומטית"
                              : "ידני"}
                          </Badge>
                        </td>
                        <td className="py-2 text-left">
                          {w.confidence === "learned" ? (
                            <span
                              className="text-xs text-muted-foreground"
                              title="windows אוטומטיים נדחים ל-War Chest v2"
                            >
                              נעול
                            </span>
                          ) : (
                            <form action={removeSeasonalWindowAction}>
                              <input
                                type="hidden"
                                name="id"
                                value={business.id}
                              />
                              <input type="hidden" name="index" value={i} />
                              <Button
                                type="submit"
                                variant="ghost"
                                size="sm"
                                className="text-destructive"
                              >
                                מחק
                              </Button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <form
              action={addSeasonalWindowAction}
              className="flex flex-col gap-3 rounded-md border border-dashed p-3"
            >
              <input type="hidden" name="id" value={business.id} />
              <p className="text-sm font-medium">הוסף חלון חדש</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="window_name">שם החלון</Label>
                  <Input
                    id="window_name"
                    name="window_name"
                    placeholder="לדוגמה: פסח 2026"
                    maxLength={60}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="window_multiplier">מכפיל</Label>
                  <Input
                    id="window_multiplier"
                    name="window_multiplier"
                    type="number"
                    min="0.1"
                    max="3.0"
                    step="0.05"
                    placeholder="1.3"
                    className="text-right font-mono"
                    required
                  />
                  {/* Hint stays in RTL context (no dir override), reads
                      naturally right-to-left. */}
                  <span className="text-[11.5px] text-muted-foreground">
                    לעונה חזקה השתמש ב-1.3 · לעונה חלשה ב-0.7
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="window_start">מתאריך</Label>
                  <Input
                    id="window_start"
                    name="window_start"
                    type="date"
                    required
                    dir="ltr"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="window_end">עד תאריך</Label>
                  <Input
                    id="window_end"
                    name="window_end"
                    type="date"
                    required
                    dir="ltr"
                  />
                </div>
              </div>
              <div>
                <Button type="submit" variant="outline">
                  הוסף
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
