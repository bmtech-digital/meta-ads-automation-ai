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
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import type { SeasonalHint, SeasonalHints } from "@/lib/db/types";
import { businessSettingsFormSchema } from "@/lib/schemas/business-settings";
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

async function saveSettingsAction(formData: FormData) {
  "use server";
  const session = await getAuth().getSession();
  if (!session) redirect("/login?next=/settings");

  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/settings?error=missing_id");

  const parsed = businessSettingsFormSchema.safeParse({
    name: formData.get("name") ?? "",
    meta_ad_account_id: formData.get("meta_ad_account_id") ?? "",
    meta_page_id: formData.get("meta_page_id") ?? "",
    monthly_budget_ils: formData.get("monthly_budget_ils") ?? "",
  });

  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    redirect(`/settings?error=${encodeURIComponent(msg)}`);
  }

  await getDataClient().updateBusinessSettings(id, parsed.data);
  redirect("/settings?saved=1");
}

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
  const business = process.env.BUSINESS_ID
    ? await db.getBusinessById(process.env.BUSINESS_ID)
    : await db.getFirstBusiness();

  if (!business) {
    return (
      <Shell active="/settings">
        <PageHeader eyebrow="הגדרות" title="הגדרות עסק" />
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
        title="הגדרות עסק"
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
          const state = tokenExpiryState(business);
          const expiresAtIso = business.meta_access_token_expires_at;
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
                  {business.meta_auth_mode === "system_user_token"
                    ? "עסק זה משתמש ב-System User Token — אין תפוגה אוטומטית."
                    : "User Token נוכחי. תפוגה כל ~60 יום. חידוש ידני דרך Facebook Graph API Explorer או Meta Business Suite."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${tokenStateStyles(state)}`}
                  >
                    {tokenStateLabelHe(state)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    מצב אימות:{" "}
                    <span dir="ltr" className="font-mono">
                      {business.meta_auth_mode}
                    </span>
                  </span>
                </div>
                {expiresAtHuman ? (
                  <div className="text-xs text-muted-foreground">
                    תאריך תפוגה בפועל:{" "}
                    <span dir="ltr" className="font-mono">
                      {expiresAtHuman}
                    </span>
                  </div>
                ) : business.meta_auth_mode === "user_token" ? (
                  <div className="text-xs text-muted-foreground">
                    עדיין לא תועד תאריך תפוגה. הרץ{" "}
                    <code dir="ltr" className="font-mono">
                      campaigner rotate-token
                    </code>{" "}
                    כדי לאמת ולשמור את התפוגה דרך debug_token של Meta.
                  </div>
                ) : null}
                {state.kind === "critical" ||
                state.kind === "expired" ||
                state.kind === "warning" ? (
                  <div className="rounded-md border border-current/20 bg-background/60 p-3 text-xs">
                    <p className="font-semibold">איך מחדשים?</p>
                    <ol className="mt-1 list-inside list-decimal space-y-1 text-muted-foreground">
                      <li>
                        פתח{" "}
                        <a
                          href="https://developers.facebook.com/tools/explorer"
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          Graph API Explorer
                        </a>{" "}
                        → בחר את ה-App + Page המתאימים → צור User Token חדש.
                      </li>
                      <li>
                        החלף את <code dir="ltr">META_ACCESS_TOKEN</code>{" "}
                        ב-Secret Manager של הסביבה.
                      </li>
                      <li>
                        הרץ{" "}
                        <code dir="ltr" className="font-mono">
                          campaigner rotate-token
                        </code>{" "}
                        כדי לאמת ולעדכן את תאריך התפוגה ב-DB.
                      </li>
                    </ol>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })()}

        <Card>
          <CardHeader>
            <CardTitle>{business.name}</CardTitle>
            <CardDescription dir="ltr" className="font-mono text-xs">
              {business.id}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveSettingsAction} className="flex flex-col gap-4">
              <input type="hidden" name="id" value={business.id} />

              <div className="flex flex-col gap-2">
                <Label htmlFor="name">שם עסק</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={business.name}
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="meta_ad_account_id">Meta Ad Account ID</Label>
                  <Input
                    id="meta_ad_account_id"
                    name="meta_ad_account_id"
                    defaultValue={business.meta_ad_account_id}
                    dir="ltr"
                    className="text-left font-mono text-sm"
                    placeholder="act_1234567890"
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="meta_page_id">Meta Page ID</Label>
                  <Input
                    id="meta_page_id"
                    name="meta_page_id"
                    defaultValue={business.meta_page_id}
                    dir="ltr"
                    className="text-left font-mono text-sm"
                    required
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="monthly_budget_ils">
                  תקציב פרסום חודשי (₪)
                </Label>
                <Input
                  id="monthly_budget_ils"
                  name="monthly_budget_ils"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={business.monthly_budget_ils ?? ""}
                  placeholder="לדוגמה 1500"
                />
                <p className="text-xs text-muted-foreground">
                  התקציב היומי נגזר אוטומטית מהסכום החודשי (חודשי ÷ 30). הסוכן
                  משתמש בזה כתקרת הוצאה חודשית.
                </p>
              </div>

              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}

              <div className="flex gap-2">
                <Button type="submit">שמור</Button>
              </div>
            </form>
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
                    placeholder="1.3 לעונה חזקה, 0.7 לעונה חלשה"
                    dir="ltr"
                    className="text-left font-mono"
                    required
                  />
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
