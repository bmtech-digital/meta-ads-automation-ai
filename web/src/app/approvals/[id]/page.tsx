import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
import {
  TARGET_KIND_LABEL_HE,
  URGENCY_LABEL_HE,
  URGENCY_STYLES,
  parsePlanSection,
  parsePlanSteps,
  relativeHe,
  requiresHumanReview,
  taskTypeLabel,
} from "@/lib/approvals-fmt";
import {
  humanExecutionRows,
  humanImpactRows,
  humanPayloadRows,
} from "@/lib/approvals-display";
import { DecisionRow } from "@/components/decision-row";
import {
  OrganicPostPreview,
  isPublishTaskType,
} from "@/components/organic-post-preview";
import {
  KpiTargetProposalView,
  isSetKpiTargetTask,
} from "@/components/kpi-target-proposal";
import {
  ApprovalMcqBlock,
  parseMcqFormData,
} from "@/components/approval-mcq-block";
import { buildAnswerRequestSchema } from "@/lib/schemas/approval";

export const dynamic = "force-dynamic";

async function approveAction(formData: FormData) {
  "use server";
  const session = await getAuth().getSession();
  if (!session) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/approvals");
  const db = getDataClient();
  // Pull the row before flipping status so we can dispatch task-specific
  // side effects below. Cheaper than fetching post-approve and avoids a TOCTOU
  // window where the row's payload could be edited mid-approve.
  const before = await db.getApprovalById(id);
  await db.approveApproval(id, session.email);

  // Web-side execution for purely-DB approvals — no need to wait for the
  // execute_approvals cron (which dispatches Meta API writes via Python).
  // Currently: verify_pixel_capi (Pixel/CAPI guardrail) and set_kpi_target
  // (writes businesses.target_*). Both are pure DB flips.
  if (before?.task_type === "verify_pixel_capi") {
    const pixels = (before.payload as { pixels?: Array<{ pixel_id: string }> })
      ?.pixels;
    const firstPixelId = pixels && pixels.length > 0 ? pixels[0].pixel_id : null;
    await db.markTrackingVerified(before.business_id, {
      pixel_id: firstPixelId,
      // Human attested via approval — the row's payload carries
      // capi_attested=false at creation; we treat the act of approving as
      // attesting yes.
      capi_configured: true,
    });
  }

  if (before?.task_type === "set_kpi_target") {
    const payload = before.payload as {
      kpi?: "cpa" | "cpl" | "roas";
      value?: number;
    };
    if (
      payload.kpi &&
      ["cpa", "cpl", "roas"].includes(payload.kpi) &&
      typeof payload.value === "number" &&
      payload.value > 0
    ) {
      await db.setKpiTarget(before.business_id, payload.kpi, payload.value);
    }
  }

  redirect("/approvals?action=approved");
}

async function rejectAction(formData: FormData) {
  "use server";
  const session = await getAuth().getSession();
  if (!session) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) redirect("/approvals");
  if (reason.length < 1 || reason.length > 200) {
    redirect(
      `/approvals/${id}?error=${encodeURIComponent("סיבת דחייה חייבת להיות 1-200 תווים")}`,
    );
  }
  await getDataClient().rejectApproval(id, reason);
  redirect("/approvals?action=rejected");
}

async function answerAction(formData: FormData) {
  "use server";
  const session = await getAuth().getSession();
  if (!session) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/approvals");
  const db = getDataClient();
  const approval = await db.getApprovalById(id);
  if (!approval) redirect("/approvals");
  const questions = approval.operator_questions;
  if (!questions || questions.length === 0) {
    redirect(
      `/approvals/${id}?error=${encodeURIComponent("אין שאלות פתוחות להצעה זו")}`,
    );
  }
  if (approval.status !== "pending") {
    redirect(
      `/approvals/${id}?error=${encodeURIComponent("ההצעה כבר אינה במצב 'ממתין' — אי אפשר לענות שוב")}`,
    );
  }
  const raw = parseMcqFormData(formData, questions);
  const parsed = buildAnswerRequestSchema(questions).safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    redirect(
      `/approvals/${id}?error=${encodeURIComponent(
        `תשובה לא תקפה: ${first?.path?.join(".") ?? ""} — ${first?.message ?? "פרטים חסרים"}`,
      )}`,
    );
  }
  const { recorded } = await db.answerApproval(id, parsed.data);
  if (!recorded) {
    redirect(
      `/approvals/${id}?error=${encodeURIComponent("מצב ההצעה השתנה בינתיים — רענן ונסה שוב")}`,
    );
  }
  redirect(`/approvals/${id}?answered=1`);
}

async function unapproveAction(formData: FormData) {
  "use server";
  const session = await getAuth().getSession();
  if (!session) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/approvals");
  const result = await getDataClient().unapproveApproval(id);
  if (!result.reverted) {
    redirect(
      `/approvals/${id}?error=${encodeURIComponent("לא ניתן לבטל — האישור כבר בוצע או כבר לא במצב 'אושר'")}`,
    );
  }
  redirect(`/approvals/${id}?undone=1`);
}

export default async function ApprovalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; undone?: string; answered?: string }>;
}) {
  const { id } = await params;
  const { error, undone, answered } = await searchParams;

  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect(`/login?next=/approvals/${id}`);

  const db = getDataClient();
  const approval = await db.getApprovalById(id);
  if (!approval) notFound();

  const decisions = await db.listDecisionsForApproval(id);
  const hrReason = requiresHumanReview(approval);
  const impactRows = humanImpactRows(approval.expected_impact);
  const payloadRows = humanPayloadRows(approval.payload);
  const executionRows = humanExecutionRows(approval.execution_result);
  const targetLabel = approval.target_kind
    ? TARGET_KIND_LABEL_HE[approval.target_kind]
    : "";
  const isExecuted = approval.status === "executed";
  const isFailed = approval.status === "failed";
  const showExecutionSection =
    (isExecuted || isFailed) && executionRows.length > 0;

  const relatedCampaignId: string | null =
    approval.target_kind === "campaign" && approval.target_id
      ? approval.target_id
      : (decisions.find((d) => d.campaign_id)?.campaign_id ?? null);

  const isPending = approval.status === "pending";
  const canUndo = approval.status === "approved" && !approval.executed_at;

  // Per propose_task.py + guardrails §33 (2026-05-13): an `alert` proposal
  // carries `payload.acknowledgment_only: true` because there's no Meta call
  // behind it — "approve" is an acknowledgement, not an execution. Render
  // distinct copy + labels so the operator doesn't think they're triggering
  // a real action.
  const payloadObj =
    approval.payload && typeof approval.payload === "object"
      ? (approval.payload as Record<string, unknown>)
      : {};
  const isAckOnly =
    approval.task_type === "alert" && payloadObj.acknowledgment_only === true;

  return (
    <Shell active="/approvals">
      <PageHeader
        eyebrow="הצעה"
        title={taskTypeLabel(approval.task_type)}
        subtitle={`נוצר ${relativeHe(approval.created_at)}`}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">סטטוס:</span>
            <StatusBadge status={approval.status} />
            <Link href="/approvals">
              <Button variant="outline" size="sm">
                חזרה לרשימה
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-col gap-6">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {undone ? (
          <Badge className="bg-blue-500 text-white">
            האישור בוטל, חזר ל"ממתין"
          </Badge>
        ) : null}
        {answered ? (
          <Badge className="bg-emerald-600 text-white">
            התשובה נשמרה — הסוכן יקרא אותה בריצה הבאה
          </Badge>
        ) : null}

        {hrReason ? (
          <Card className="border-2 border-amber-500 bg-amber-50">
            <CardHeader>
              <CardTitle className="text-amber-900">
                ⚠️ דורש בדיקה אנושית
              </CardTitle>
              <CardDescription className="text-amber-800">
                {hrReason}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {isPublishTaskType(approval.task_type) ? (
          <OrganicPostPreview approval={approval} />
        ) : null}

        {isSetKpiTargetTask(approval.task_type) ? (
          <KpiTargetProposalView approval={approval} />
        ) : null}

        <ApprovalMcqBlock approval={approval} action={answerAction} />

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${URGENCY_STYLES[approval.urgency]}`}
              >
                {URGENCY_LABEL_HE[approval.urgency]}
              </span>
              {targetLabel && approval.target_id ? (
                <span className="text-sm text-muted-foreground">
                  {targetLabel}:{" "}
                  <span dir="ltr" className="font-mono text-xs">
                    {approval.target_id}
                  </span>
                </span>
              ) : null}
              {relatedCampaignId ? (
                <Link
                  href={`/campaigns#campaign-${relatedCampaignId}`}
                  className="text-xs text-primary underline-offset-2 hover:underline"
                >
                  צפה בקמפיין ↗
                </Link>
              ) : null}
              {approval.created_by_run_id ? (
                <Link
                  href={`/runs/${approval.created_by_run_id}`}
                  className="text-xs text-primary underline-offset-2 hover:underline"
                >
                  צפה בריצה ↗
                </Link>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {(() => {
              const { main, plan } = parsePlanSection(approval.rationale);
              const steps = plan ? parsePlanSteps(plan) : [];
              return (
                <>
                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                      למה?
                    </h3>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {main || approval.rationale}
                    </p>
                  </section>
                  {plan ? (
                    <section className="rounded-lg border-2 border-brand-500/30 bg-brand-500/5 p-4">
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-700 dark:text-brand-400">
                        <span aria-hidden>🧭</span>
                        תוכנית עבודה
                      </h3>
                      {steps.length > 1 ? (
                        <ol className="flex flex-col gap-2 text-sm leading-relaxed">
                          {steps.map((step, i) => (
                            <li
                              key={i}
                              className="flex gap-3 items-start"
                            >
                              <span
                                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-700 dark:text-brand-300"
                                aria-hidden
                              >
                                {i + 1}
                              </span>
                              <span className="whitespace-pre-wrap">
                                {step}
                              </span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {plan}
                        </p>
                      )}
                    </section>
                  ) : null}
                </>
              );
            })()}

            {impactRows.length > 0 ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                  השפעה צפויה
                </h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {impactRows.map((r) => (
                    <div key={r.label} className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">
                        {r.label}
                      </div>
                      <div
                        className={
                          "mt-1 text-lg font-semibold " +
                          (r.positive === true
                            ? "text-green-700"
                            : r.positive === false
                              ? "text-red-700"
                              : "")
                        }
                      >
                        {r.value}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {payloadRows.length > 0 ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                  פרטי הפעולה
                </h3>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm md:grid-cols-2">
                  {payloadRows.map((r) => (
                    <div
                      key={r.key}
                      className="flex items-baseline justify-between gap-3 border-b py-1.5"
                    >
                      <dt className="text-muted-foreground">{r.label}</dt>
                      <dd className="font-medium text-right">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}

            <details className="rounded-md border bg-muted/30 p-3 text-sm">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                JSON מלא (למפתחים)
              </summary>
              <pre
                dir="ltr"
                className="mt-2 overflow-auto text-left font-mono text-xs"
              >
                {JSON.stringify(approval.payload, null, 2)}
              </pre>
            </details>

            {approval.status === "rejected" && approval.rejection_reason ? (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                <div className="text-xs text-red-700">סיבת דחייה</div>
                <p className="mt-1">{approval.rejection_reason}</p>
              </div>
            ) : null}

            {approval.status === "approved" && approval.approved_by ? (
              <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
                <div className="text-xs text-blue-700">אושר</div>
                <p className="mt-1">
                  ע"י {approval.approved_by}
                  {approval.approved_at
                    ? ` · ${relativeHe(approval.approved_at)}`
                    : null}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {isPending ? (
          <Card>
            <CardHeader>
              <CardTitle>{isAckOnly ? "סגירת ההתראה" : "החלטה"}</CardTitle>
              <CardDescription>
                {isAckOnly ? (
                  <>
                    אין פעולה אוטומטית מאחורי ההתראה הזאת. &quot;ראיתי&quot; סוגר את ההתראה
                    ומסמן שעברת עליה. &quot;לא רלוונטי&quot; סוגר אותה כדחויה — אם זיהיתי
                    שגוי, כתוב מה החמצתי.
                  </>
                ) : (
                  <>אישור יעביר לביצוע אוטומטי תוך 15 דקות. דחייה סופית.</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <form action={approveAction} className="flex gap-2">
                <input type="hidden" name="id" value={approval.id} />
                <Button type="submit">{isAckOnly ? "ראיתי" : "אשר"}</Button>
              </form>
              <form action={rejectAction} className="flex flex-col gap-2">
                <input type="hidden" name="id" value={approval.id} />
                <Label htmlFor="reason">
                  {isAckOnly
                    ? "סיבה לסגירה כלא-רלוונטי (1-200 תווים)"
                    : "סיבת דחייה (1-200 תווים)"}
                </Label>
                <Input
                  id="reason"
                  name="reason"
                  required
                  minLength={1}
                  maxLength={200}
                  placeholder={
                    isAckOnly
                      ? "למה ההתראה לא רלוונטית? (יעזור לסוכן לא לחזור עליה)"
                      : "מה גרם לדחייה? (חובה — יתועד ל-RLHF)"
                  }
                />
                <div>
                  <Button type="submit" variant="outline">
                    {isAckOnly ? "לא רלוונטי" : "דחה"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {showExecutionSection ? (
          <Card
            className={
              isFailed
                ? "border-red-300 bg-red-50/30"
                : "border-green-300 bg-green-50/30"
            }
          >
            <CardHeader>
              <CardTitle
                className={isFailed ? "text-red-900" : "text-green-900"}
              >
                {isFailed ? "שגיאת ביצוע" : "תוצאת ביצוע"}
              </CardTitle>
              <CardDescription>
                {isFailed
                  ? "Meta החזיר שגיאה בזמן ניסיון הביצוע. נתוני ההחלטה שמורים; ניתן לפתוח חדש אחרי תיקון."
                  : `הביצוע הסתיים${approval.executed_at ? " " + relativeHe(approval.executed_at) : ""}. להלן מה ש-Meta החזיר בפועל.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {isExecuted && impactRows.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-md border bg-background p-3">
                    <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                      צפי בעת ההצעה
                    </h4>
                    <dl className="flex flex-col gap-1 text-sm">
                      {impactRows.map((r) => (
                        <div
                          key={r.label}
                          className="flex items-baseline justify-between gap-3"
                        >
                          <dt className="text-muted-foreground">{r.label}</dt>
                          <dd
                            className={
                              "font-medium " +
                              (r.positive === true
                                ? "text-green-700"
                                : r.positive === false
                                  ? "text-red-700"
                                  : "")
                            }
                          >
                            {r.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                      מה ש-Meta אישר
                    </h4>
                    <dl className="flex flex-col gap-1 text-sm">
                      {executionRows.map((r) => (
                        <div
                          key={r.key}
                          className="flex items-baseline justify-between gap-3"
                        >
                          <dt className="text-muted-foreground">{r.label}</dt>
                          <dd
                            className={
                              "font-medium text-right " +
                              (r.isError ? "text-red-700" : "") +
                              (r.isId ? " font-mono text-xs" : "")
                            }
                            dir={r.isId ? "ltr" : undefined}
                          >
                            {r.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              ) : (
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm md:grid-cols-2">
                  {executionRows.map((r) => (
                    <div
                      key={r.key}
                      className="flex items-baseline justify-between gap-3 border-b py-1.5"
                    >
                      <dt className="text-muted-foreground">{r.label}</dt>
                      <dd
                        className={
                          "font-medium text-right " +
                          (r.isError ? "text-red-700" : "") +
                          (r.isId ? " font-mono text-xs" : "")
                        }
                        dir={r.isId ? "ltr" : undefined}
                      >
                        {r.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="text-xs text-muted-foreground">
                מטריקות בפועל (CPA/ROAS/CTR אחרי הביצוע) עדיין לא נאספות
                אוטומטית — יתווסף cron ייעודי כשייצברו מספיק הצעות שבוצעו.
              </p>
              <details className="rounded-md border bg-muted/30 p-3 text-sm">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  JSON גולמי (למפתחים)
                </summary>
                <pre
                  dir="ltr"
                  className="mt-2 overflow-auto text-left font-mono text-xs"
                >
                  {JSON.stringify(approval.execution_result, null, 2)}
                </pre>
              </details>
            </CardContent>
          </Card>
        ) : null}

        {canUndo ? (
          <Card className="border-blue-300 bg-blue-50/30">
            <CardHeader>
              <CardTitle className="text-blue-900">ביטול אישור</CardTitle>
              <CardDescription>
                האישור עוד לא בוצע ב-Meta. אפשר להחזיר את ההצעה ל"ממתין" אם
                טעית. לאחר שה-cron הבא של execute_approvals יריץ אותה, לא יהיה
                אפשר לבטל.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={unapproveAction} className="flex gap-2">
                <input type="hidden" name="id" value={approval.id} />
                <Button type="submit" variant="outline">
                  בטל אישור
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>שרשרת החלטות הסוכן</CardTitle>
            <CardDescription>
              {decisions.length} רשומות ב-`agent_decisions` שקשורות להצעה זו,
              כרונולוגי.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {decisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                אין רשומות ב-agent_decisions להצעה זו. (הסוכן לא כתב
                `related_approval_id` או ההצעה נוצרה ידנית.)
              </p>
            ) : (
              <ol className="flex flex-col gap-3">
                {decisions.map((d) => (
                  <DecisionRow key={d.id} d={d} />
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "ממתין",
    approved: "אושר",
    rejected: "נדחה",
    executed: "בוצע",
    failed: "נכשל",
    expired: "פג תוקף",
    dry_run: "Dry run",
  };
  return <Badge variant="secondary">{map[status] ?? status}</Badge>;
}
