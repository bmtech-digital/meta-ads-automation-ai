import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Globe,
  Instagram,
  ListChecks,
  Upload,
} from "lucide-react";
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
import { Shell, PageHeader, SectionHeader } from "@/components/shell";
import { GeoTargetingEditor } from "@/components/geo-targeting-editor";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import type {
  BusinessKnowledge as BK,
  BusinessKnowledgeUpsert,
  Product,
  Vertical,
} from "@/lib/db/types";
import {
  VERTICALS,
  VERTICAL_LABELS_HE,
  deriveKpiFromVertical,
} from "@/lib/kpi";
import { KpiTargetEditor } from "@/components/kpi-target-editor";
import { AiweonImportButton } from "@/components/aiweon-import-button";
import { ServiceResearchButton } from "@/components/service-research-button";
import { ServiceAudienceButton } from "@/components/service-audience-button";
import { ServiceTargetEditor } from "@/components/service-target-editor";
import {
  getRecommendation,
  OBJECTIVE_HE,
  CHANNEL_HE,
  CREATIVE_FORMAT_HE,
} from "@/lib/service-campaign-recommendations";
import {
  businessKnowledgeFormSchema,
  parseProductsRaw,
  splitCsv,
} from "@/lib/schemas/business-knowledge";
import {
  BusinessKnowledgeFormShell,
  FieldErrorMessage,
  type SaveBusinessKnowledgeState,
} from "./form-shell";
import {
  estimateCPL,
  matchSubVertical,
  monthOf,
  pickGeoTier,
  rankSubVerticals,
  SUBVERTICALS,
} from "@/lib/cpl-infrastructure";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "העסק שלי" };

async function saveKnowledgeAction(
  _prev: SaveBusinessKnowledgeState,
  formData: FormData,
): Promise<SaveBusinessKnowledgeState> {
  "use server";
  const session = await getAuth().getSession();
  if (!session) redirect("/login?next=/business-knowledge");

  const business_id = String(formData.get("business_id") ?? "");
  if (!business_id) redirect("/business-knowledge?error=missing_business_id");

  const parsed = businessKnowledgeFormSchema.safeParse({
    vertical: formData.get("vertical") ?? "",
    website_url: formData.get("website_url") ?? "",
    service_regions: splitCsv(formData.get("service_regions")),
    geo_targeting: String(formData.get("geo_targeting") ?? ""),
    customer_age_min: formData.get("customer_age_min") ?? "",
    customer_age_max: formData.get("customer_age_max") ?? "",
    products_raw: formData.get("products_raw") ?? "",
    delivery_time_days: formData.get("delivery_time_days") ?? "",
    // Season-name arrays were removed from the UI in favor of structured
    // seasonal windows on /settings (which carry multipliers). The schema
    // still expects them, so we pass empty arrays here.
    strong_seasons: [],
    weak_seasons: [],
    competitors: splitCsv(formData.get("competitors")),
    ideal_customer: formData.get("ideal_customer") ?? "",
    main_pain: formData.get("main_pain") ?? "",
    common_objections: formData.get("common_objections") ?? "",
    usp: formData.get("usp") ?? "",
    what_worked_before: formData.get("what_worked_before") ?? "",
    what_failed_before: formData.get("what_failed_before") ?? "",
    brand_tone: formData.get("brand_tone") ?? "",
    brand_forbidden_words: splitCsv(formData.get("brand_forbidden_words")),
    target_cpa_ils: formData.get("target_cpa_ils") ?? "",
    target_cpl_ils: formData.get("target_cpl_ils") ?? "",
    target_roas: formData.get("target_roas") ?? "",
    brief_active_offer: formData.get("brief_active_offer") ?? "",
    brief_deadline_date: formData.get("brief_deadline_date") ?? "",
    brief_hands_off_campaign_ids: splitCsv(
      formData.get("brief_hands_off_campaign_ids"),
    ),
    brief_notes: formData.get("brief_notes") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const name = issue.path[0]?.toString() ?? "_form";
      if (!fieldErrors[name]) fieldErrors[name] = issue.message;
    }
    const firstErrorField =
      parsed.error.issues[0]?.path[0]?.toString() ?? "";
    return {
      status: "error",
      fieldErrors,
      firstErrorField,
    };
  }

  const d = parsed.data;
  const products: Product[] | null = parseProductsRaw(d.products_raw);
  const vertical = d.vertical as Vertical | null;

  const questionnaire_answers: Record<string, unknown> = {};
  const qFields = {
    ideal_customer: d.ideal_customer,
    main_pain: d.main_pain,
    common_objections: d.common_objections,
    usp: d.usp,
    what_worked_before: d.what_worked_before,
    what_failed_before: d.what_failed_before,
  };
  for (const [k, v] of Object.entries(qFields)) {
    if (v && v.trim() !== "") questionnaire_answers[k] = v;
  }

  const brand_voice: Record<string, unknown> = {};
  if (d.brand_tone) brand_voice.tone = d.brand_tone;
  if (d.brand_forbidden_words && d.brand_forbidden_words.length > 0) {
    brand_voice.forbidden_words = d.brand_forbidden_words;
  }

  const payload: BusinessKnowledgeUpsert = {
    business_id,
    vertical,
    website_url: d.website_url,
    service_regions: d.service_regions,
    geo_targeting: d.geo_targeting,
    customer_age_min: d.customer_age_min,
    customer_age_max: d.customer_age_max,
    products,
    delivery_time_days: d.delivery_time_days,
    strong_seasons: d.strong_seasons,
    weak_seasons: d.weak_seasons,
    questionnaire_answers:
      Object.keys(questionnaire_answers).length > 0
        ? questionnaire_answers
        : null,
    brand_voice: Object.keys(brand_voice).length > 0 ? brand_voice : null,
    competitors: d.competitors,
  };

  const db = getDataClient();
  await db.upsertBusinessKnowledge(payload);
  await db.setPrimaryKpi(business_id, deriveKpiFromVertical(vertical));

  // Mirror the operator-facing name + budget on the businesses row (these
  // fields used to live on /settings, moved here per UX cleanup).
  const profileName = String(formData.get("business_name") ?? "").trim();
  const profileBudgetRaw = String(formData.get("monthly_budget_ils") ?? "").trim();
  const profileBudget =
    profileBudgetRaw === "" ? null : Number(profileBudgetRaw);
  if (profileName) {
    await db.updateBusinessProfile(business_id, {
      name: profileName,
      monthly_budget_ils:
        profileBudget !== null && Number.isFinite(profileBudget)
          ? profileBudget
          : null,
      target_cpa_ils: d.target_cpa_ils,
      target_cpl_ils: d.target_cpl_ils,
      target_roas: d.target_roas,
    });
  }

  // Monthly brief — separate row write because the brief deserves its own
  // history (operator might revise mid-month without touching budget/name).
  // Server-stamps `month` to the current Asia/Jerusalem YYYY-MM so the agent
  // can detect stale briefs without trusting operator timezones.
  const briefHasContent =
    (d.brief_active_offer && d.brief_active_offer.length > 0) ||
    (d.brief_deadline_date && d.brief_deadline_date.length > 0) ||
    (d.brief_hands_off_campaign_ids &&
      d.brief_hands_off_campaign_ids.length > 0) ||
    (d.brief_notes && d.brief_notes.length > 0);
  if (briefHasContent) {
    const now = new Date();
    const ilFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
    });
    const month = ilFormatter.format(now); // "YYYY-MM" in Israel time
    await db.setMonthlyBrief(business_id, {
      month,
      active_offer: d.brief_active_offer || null,
      deadline_date: d.brief_deadline_date || null,
      hands_off_campaign_ids: d.brief_hands_off_campaign_ids ?? null,
      notes: d.brief_notes || null,
    });
  } else {
    // All fields empty — clear the brief.
    await db.setMonthlyBrief(business_id, null);
  }

  redirect("/business-knowledge?saved=1");
}

export default async function BusinessKnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/business-knowledge");

  const { error, saved } = await searchParams;
  const db = getDataClient();
  const business = await getActiveBusiness();

  if (!business) {
    return (
      <Shell active="/business-knowledge">
        <PageHeader eyebrow="העסק שלי" title="פרופיל העסק" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק פעיל</CardTitle>
            <CardDescription>
              עבור ל-/integrations והתחבר ל-Meta — חשבון המודעות הראשון שייבחר
              יהיה העסק הפעיל.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const k = await db.getBusinessKnowledge(business.id);
  // Per-vertical benchmark bands — surfaced next to each target input so the
  // operator sees "what's realistic" before typing a number. The agent uses
  // the same data via §T-2 reality-check; rendering it here makes the
  // human's typing pass through the same lens.

  const productsText = k?.products
    ? k.products
        .map((p) => (p.description ? `${p.name} — ${p.description}` : p.name))
        .join("\n")
    : "";

  const q = (k?.questionnaire_answers ?? {}) as Record<
    string,
    string | undefined
  >;
  const bv = (k?.brand_voice ?? {}) as {
    tone?: string;
    forbidden_words?: string[];
  };

  return (
    <Shell active="/business-knowledge">
      <PageHeader
        eyebrow="העסק שלי"
        title={business.name}
        subtitle="פרופיל העסק שהסוכן קורא לפני כל ריצה. אפשר למלא ידנית, או לבקש מהסוכן לשאוב את המידע מ-Instagram, מהאתר, או מבריף."
        actions={
          <div className="flex items-center gap-2">
            {saved ? <Badge>נשמר ✓</Badge> : null}
            {k?.last_refreshed_at ? (
              <span className="text-xs text-muted-foreground">
                עודכן {new Date(k.last_refreshed_at).toLocaleString("he-IL")}
              </span>
            ) : null}
          </div>
        }
      />

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <ImportOptions />

      <BusinessKnowledgeFormShell
        action={saveKnowledgeAction}
        className="flex flex-col gap-6"
      >
        <input type="hidden" name="business_id" value={business.id} />

        <Card>
          <CardHeader>
            <CardTitle>פרטי העסק</CardTitle>
            <CardDescription>
              שם תצוגה ותקציב חודשי. השם משמש את בורר העסקים בנאב, התקציב משמש
              את ה-pace monitor.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="business_name">שם העסק</Label>
              <Input
                id="business_name"
                name="business_name"
                defaultValue={business.name}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="monthly_budget_ils">תקציב פרסום חודשי (₪)</Label>
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
                התקציב היומי נגזר אוטומטית (חודשי ÷ 30). תקרה חודשית של הסוכן.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>יעדי ביצוע</CardTitle>
            <CardDescription>
              מספר אחד הוא הקובע: מתי הסוכן יחליט שהקמפיין שלך{" "}
              <strong>טוב</strong> או <strong>יקר מדי</strong>. מלא את היעד
              שמתאים לסוג העסק שלך — את שאר השדות אפשר להשאיר ריקים.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <KpiTargetEditor
                kpi="cpa"
                vertical={k?.vertical ?? null}
                defaultValue={business.target_cpa_ils ?? null}
                inputName="target_cpa_ils"
                label="יעד עלות להמרה (CPA) ₪"
                helpText="כשיש לך מטרה לרכישה / קנייה / הרשמה."
              />
              <KpiTargetEditor
                kpi="cpl"
                vertical={k?.vertical ?? null}
                defaultValue={business.target_cpl_ils ?? null}
                inputName="target_cpl_ils"
                label="יעד עלות לליד (CPL) ₪"
                helpText="כשהמטרה היא לידים / השארת פרטים."
              />
              <KpiTargetEditor
                kpi="roas"
                vertical={k?.vertical ?? null}
                defaultValue={business.target_roas ?? null}
                inputName="target_roas"
                label="יעד החזר על הפרסום (ROAS)"
                helpText="ל-eCommerce: כמה ₪ הכנסה אתה רוצה לכל ₪ פרסום."
              />
            </div>
            <p className="text-xs text-muted-foreground">
              הסיווג (טוב / בטווח / מתחת לממוצע / לא ריאלי) מתעדכן בזמן אמת
              לפי הענף שבחרת. אם אתה לא בטוח — השאר ריק והסוכן יציע יעד עם
              מחקר ב-set_kpi_target.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>תכנון חודשי</CardTitle>
            <CardDescription>
              ההקשר העסקי שלך לחודש הזה — הסוכן קורא את זה לפני כל הצעה
              ומשלב את התשובות ב-rationale. בלי זה הוא ממליץ לפי המספרים
              בלבד, בלי לדעת מה אתה מנסה להשיג החודש.
              {business.monthly_brief?.month ? (
                <span className="ms-2 text-xs">
                  (הבריף הנוכחי מסומן לחודש{" "}
                  <span dir="ltr" className="font-mono">
                    {business.monthly_brief.month}
                  </span>
                  )
                </span>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="brief_active_offer">
                ההצעה הפעילה החודש
              </Label>
              <Input
                id="brief_active_offer"
                name="brief_active_offer"
                defaultValue={
                  business.monthly_brief?.active_offer ?? ""
                }
                placeholder="לדוגמה: מבצע 30% הנחה עד 15 במאי / השקת קורס חדש"
              />
              <p className="text-xs text-muted-foreground">
                הסוכן ישלב את זה בקופי החדש שיציע, ויהיה רגיש לכך שהוא נגמר
                בתאריך מסוים.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="brief_deadline_date">
                תאריך סיום (אם רלוונטי)
              </Label>
              <Input
                id="brief_deadline_date"
                name="brief_deadline_date"
                type="date"
                defaultValue={
                  business.monthly_brief?.deadline_date ?? ""
                }
              />
              <FieldErrorMessage name="brief_deadline_date" />
              <p className="text-xs text-muted-foreground">
                הסוכן יתאים את עוצמת ההמלצות (urgency) ככל שהתאריך מתקרב.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="brief_hands_off_campaign_ids">
                קמפיינים שאתה לא רוצה שיגעו בהם
              </Label>
              <Input
                id="brief_hands_off_campaign_ids"
                name="brief_hands_off_campaign_ids"
                defaultValue={
                  business.monthly_brief?.hands_off_campaign_ids?.join(
                    ", ",
                  ) ?? ""
                }
                placeholder="120201234567890, 120201234567891"
                dir="ltr"
                className="text-left font-mono"
              />
              <p className="text-xs text-muted-foreground">
                מזהי Meta מופרדים בפסיקים. הסוכן לא יציע scale / pause / refresh
                על הקמפיינים האלה — אבל ימשיך לדווח עליהם.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="brief_notes">הערות חופשיות לחודש</Label>
              <textarea
                id="brief_notes"
                name="brief_notes"
                rows={3}
                defaultValue={business.monthly_brief?.notes ?? ""}
                placeholder="לדוגמה: השבוע מתמקדים בליד לאסיפת בעלי מניות, לא במכירה ישירה. הקמפיינים החדשים יחכו לסבב הבא."
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                כל מה שחשוב לסוכן לדעת לחודש הזה. נקרא לפני כל הצעה.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              בלי המספר הזה הסוכן ישווה לממוצע השוק במקום ליעד שלך — וזה משאיר
              אותו עם אבחנה כללית במקום אבחנה ספציפית לעסק.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>טופס מובנה</CardTitle>
            <CardDescription>
              שדות עובדתיים. vertical קובע את ה־KPI הראשי שבו הסוכן מודד
              ביצועים.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="vertical">Vertical</Label>
                <select
                  id="vertical"
                  name="vertical"
                  defaultValue={k?.vertical ?? ""}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">— בחר —</option>
                  {VERTICALS.map((v) => (
                    <option key={v} value={v}>
                      {VERTICAL_LABELS_HE[v]}
                    </option>
                  ))}
                </select>
                <FieldErrorMessage name="vertical" />
                <p className="text-xs text-muted-foreground">
                  KPI נגזר: eCommerce→ROAS · לידים→CPL · Awareness→CPM ·
                  אפליקציה→CPI
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="website_url">כתובת אתר</Label>
                <Input
                  id="website_url"
                  name="website_url"
                  defaultValue={k?.website_url ?? ""}
                  placeholder="https://example.com"
                  dir="ltr"
                  className="text-left"
                />
                <FieldErrorMessage name="website_url" />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="service_regions">אזורי שירות (כללי)</Label>
              <Input
                id="service_regions"
                name="service_regions"
                defaultValue={(k?.service_regions ?? []).join(", ")}
                placeholder="ישראל, ארה״ב (טקסט חופשי, רמת מדינה — נשמר לשעבר)"
              />
              <p className="text-xs text-muted-foreground">
                שדה לגאסי. גיאוגרפיה אמיתית של קמפיינים נקבעת בעורך מטה.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label>גיאוגרפיה לקמפיינים — ערים, רדיוסים והחרגות</Label>
              <p className="text-xs text-muted-foreground">
                נקרא ע״י הסוכן בכל הצעת קמפיין חדש או קהל שמור.
                בלי הגדרה — Meta מקבל ״כל ישראל״ ומפזר תקציב לאזורים שלא רלוונטיים אליך.
                הוסף ערים ספציפיות (city key מ-Ads Manager), רדיוסים סביב נקודות,
                והחרגות (לדוגמה אזור עם איכות לידים גרועה).
              </p>
              <GeoTargetingEditor initialValue={k?.geo_targeting ?? null} />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer_age_min">גיל לקוח (מ-)</Label>
                <Input
                  id="customer_age_min"
                  name="customer_age_min"
                  type="number"
                  min="13"
                  max="80"
                  defaultValue={k?.customer_age_min ?? ""}
                />
                <FieldErrorMessage name="customer_age_min" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer_age_max">גיל לקוח (עד)</Label>
                <Input
                  id="customer_age_max"
                  name="customer_age_max"
                  type="number"
                  min="13"
                  max="80"
                  defaultValue={k?.customer_age_max ?? ""}
                />
                <FieldErrorMessage name="customer_age_max" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="delivery_time_days">זמן אספקה (ימים)</Label>
                <Input
                  id="delivery_time_days"
                  name="delivery_time_days"
                  type="number"
                  min="0"
                  defaultValue={k?.delivery_time_days ?? ""}
                />
                <FieldErrorMessage name="delivery_time_days" />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="products_raw">השירותים שלי</Label>
                <AiweonImportButton />
              </div>
              <textarea
                id="products_raw"
                name="products_raw"
                defaultValue={productsText}
                rows={6}
                placeholder={
                  "שורה לכל שירות נפרד. פורמט: שם — תיאור קצר\n" +
                  "דוגמה:\n" +
                  "סוכני AI — פתרונות אוטומציה עסקית מבוססי GenAI\n" +
                  "סרטוני AI — הפקת סרטוני שיווק AI-generated\n" +
                  "קמפיינר AI — פלטפורמת ניהול קמפיינים אוטומטית\n" +
                  "משפיענים — שיתופי פעולה עם כוכבי אינסטגרם"
                }
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                כל שירות בשורה נפרדת. הסוכן בוחר תת-ורטיקל וטווח מחיר לפי המילים
                שמופיעות כאן — ככל שהן ספציפיות יותר, האומדן מדויק יותר.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="competitors">מתחרים</Label>
              <Input
                id="competitors"
                name="competitors"
                defaultValue={(k?.competitors ?? []).join(", ")}
                placeholder="שמות מתחרים, מופרדים בפסיקים"
              />
              <p className="text-xs text-muted-foreground">
                חלונות עונתיים עם מכפילים מנוהלים ב-
                <Link
                  href="/settings#seasonal"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  הגדרות → עונתיות
                </Link>
                .
              </p>
            </div>
          </CardContent>
        </Card>

        <SubVerticalMatchCard knowledge={k} />

        <Card>
          <CardHeader>
            <CardTitle>שאלון מונחה</CardTitle>
            <CardDescription>
              שדות שיפוטיים. דלג על מה שעדיין לא ברור — אפשר למלא בהדרגה.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Questionnaire
              id="ideal_customer"
              label="לקוח אידיאלי"
              value={q.ideal_customer}
            />
            <Questionnaire
              id="main_pain"
              label="הכאב המרכזי שהמוצר פותר"
              value={q.main_pain}
            />
            <Questionnaire
              id="common_objections"
              label="התנגדויות נפוצות"
              value={q.common_objections}
            />
            <Questionnaire
              id="usp"
              label="יתרון תחרותי ייחודי (USP)"
              value={q.usp}
            />
            <Questionnaire
              id="what_worked_before"
              label="מה עבד בעבר בפרסום"
              value={q.what_worked_before}
            />
            <Questionnaire
              id="what_failed_before"
              label="מה נכשל בעבר בפרסום"
              value={q.what_failed_before}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>קול מותג</CardTitle>
            <CardDescription>משפיע על טקסטי קריאייטיב.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="brand_tone">טון</Label>
              <Input
                id="brand_tone"
                name="brand_tone"
                defaultValue={bv.tone ?? ""}
                placeholder="דוגמה: מקצועי, חם, בגובה העיניים"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="brand_forbidden_words">מילים אסורות</Label>
              <Input
                id="brand_forbidden_words"
                name="brand_forbidden_words"
                defaultValue={(bv.forbidden_words ?? []).join(", ")}
                placeholder="מופרד בפסיקים"
              />
            </div>
          </CardContent>
        </Card>

        <div className="sticky bottom-4 flex items-center gap-3 rounded-lg border bg-background/80 p-3 shadow-sm backdrop-blur">
          <Button type="submit">שמור</Button>
          <span className="text-xs text-muted-foreground">
            השינויים יוחלו על הריצה הבאה של הסוכן.
          </span>
        </div>
      </BusinessKnowledgeFormShell>
    </Shell>
  );
}

function ImportOptions() {
  return (
    <div className="mb-6">
      <SectionHeader
        title="איך תרצה למלא?"
        description="הסוכן יודע לשאוב את המידע באוטומציה — בחר מקור, או דלג להזנה ידנית למטה."
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <ImportCard
          icon={<Instagram size={20} className="text-pink-500" />}
          title="ייבוא מאינסטגרם"
          subtitle="ביו, תמונות, פרטי הפרופיל"
          status="soon"
        />
        <ImportCard
          icon={<Globe size={20} className="text-blue-500" />}
          title="ניתוח אתר"
          subtitle="הסוכן יקרא את האתר שלך וימלא"
          status="soon"
        />
        <ImportCard
          icon={<Upload size={20} className="text-amber-500" />}
          title="העלאת בריף"
          subtitle="מסמך עם מידע על העסק"
          status="soon"
        />
        <ImportCard
          icon={<ListChecks size={20} className="text-emerald-500" />}
          title="הזנה ידנית"
          subtitle="עונים על השאלון למטה"
          status="ready"
          href="#manual"
        />
      </div>
    </div>
  );
}

function ImportCard({
  icon,
  title,
  subtitle,
  status,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  status: "ready" | "soon";
  href?: string;
}) {
  const isReady = status === "ready";
  const inner = (
    <div
      className={
        "flex h-full flex-col items-start gap-2 rounded-lg p-4 transition-all duration-200 " +
        (isReady
          ? "glass-panel hover:-translate-y-0.5"
          : "glass-surface opacity-75")
      }
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted/60">
          {icon}
        </div>
        {!isReady ? (
          <Badge variant="outline" className="text-[10.5px]">
            בקרוב
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="text-[12px] text-muted-foreground">{subtitle}</span>
      </div>
    </div>
  );
  if (isReady && href) {
    return (
      <a href={href} className="block focus-visible:outline-none">
        {inner}
      </a>
    );
  }
  return inner;
}

function Questionnaire({
  id,
  label,
  value,
}: {
  id: string;
  label: string;
  value: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        name={id}
        defaultValue={value ?? ""}
        rows={3}
        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}

// Hebrew labels for sub-verticals — keep in sync with SUB_VERTICAL_HE in
// `web/src/app/page.tsx`. Single source of truth would be `lib/cpl-infrastructure.ts`
// but Hebrew strings belong in the UI layer per `web/CLAUDE.md` §1.
const SUB_VERTICAL_HE: Record<string, string> = {
  real_estate_residential: "נדל\"ן מגורים",
  real_estate_commercial: "נדל\"ן מסחרי",
  home_services: "שירותי בית (אינסטלטור / חשמלאי / וכו')",
  renovation_contractor: "קבלן שיפוצים",
  insurance_agent: "סוכן ביטוח",
  automotive_dealer: "סוכנות רכב",
  automotive_service: "מוסך / שירות רכב",
  beauty_aesthetic: "אסתטיקה / רפואה אסתטית",
  wellness_alt: "רפואה משלימה / וולנס",
  fitness_studio: "סטודיו / חדר כושר",
  dental_clinic: "מרפאת שיניים",
  private_clinic: "מרפאה פרטית",
  legal_personal: "עו\"ד אישי (גירושין / פלילי / נזיקין)",
  legal_corporate: "עו\"ד מסחרי",
  accounting_tax: "רואה חשבון / יועץ מס",
  education_private: "מורה / שיעורי עזר",
  education_university: "השכלה גבוהה",
  saas_horizontal: "SaaS כללי",
  saas_marketing_tech: "טכנולוגיית שיווק / Influencer-tech",
  saas_dev_tech: "טכנולוגיה למפתחים",
  agency_services: "סוכנות שיווק / שירותי שיווק",
  ai_chatbot_services: "סוכני AI / צ'אט-בוטים",
  ai_video_production: "הפקת סרטוני AI",
  ai_campaign_management: "ניהול קמפיינים AI",
  ecom_fashion: "אי-קומרס אופנה",
  ecom_beauty_products: "אי-קומרס טיפוח / קוסמטיקה",
  ecom_electronics: "אי-קומרס אלקטרוניקה",
  ecom_home_goods: "אי-קומרס מוצרי בית",
  ecom_food_supplements: "אי-קומרס תוספי תזונה",
  other: "אחר / לא מוגדר",
};

/**
 * SubVerticalMatchCard — post-save transparency for the operator. Shows:
 *
 *   1. The exact text the matcher scanned (products + ideal_customer + USP + pain),
 *   2. The sub-vertical that won + which words triggered it,
 *   3. The runners-up with their scores (so the operator sees what got considered),
 *   4. The competitors list from business_knowledge that the agent will anchor
 *      to in the `set_kpi_target` rationale,
 *   5. Hints when the match is weak ("fuzzy") or absent ("fallback").
 *
 * This is what the operator gets after they save the form — answers the
 * "how did you decide?" question that the agent's research proposals
 * sometimes hide. Mirrors `campaigner/lib/cpl_infrastructure.py`'s
 * `match_sub_vertical` + `rank_sub_verticals` exactly.
 */
function SubVerticalMatchCard({ knowledge }: { knowledge: BK | null }) {
  if (!knowledge) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>איך הסוכן יזהה את העסק שלך</CardTitle>
          <CardDescription>
            מלא קודם את "השירותים שלי" + השאלון המונחה. כשתשמור — נציג כאן מה
            התת-ורטיקל שהסוכן זיהה, אילו מילים הפעילו את ההתאמה, ואיזה טווח
            מחיר הוא ייקח לקמפיינים שלך.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const productsBlob = (knowledge.products ?? [])
    .map((p) => (p.description ? `${p.name} — ${p.description}` : p.name))
    .join("  ");
  const qa = (knowledge.questionnaire_answers ?? {}) as Record<
    string,
    string | undefined
  >;
  const scannedSnippets: Array<{ label: string; text: string }> = [];
  if (productsBlob) scannedSnippets.push({ label: "השירותים", text: productsBlob });
  if (qa.ideal_customer)
    scannedSnippets.push({ label: "לקוח אידיאלי", text: qa.ideal_customer });
  if (qa.usp) scannedSnippets.push({ label: "יתרון תחרותי", text: qa.usp });
  if (qa.main_pain)
    scannedSnippets.push({ label: "כאב מרכזי", text: qa.main_pain });

  const verticalForMatch = knowledge.vertical;
  const winner = matchSubVertical({
    vertical: verticalForMatch,
    products_raw: productsBlob || null,
    ideal_customer: qa.ideal_customer ?? null,
    usp: qa.usp ?? null,
    main_pain: qa.main_pain ?? null,
  });
  const ranked = rankSubVerticals(
    {
      vertical: verticalForMatch,
      products_raw: productsBlob || null,
      ideal_customer: qa.ideal_customer ?? null,
      usp: qa.usp ?? null,
      main_pain: qa.main_pain ?? null,
    },
    5,
  );

  const isFallback = winner.confidence_of_match === "fallback";
  const isFuzzy = winner.confidence_of_match === "fuzzy";
  const cell = SUBVERTICALS[winner.sub];
  const winnerHe = SUB_VERTICAL_HE[winner.sub] ?? winner.sub;

  return (
    <Card>
      <CardHeader>
        <CardTitle>איך הסוכן יזהה את העסק שלך</CardTitle>
        <CardDescription>
          זה מה שהסוכן רואה לפני כל ריצה. אם זה לא תואם — תוסיף או תחדד את
          השדות למעלה. הסוכן בוחר תת-ורטיקל אחד וטווח מחיר ספציפי לפיו.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Block 1: what the matcher scanned */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            מה נסרק
          </span>
          {scannedSnippets.length === 0 ? (
            <p className="rounded-md border border-dashed border-amber-300/60 bg-amber-50/40 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-200">
              עדיין אין מספיק טקסט. מלא לפחות "השירותים שלי" כדי שנדע לתת
              לך טווח מחיר ספציפי במקום ממוצע ענפי כללי.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {scannedSnippets.map((s) => (
                <li
                  key={s.label}
                  className="rounded-md border border-border/60 bg-background/40 px-3 py-1.5 text-xs"
                >
                  <span className="font-semibold text-muted-foreground">
                    {s.label}:
                  </span>{" "}
                  <span className="text-foreground/90">{s.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Block 2: winning sub-vertical + matched terms */}
        {!isFallback ? (
          <div
            className={
              "flex flex-col gap-2 rounded-md border px-3 py-2 " +
              (isFuzzy
                ? "border-amber-300/60 bg-amber-50/30 dark:border-amber-500/30 dark:bg-amber-950/20"
                : "border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-500/30 dark:bg-emerald-950/20")
            }
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                {isFuzzy ? "התאמה חלקית" : "תת-ורטיקל שזוהה"}
              </span>
              <span className="font-tabular text-[13px] font-bold">
                {winnerHe}
              </span>
            </div>
            <div className="text-[11.5px]">
              <span className="text-muted-foreground">
                מילים שהפעילו את ההתאמה:
              </span>{" "}
              {winner.matched_terms.length > 0
                ? winner.matched_terms.map((t, i) => (
                    <span
                      key={t}
                      className="inline-block rounded bg-foreground/10 px-1.5 py-0.5 me-1 mb-1 font-mono text-[10.5px]"
                    >
                      {t}
                    </span>
                  ))
                : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              טווח מחיר {cell.is_cpa ? "להמרה" : "לליד"}: ₪{cell.band_ils[0]}–₪
              {cell.band_ils[1]} (ממוצע ₪{cell.base_ils}, רמת ביטחון{" "}
              {cell.confidence === "high"
                ? "גבוהה"
                : cell.confidence === "medium"
                  ? "בינונית"
                  : "נמוכה"}
              )
            </div>
            {isFuzzy ? (
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                רק מילה אחת התאימה — הסוכן יסמוך על זה רק חלקית, ועדיין יציע
                לעשות מחקר חי לפני שמציע יעד. כדי להגביר ביטחון: הוסף שמות
                שירותים מובחנים יותר ב"השירותים שלי".
              </p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-md border border-amber-300/60 bg-amber-50/40 px-3 py-2 text-[11.5px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/20 dark:text-amber-200">
            אין התאמה ספציפית — הסוכן ייפול לטווח כללי לפי ה-vertical הראשי.
            הוסף תיאורי שירות יותר ספציפיים כדי שנתאים מחיר מדויק.
          </div>
        )}

        {/* Block 2.5: per-product breakdown — for multi-service businesses
            (Aiweon-style), show which sub-vertical EACH product maps to.
            This is the answer to "איזה מתחרים והאם הסוכן בכלל ניתח את הנכון". */}
        {(knowledge.products ?? []).length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              פירוט פר-שירות
            </span>
            <ul className="flex flex-col gap-1">
              {(knowledge.products ?? []).map((p) => {
                // Use the FULL business haystack (other products + qa fields)
                // plus this product's name as campaign_name → matches what
                // the agent does at runtime via §T-2.
                const otherProductsBlob = (knowledge.products ?? [])
                  .filter((x) => x.name !== p.name)
                  .map((x) =>
                    x.description ? `${x.name} — ${x.description}` : x.name,
                  )
                  .join("  ");
                const fullBusinessBlob = [
                  otherProductsBlob,
                  p.description
                    ? `${p.name} — ${p.description}`
                    : p.name,
                ]
                  .filter(Boolean)
                  .join("  ");
                const perProductMatch = matchSubVertical({
                  vertical: knowledge.vertical,
                  products_raw: fullBusinessBlob || null,
                  ideal_customer: qa.ideal_customer ?? null,
                  usp: qa.usp ?? null,
                  main_pain: qa.main_pain ?? null,
                  campaign_name: p.name,
                });
                const perCell = SUBVERTICALS[perProductMatch.sub];
                const perHe =
                  SUB_VERTICAL_HE[perProductMatch.sub] ?? perProductMatch.sub;
                const noMatch =
                  perProductMatch.confidence_of_match === "fallback";
                const hasResearch = !!p.research;
                const recommendation = getRecommendation(perProductMatch.sub);
                const kpiKind: "cpa" | "cpl" | "roas" = perCell.is_cpa
                  ? "cpa"
                  : "cpl";
                return (
                  <li
                    key={p.name}
                    className={
                      "rounded-md border px-3.5 py-3 text-[11.5px] " +
                      (hasResearch
                        ? "border-emerald-300/60 bg-emerald-50/30 dark:border-emerald-500/30 dark:bg-emerald-950/20"
                        : noMatch
                          ? "border-amber-300/50 bg-amber-50/30 dark:border-amber-500/30 dark:bg-amber-950/20"
                          : "border-border/60 bg-background/40")
                    }
                  >
                    {/* ── Header: name + sub-vertical ── */}
                    <div className="flex items-baseline justify-between gap-2 border-b border-border/40 pb-1.5">
                      <span className="text-[13px] font-semibold">{p.name}</span>
                      <span className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10.5px] text-muted-foreground">
                        {noMatch ? "לא זוהה" : perHe}
                      </span>
                    </div>

                    {/* ── Block 1: research (if exists) OR static band ── */}
                    <div className="mt-2">
                      {hasResearch && p.research ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-baseline justify-between gap-2 rounded border border-emerald-400/40 bg-emerald-100/40 px-2 py-1 dark:border-emerald-500/40 dark:bg-emerald-900/30">
                            <div className="flex flex-col">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                                מחקר שמור לשירות זה
                              </span>
                              <span className="text-[9.5px] text-emerald-700/80 dark:text-emerald-400/70">
                                {`₪${p.research.band_low_ils}–₪${p.research.band_high_ils} · ${p.research.sources.length} מקורות · ${p.research.confidence}`}
                              </span>
                            </div>
                            <span className="font-tabular text-[14px] font-bold text-emerald-900 dark:text-emerald-100">
                              ₪{p.research.market_average_ils.toLocaleString("he-IL")}
                            </span>
                          </div>
                          <div className="text-[9.5px] text-muted-foreground">
                            עודכן{" "}
                            {new Date(p.research.researched_at).toLocaleString(
                              "he-IL",
                            )}{" "}
                            · מילים: {p.research.matched_terms.slice(0, 3).join(", ")}
                          </div>
                        </div>
                      ) : !noMatch ? (
                        <div className="text-[10.5px] text-muted-foreground">
                          טווח {perCell.is_cpa ? "להמרה" : "לליד"} (אומדן):
                          ₪{perCell.band_ils[0]}–₪{perCell.band_ils[1]} · מילים:{" "}
                          {perProductMatch.matched_terms.slice(0, 3).join(", ")}
                        </div>
                      ) : (
                        <div className="text-[10.5px] text-amber-800 dark:text-amber-300">
                          השירות הזה לא מתאים לאף תת-ורטיקל קיים — הסוכן ייפול
                          ל-`other` במחקר ספציפי שלו. הוסף תיאור מפורט יותר.
                        </div>
                      )}
                      {!noMatch ? (
                        <div className="mt-1.5 flex flex-wrap items-start gap-2">
                          <ServiceResearchButton
                            serviceName={p.name}
                            hasExistingResearch={hasResearch}
                          />
                          <ServiceAudienceButton serviceName={p.name} />
                        </div>
                      ) : null}
                    </div>

                    {/* ── Block 2: per-service KPI target ── */}
                    {!noMatch ? (
                      <div className="mt-2.5 border-t border-border/40 pt-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          יעד {kpiKind === "cpa" ? "עלות להמרה" : "עלות לליד"} לשירות זה
                        </span>
                        <div className="mt-1">
                          <ServiceTargetEditor
                            serviceName={p.name}
                            kind={kpiKind}
                            currentValue={p.kpi_target?.value}
                            derivedFromResearchIls={
                              p.research?.market_average_ils
                            }
                          />
                        </div>
                        {p.kpi_target ? (
                          <div className="mt-0.5 text-[9.5px] text-muted-foreground">
                            הוגדר{" "}
                            {new Date(p.kpi_target.set_at).toLocaleString(
                              "he-IL",
                            )}{" "}
                            · {p.kpi_target.source === "manual" ? "ידני" : "ממוצע המחקר"}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* ── Block 3: campaign recommendations ── */}
                    {!noMatch ? (
                      <div className="mt-2.5 border-t border-border/40 pt-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          המלצת קמפיין לשירות זה
                        </span>
                        <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                          <div className="rounded border border-border/60 bg-background/60 px-2 py-1">
                            <div className="text-[9.5px] text-muted-foreground">סוג</div>
                            <div className="text-[11.5px] font-semibold">
                              {recommendation.campaign_type_he}
                            </div>
                          </div>
                          <div className="rounded border border-border/60 bg-background/60 px-2 py-1">
                            <div className="text-[9.5px] text-muted-foreground">
                              ערוץ + Objective
                            </div>
                            <div className="text-[11.5px] font-semibold">
                              {CHANNEL_HE[recommendation.channel]} ·{" "}
                              {OBJECTIVE_HE[recommendation.objective]}
                            </div>
                          </div>
                          <div className="rounded border border-border/60 bg-background/60 px-2 py-1">
                            <div className="text-[9.5px] text-muted-foreground">
                              תקציב יומי מינימלי
                            </div>
                            <div className="font-tabular text-[12.5px] font-bold">
                              ₪{recommendation.daily_budget_ils_min}
                            </div>
                          </div>
                          <div className="rounded border border-border/60 bg-background/60 px-2 py-1">
                            <div className="text-[9.5px] text-muted-foreground">
                              פורמטים מומלצים
                            </div>
                            <div className="text-[10.5px]">
                              {recommendation.creative_mix
                                .map((f) => CREATIVE_FORMAT_HE[f])
                                .join(" · ")}
                            </div>
                          </div>
                        </div>
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
                            למה זה?
                          </summary>
                          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
                            {recommendation.rationale_he}
                          </p>
                          <p className="mt-1 text-[10.5px] leading-snug text-foreground/90">
                            <span className="font-semibold">cold-start: </span>
                            {recommendation.cold_start_advice_he}
                          </p>
                        </details>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="text-[10.5px] text-muted-foreground/80">
              כשרץ קמפיין, הסוכן משתמש בשם הקמפיין מ-Meta (לדוגמה "סוכן AI -
              שלב 1") כדי לקבל את התת-ורטיקל הספציפי של אותו שירות, לא את
              הדומיננטי בעסק כולו. הקפד לתת שמות תיאוריים לקמפיינים.
            </p>
          </div>
        ) : null}

        {/* Block 3: runners-up so the operator sees what else was considered */}
        {ranked.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              גם נשקלו (אבל לא ניצחו)
            </span>
            <ul className="flex flex-col gap-1">
              {ranked.slice(1).map((r) => (
                <li
                  key={r.sub}
                  className="flex items-baseline justify-between rounded-md border border-border/60 bg-background/40 px-2.5 py-1 text-[11.5px]"
                >
                  <span>
                    {SUB_VERTICAL_HE[r.sub] ?? r.sub}
                    <span className="ms-2 text-[10px] text-muted-foreground">
                      [{r.matched_terms.join(", ")}]
                    </span>
                  </span>
                  <span className="text-[10.5px] text-muted-foreground">
                    {r.score} מילים תאמו
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[10.5px] text-muted-foreground/80">
              עסק שמספק כמה שירותים שונים יקבל כמה התאמות. הסוכן בוחר את
              החזקה ביותר — אבל ב-rationale של הצעת היעד הוא יציין במפורש איזה
              שירות הוא חישב לפיו.
            </p>
          </div>
        ) : null}

        {/* Block 4: competitors that the agent will anchor on */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            מתחרים שהסוכן יעגן אליהם
          </span>
          {(knowledge.competitors ?? []).length === 0 ? (
            <p className="rounded-md border border-dashed border-amber-300/60 bg-amber-50/40 px-3 py-2 text-[11.5px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-200">
              לא הוגדרו מתחרים. כשהסוכן יחקור יעד מחיר חי — הוא יחפש לפי
              vertical כללי במקום לפי שמות ספציפיים, וזה פחות מדויק. הוסף 2-5
              שמות בשדה "מתחרים".
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {knowledge.competitors!.map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-border/60 bg-background/60 px-2.5 py-0.5 text-[11px]"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
