"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type AudienceOption = {
  id: string;
  name: string;
  kind: "custom" | "saved" | "lookalike" | "special_ad";
  subtype: string | null;
  size_upper: number | null;
};

type KpiObjectiveFit = Record<string, string[]>;
const KPI_OBJECTIVE_FIT: KpiObjectiveFit = {
  cpl: ["OUTCOME_LEADS", "OUTCOME_ENGAGEMENT"],
  cpa: ["OUTCOME_SALES", "OUTCOME_LEADS"],
  roas: ["OUTCOME_SALES"],
  cpm: ["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT"],
  cpi: ["OUTCOME_APP_PROMOTION"],
};

const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_LEADS: "לידים (טופסי לידים בפייסבוק)",
  OUTCOME_ENGAGEMENT: "הודעות (Messenger / WhatsApp / IG DM)",
  OUTCOME_SALES: "מכירות (Pixel + Conversions)",
  OUTCOME_TRAFFIC: "תנועה לאתר",
  OUTCOME_AWARENESS: "מודעות (Reach)",
  OUTCOME_APP_PROMOTION: "התקנות אפליקציה",
};

const OPTIMIZATION_DEFAULTS: Record<string, string> = {
  OUTCOME_LEADS: "LEAD_GENERATION",
  OUTCOME_ENGAGEMENT: "CONVERSATIONS",
  OUTCOME_SALES: "OFFSITE_CONVERSIONS",
  OUTCOME_TRAFFIC: "LINK_CLICKS",
  OUTCOME_AWARENESS: "REACH",
  OUTCOME_APP_PROMOTION: "APP_INSTALLS",
};

const CTA_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "LEARN_MORE", label: "למידע נוסף" },
  { value: "SIGN_UP", label: "הרשמה" },
  { value: "CONTACT_US", label: "צור קשר" },
  { value: "MESSAGE_PAGE", label: "שלח הודעה (Messenger)" },
  { value: "WHATSAPP_MESSAGE", label: "WhatsApp" },
  { value: "SHOP_NOW", label: "קנה עכשיו" },
  { value: "DOWNLOAD", label: "הורדה" },
  { value: "APPLY_NOW", label: "הגש מועמדות" },
  { value: "SUBSCRIBE", label: "הירשם" },
];

export function NewCampaignForm({
  businessId,
  businessName,
  primaryKpi,
  targetCplIls,
  targetCpaIls,
  targetRoas,
  monthlyBudgetIls,
  dailyBudgetIls,
  metaPageId,
  websiteUrl,
  customerAgeMin,
  customerAgeMax,
  audiences,
}: {
  businessId: string;
  businessName: string;
  primaryKpi: string | null;
  targetCplIls: number | null;
  targetCpaIls: number | null;
  targetRoas: number | null;
  monthlyBudgetIls: number | null;
  dailyBudgetIls: number | null;
  metaPageId: string | null;
  websiteUrl: string | null;
  customerAgeMin: number | null;
  customerAgeMax: number | null;
  audiences: AudienceOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Sensible defaults from business state ----
  const kpiKey = (primaryKpi ?? "cpl").toLowerCase();
  const fitObjectives = KPI_OBJECTIVE_FIT[kpiKey] ?? Object.keys(OBJECTIVE_LABELS);
  const target =
    kpiKey === "cpl"
      ? targetCplIls
      : kpiKey === "cpa"
        ? targetCpaIls
        : kpiKey === "roas"
          ? targetRoas
          : null;
  const recommendedDaily =
    target != null && kpiKey !== "roas"
      ? Math.max(Number(target) * 3, dailyBudgetIls ?? 30)
      : (monthlyBudgetIls ?? 1500) / 30;

  // ---- Form state ----
  const [campaignName, setCampaignName] = useState(
    `${businessName}-${fitObjectives[0] === "OUTCOME_LEADS" ? "Leads" : "Engage"}-${new Date().toLocaleDateString("he-IL")}`,
  );
  const [objective, setObjective] = useState(fitObjectives[0] ?? "OUTCOME_LEADS");
  const [dailyBudget, setDailyBudget] = useState<number>(
    Math.round(recommendedDaily),
  );
  const [selectedAudienceIds, setSelectedAudienceIds] = useState<string[]>([]);
  const [excludedAudienceIds, setExcludedAudienceIds] = useState<string[]>([]);
  const [ageMin, setAgeMin] = useState<number>(customerAgeMin ?? 25);
  const [ageMax, setAgeMax] = useState<number>(customerAgeMax ?? 55);
  const [advantageAudience, setAdvantageAudience] = useState(true);

  // Copy
  const [headline, setHeadline] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [cta, setCta] = useState(
    objective === "OUTCOME_ENGAGEMENT" ? "MESSAGE_PAGE" : "LEARN_MORE",
  );
  const [linkUrl, setLinkUrl] = useState(websiteUrl ?? "https://weon.co.il");
  const [imagePath, setImagePath] = useState("");

  const optimizationGoal = OPTIMIZATION_DEFAULTS[objective] ?? "LINK_CLICKS";

  const kpiObjectiveAligned = useMemo(
    () => fitObjectives.includes(objective),
    [objective, fitObjectives],
  );

  function toggleAudience(id: string, list: "selected" | "excluded") {
    const setter =
      list === "selected" ? setSelectedAudienceIds : setExcludedAudienceIds;
    const current =
      list === "selected" ? selectedAudienceIds : excludedAudienceIds;
    if (current.includes(id)) {
      setter(current.filter((x) => x !== id));
    } else {
      setter([...current, id]);
    }
  }

  async function submit() {
    setError(null);
    if (!campaignName.trim()) return setError("שם קמפיין חובה");
    if (!headline.trim() || !primaryText.trim())
      return setError("כותרת + טקסט ראשי חובה");
    if (!linkUrl.trim()) return setError("URL יעד חובה");

    setSubmitting(true);
    try {
      const res = await fetch("/api/campaigns/new", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          campaign_name: campaignName.trim(),
          objective,
          daily_budget_ils: dailyBudget,
          custom_audience_ids: selectedAudienceIds,
          excluded_audience_ids: excludedAudienceIds,
          age_min: ageMin,
          age_max: ageMax,
          advantage_audience: advantageAudience,
          optimization_goal: optimizationGoal,
          headline: headline.trim(),
          primary_text: primaryText.trim(),
          cta,
          link_url: linkUrl.trim(),
          image_path: imagePath.trim() || null,
          page_id: metaPageId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? `שגיאה (${res.status})`);
        return;
      }
      // Approval created — jump to its detail page for final review/approve.
      startTransition(() =>
        router.push(`/approvals/${data.approval_id}`),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Campaign + objective */}
      <Section title="1. הגדרת קמפיין">
        <Field label="שם הקמפיין">
          <input
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field
          label={`מטרה (Objective) — ה-KPI שלך הוא ${(primaryKpi ?? "—").toUpperCase()}`}
        >
          <select
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className={inputCls}
          >
            {Object.entries(OBJECTIVE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
                {!fitObjectives.includes(k) ? " ⚠ לא תואם KPI" : ""}
              </option>
            ))}
          </select>
          {!kpiObjectiveAligned && (
            <p className="mt-1 text-xs text-orange-500">
              ⚠ המטרה לא מתאימה ל-KPI הראשי. Guardrail §41 ידרוש סיבה ברציונל.
            </p>
          )}
        </Field>
        <p className="text-xs text-muted-foreground">
          Optimization goal יוגדר אוטומטית: <strong>{optimizationGoal}</strong>
        </p>
      </Section>

      {/* Budget */}
      <Section title="2. תקציב">
        <Field label="תקציב יומי (₪)">
          <input
            type="number"
            min={5}
            value={dailyBudget}
            onChange={(e) => setDailyBudget(Number(e.target.value))}
            className={inputCls}
          />
        </Field>
        {target != null && kpiKey !== "roas" && (
          <p className="text-xs text-muted-foreground">
            המלצה: לפחות יעד-{kpiKey} × 3 = ₪{Math.round(Number(target) * 3)}{" "}
            ביום (כדי שלמטה יהיה מקום למצוא 3 המרות).
          </p>
        )}
      </Section>

      {/* Audience */}
      <Section title="3. קהל">
        <Field label="קהלים מותאמים (Custom / Lookalike) — מטא ירחיב מהם דרך Advantage+">
          {audiences.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              אין קהלים שמיש (Custom או Lookalike עם 100+ אנשים). עבור ל-
              <a className="underline" href="/audiences">
                קהלים
              </a>{" "}
              כדי לסנכרן או ליצור.
            </p>
          ) : (
            <div className="space-y-1">
              {audiences.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                >
                  <span className="truncate">
                    <span className="me-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                      {a.kind}
                    </span>
                    {a.name}
                    {a.size_upper && (
                      <span className="ms-2 text-xs text-muted-foreground">
                        ~
                        {a.size_upper >= 1_000_000
                          ? `${(a.size_upper / 1_000_000).toFixed(1)}M`
                          : a.size_upper >= 1_000
                            ? `${(a.size_upper / 1_000).toFixed(0)}K`
                            : a.size_upper}
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleAudience(a.id, "selected")}
                      className={chip(selectedAudienceIds.includes(a.id))}
                    >
                      כלול
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleAudience(a.id, "excluded")}
                      className={chip(
                        excludedAudienceIds.includes(a.id),
                        true,
                      )}
                    >
                      הוצא
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="גיל מינ׳">
            <input
              type="number"
              min={18}
              max={65}
              value={ageMin}
              onChange={(e) => setAgeMin(Number(e.target.value))}
              className={inputCls}
            />
          </Field>
          <Field label="גיל מקס׳">
            <input
              type="number"
              min={18}
              max={65}
              value={ageMax}
              onChange={(e) => setAgeMax(Number(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={advantageAudience}
            onChange={(e) => setAdvantageAudience(e.target.checked)}
          />
          Advantage+ Audience (מומלץ — מטא מרחיבה את הקהל מעבר למה שהגדרת)
        </label>
      </Section>

      {/* Creative */}
      <Section title="4. קריאייטיב + טקסט (עברית)">
        <Field label="כותרת ראשית (≤ 40 תווים)">
          <input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            maxLength={40}
            className={inputCls}
            placeholder="לדוגמה: סוכן AI שעונה ב-WhatsApp"
          />
        </Field>
        <Field label="טקסט ראשי (80-150 תווים מומלץ)">
          <textarea
            value={primaryText}
            onChange={(e) => setPrimaryText(e.target.value)}
            rows={3}
            className={inputCls}
            placeholder="לדוגמה: מטה לחיצה — והסוכן יענה ללקוחות שלך 24/7..."
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="כפתור (CTA)">
            <select
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              className={inputCls}
            >
              {CTA_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="URL יעד">
            <input
              dir="ltr"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
        <Field label="נתיב תמונה (חובה לפעולה ראשונה — או השאר ריק והעלה מהגלריה אחרי שתאשר)">
          <input
            dir="ltr"
            value={imagePath}
            onChange={(e) => setImagePath(e.target.value)}
            className={inputCls}
            placeholder="/app/uploads/<biz>/image.jpg"
          />
        </Field>
      </Section>

      {/* Submit */}
      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={submitting || pending}>
          {submitting || pending ? "מכין..." : "הצע לאישור"}
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-h3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function chip(active: boolean, danger = false): string {
  if (active && danger) {
    return "rounded-md border border-rose-500/50 bg-rose-500/15 px-2 py-0.5 text-xs text-rose-500";
  }
  if (active) {
    return "rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-500";
  }
  return "rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-brand-500/40 hover:text-foreground";
}
