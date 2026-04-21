import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Nav } from "@/components/nav";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import type { AgentDecision, DecisionType } from "@/lib/db/types";
import {
  TARGET_KIND_LABEL_HE,
  URGENCY_LABEL_HE,
  URGENCY_STYLES,
  relativeHe,
  requiresHumanReview,
  taskTypeLabel,
} from "@/lib/approvals-fmt";
import { humanImpactRows, humanPayloadRows } from "@/lib/approvals-display";

export const dynamic = "force-dynamic";

const DECISION_STYLES: Record<DecisionType, string> = {
  observation: "bg-slate-200 text-slate-800",
  diagnosis: "bg-blue-100 text-blue-800",
  proposal: "bg-green-100 text-green-800",
  rejection: "bg-red-100 text-red-800",
  skip: "bg-gray-100 text-gray-700",
  execution: "bg-purple-100 text-purple-800",
  error: "bg-red-200 text-red-900",
};

const DECISION_LABEL_HE: Record<DecisionType, string> = {
  observation: "תצפית",
  diagnosis: "אבחון",
  proposal: "הצעה",
  rejection: "דחייה",
  skip: "דילוג",
  execution: "ביצוע",
  error: "שגיאה",
};

async function approveAction(formData: FormData) {
  "use server";
  const session = await getAuth().getSession();
  if (!session) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/approvals");
  await getDataClient().approveApproval(id, session.email);
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
    redirect(`/approvals/${id}?error=${encodeURIComponent("סיבת דחייה חייבת להיות 1-200 תווים")}`);
  }
  await getDataClient().rejectApproval(id, reason);
  redirect("/approvals?action=rejected");
}

async function unapproveAction(formData: FormData) {
  "use server";
  const session = await getAuth().getSession();
  if (!session) redirect("/login");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/approvals");
  const result = await getDataClient().unapproveApproval(id);
  if (!result.reverted) {
    redirect(`/approvals/${id}?error=${encodeURIComponent("לא ניתן לבטל — האישור כבר בוצע או כבר לא במצב 'אושר'")}`);
  }
  redirect(`/approvals/${id}?undone=1`);
}

export default async function ApprovalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; undone?: string }>;
}) {
  const { id } = await params;
  const { error, undone } = await searchParams;

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
  const targetLabel = approval.target_kind ? TARGET_KIND_LABEL_HE[approval.target_kind] : "";

  const isPending = approval.status === "pending";
  const canUndo = approval.status === "approved" && !approval.executed_at;

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <Nav active="/approvals" />

        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold">{taskTypeLabel(approval.task_type)}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>נוצר {relativeHe(approval.created_at)}</span>
              <span>·</span>
              <span>סטטוס:</span>
              <StatusBadge status={approval.status} />
            </div>
          </div>
          <Link href="/approvals">
            <Button variant="outline">חזרה לרשימה</Button>
          </Link>
        </header>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {undone ? <Badge className="bg-blue-500 text-white">האישור בוטל, חזר ל"ממתין"</Badge> : null}

        {hrReason ? (
          <Card className="border-2 border-amber-500 bg-amber-50">
            <CardHeader>
              <CardTitle className="text-amber-900">⚠️ דורש בדיקה אנושית</CardTitle>
              <CardDescription className="text-amber-800">{hrReason}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

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
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <section>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">למה?</h3>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{approval.rationale}</p>
            </section>

            {impactRows.length > 0 ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground">השפעה צפויה</h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {impactRows.map((r) => (
                    <div key={r.label} className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{r.label}</div>
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
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground">פרטי הפעולה</h3>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm md:grid-cols-2">
                  {payloadRows.map((r) => (
                    <div key={r.key} className="flex items-baseline justify-between gap-3 border-b py-1.5">
                      <dt className="text-muted-foreground">{r.label}</dt>
                      <dd className="font-medium text-right">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}

            <details className="rounded-md border bg-muted/30 p-3 text-sm">
              <summary className="cursor-pointer text-xs text-muted-foreground">JSON מלא (למפתחים)</summary>
              <pre dir="ltr" className="mt-2 overflow-auto text-left font-mono text-xs">
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
                  {approval.approved_at ? ` · ${relativeHe(approval.approved_at)}` : null}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {isPending ? (
          <Card>
            <CardHeader>
              <CardTitle>החלטה</CardTitle>
              <CardDescription>
                אישור יעביר לביצוע ב-cron הבא של execute_approvals. דחייה סופית.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <form action={approveAction} className="flex gap-2">
                <input type="hidden" name="id" value={approval.id} />
                <Button type="submit">אשר</Button>
              </form>
              <form action={rejectAction} className="flex flex-col gap-2">
                <input type="hidden" name="id" value={approval.id} />
                <Label htmlFor="reason">סיבת דחייה (1-200 תווים)</Label>
                <Input
                  id="reason"
                  name="reason"
                  required
                  minLength={1}
                  maxLength={200}
                  placeholder="מה גרם לדחייה? (חובה — יתועד ל-RLHF)"
                />
                <div>
                  <Button type="submit" variant="outline">
                    דחה
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {canUndo ? (
          <Card className="border-blue-300 bg-blue-50/30">
            <CardHeader>
              <CardTitle className="text-blue-900">ביטול אישור</CardTitle>
              <CardDescription>
                האישור עוד לא בוצע ב-Meta. אפשר להחזיר את ההצעה ל"ממתין" אם טעית. לאחר שה-cron הבא של
                execute_approvals יריץ אותה, לא יהיה אפשר לבטל.
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
              {decisions.length} רשומות ב-`agent_decisions` שקשורות להצעה זו, כרונולוגי.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {decisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                אין רשומות ב-agent_decisions להצעה זו. (הסוכן לא כתב `related_approval_id` או
                ההצעה נוצרה ידנית.)
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
    </main>
  );
}

function DecisionRow({ d }: { d: AgentDecision }) {
  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${DECISION_STYLES[d.decision_type]}`}>
          {DECISION_LABEL_HE[d.decision_type]}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{d.graph_name}/{d.node_name}</span>
        <span className="text-xs text-muted-foreground">{relativeHe(d.created_at)}</span>
        {d.latency_ms ? <span className="text-xs text-muted-foreground">{d.latency_ms}ms</span> : null}
        {d.confidence != null ? (
          <span className="text-xs text-muted-foreground">confidence {Math.round(d.confidence * 100)}%</span>
        ) : null}
      </div>
      <p className="mt-2 text-sm font-medium">{d.summary}</p>
      {d.rationale ? (
        <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{d.rationale}</p>
      ) : null}
      {d.guardrail_violations && d.guardrail_violations.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {d.guardrail_violations.map((g) => (
            <span key={g} className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-900">
              🛡 {g}
            </span>
          ))}
        </div>
      ) : null}
      {d.inputs || d.outputs ? (
        <div className="mt-2 flex flex-col gap-2">
          {d.inputs ? (
            <details className="rounded border p-2 text-xs">
              <summary className="cursor-pointer">inputs</summary>
              <pre dir="ltr" className="mt-1 overflow-auto text-left font-mono">
                {JSON.stringify(d.inputs, null, 2)}
              </pre>
            </details>
          ) : null}
          {d.outputs ? (
            <details className="rounded border p-2 text-xs">
              <summary className="cursor-pointer">outputs</summary>
              <pre dir="ltr" className="mt-1 overflow-auto text-left font-mono">
                {JSON.stringify(d.outputs, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </li>
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
