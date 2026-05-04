import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shell, PageHeader } from "@/components/shell";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import type { BusinessKnowledgeUpsert, Product, Vertical } from "@/lib/db/types";
import { VERTICALS, VERTICAL_LABELS_HE, deriveKpiFromVertical } from "@/lib/kpi";
import {
  businessKnowledgeFormSchema,
  parseProductsRaw,
  splitCsv,
} from "@/lib/schemas/business-knowledge";

export const dynamic = "force-dynamic";

async function saveKnowledgeAction(formData: FormData) {
  "use server";
  const session = await getAuth().getSession();
  if (!session) redirect("/login?next=/business-knowledge");

  const business_id = String(formData.get("business_id") ?? "");
  if (!business_id) redirect("/business-knowledge?error=missing_business_id");

  const parsed = businessKnowledgeFormSchema.safeParse({
    vertical: formData.get("vertical") ?? "",
    website_url: formData.get("website_url") ?? "",
    service_regions: splitCsv(formData.get("service_regions")),
    customer_age_min: formData.get("customer_age_min") ?? "",
    customer_age_max: formData.get("customer_age_max") ?? "",
    products_raw: formData.get("products_raw") ?? "",
    delivery_time_days: formData.get("delivery_time_days") ?? "",
    strong_seasons: splitCsv(formData.get("strong_seasons")),
    weak_seasons: splitCsv(formData.get("weak_seasons")),
    competitors: splitCsv(formData.get("competitors")),
    ideal_customer: formData.get("ideal_customer") ?? "",
    main_pain: formData.get("main_pain") ?? "",
    common_objections: formData.get("common_objections") ?? "",
    usp: formData.get("usp") ?? "",
    what_worked_before: formData.get("what_worked_before") ?? "",
    what_failed_before: formData.get("what_failed_before") ?? "",
    brand_tone: formData.get("brand_tone") ?? "",
    brand_forbidden_words: splitCsv(formData.get("brand_forbidden_words")),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    redirect(`/business-knowledge?error=${encodeURIComponent(msg)}`);
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
    customer_age_min: d.customer_age_min,
    customer_age_max: d.customer_age_max,
    products,
    delivery_time_days: d.delivery_time_days,
    strong_seasons: d.strong_seasons,
    weak_seasons: d.weak_seasons,
    questionnaire_answers: Object.keys(questionnaire_answers).length > 0 ? questionnaire_answers : null,
    brand_voice: Object.keys(brand_voice).length > 0 ? brand_voice : null,
    competitors: d.competitors,
  };

  const db = getDataClient();
  await db.upsertBusinessKnowledge(payload);
  await db.setPrimaryKpi(business_id, deriveKpiFromVertical(vertical));

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
  const business = process.env.BUSINESS_ID
    ? await db.getBusinessById(process.env.BUSINESS_ID)
    : await db.getFirstBusiness();

  if (!business) {
    return (
      <Shell active="/business-knowledge" width="narrow">
        <PageHeader eyebrow="ידע עסקי" title="ידע עסקי" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק ב-DB</CardTitle>
            <CardDescription>הרץ migrations ו-seed לפני עריכת ידע עסקי.</CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const k = await db.getBusinessKnowledge(business.id);

  const productsText = k?.products
    ? k.products.map((p) => (p.description ? `${p.name} — ${p.description}` : p.name)).join("\n")
    : "";

  const q = (k?.questionnaire_answers ?? {}) as Record<string, string | undefined>;
  const bv = (k?.brand_voice ?? {}) as { tone?: string; forbidden_words?: string[] };

  return (
    <Shell active="/business-knowledge">
      <PageHeader
        eyebrow="ידע עסקי"
        title="ידע עסקי"
        subtitle="הסוכן קורא את השדות האלה לפני כל ריצה. ה־KPI הראשי נגזר אוטומטית מ־vertical."
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

      <form action={saveKnowledgeAction} className="flex flex-col gap-6">
        <input type="hidden" name="business_id" value={business.id} />

        <Card>
          <CardHeader>
            <CardTitle>טופס מובנה</CardTitle>
            <CardDescription>
              שדות עובדתיים. vertical קובע את ה־KPI הראשי שבו הסוכן מודד ביצועים.
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
                <p className="text-xs text-muted-foreground">
                  KPI נגזר: eCommerce→ROAS · לידים→CPL · Awareness→CPM · אפליקציה→CPI
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
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="service_regions">אזורי שירות</Label>
              <Input
                id="service_regions"
                name="service_regions"
                defaultValue={(k?.service_regions ?? []).join(", ")}
                placeholder="תל אביב, חיפה, מרכז (מופרד בפסיקים)"
              />
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
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="products_raw">מוצרים / שירותים</Label>
              <textarea
                id="products_raw"
                name="products_raw"
                defaultValue={productsText}
                rows={4}
                placeholder={"שורה לכל מוצר. פורמט: שם — תיאור קצר\nדוגמה: קורס AI למנהלים — 8 מפגשים, 3000₪"}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="strong_seasons">עונות חזקות</Label>
                <Input
                  id="strong_seasons"
                  name="strong_seasons"
                  defaultValue={(k?.strong_seasons ?? []).join(", ")}
                  placeholder="פסח, חנוכה, ספטמבר"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="weak_seasons">עונות חלשות</Label>
                <Input
                  id="weak_seasons"
                  name="weak_seasons"
                  defaultValue={(k?.weak_seasons ?? []).join(", ")}
                  placeholder="אוגוסט, סוכות"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="competitors">מתחרים</Label>
              <Input
                id="competitors"
                name="competitors"
                defaultValue={(k?.competitors ?? []).join(", ")}
                placeholder="שמות מתחרים, מופרדים בפסיקים"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>שאלון מונחה</CardTitle>
            <CardDescription>
              שדות שיפוטיים. דלג על מה שעדיין לא ברור — אפשר למלא בהדרגה.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Questionnaire id="ideal_customer" label="לקוח אידיאלי" value={q.ideal_customer} />
            <Questionnaire id="main_pain" label="הכאב המרכזי שהמוצר פותר" value={q.main_pain} />
            <Questionnaire id="common_objections" label="התנגדויות נפוצות" value={q.common_objections} />
            <Questionnaire id="usp" label="יתרון תחרותי ייחודי (USP)" value={q.usp} />
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
      </form>
    </Shell>
  );
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
