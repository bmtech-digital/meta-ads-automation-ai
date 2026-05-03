import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Nav } from "@/components/nav";
import { DecisionRow, DECISION_LABEL_HE, DECISION_STYLES } from "@/components/decision-row";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import type { AgentDecision, DecisionType } from "@/lib/db/types";
import { relativeHe, taskTypeLabel } from "@/lib/approvals-fmt";

export const dynamic = "force-dynamic";

const DECISION_ORDER: DecisionType[] = [
  "observation",
  "diagnosis",
  "proposal",
  "rejection",
  "skip",
  "execution",
  "error",
];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}ש״נ`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec ? `${min}:${String(remSec).padStart(2, "0")} דק׳` : `${min} דק׳`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}ש׳ ${remMin}דק׳`;
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ run_id: string }>;
}) {
  const { run_id: runId } = await params;

  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect(`/login?next=/runs/${runId}`);

  const db = getDataClient();
  const business = process.env.BUSINESS_ID
    ? await db.getBusinessById(process.env.BUSINESS_ID)
    : await db.getFirstBusiness();
  if (!business) notFound();

  const decisions = await db.listDecisionsForRun(business.id, runId);
  if (decisions.length === 0) notFound();

  const first = decisions[0];
  const last = decisions[decisions.length - 1];
  const durationMs = new Date(last.created_at).getTime() - new Date(first.created_at).getTime();

  const typeCounts = new Map<DecisionType, number>();
  for (const d of decisions) {
    typeCounts.set(d.decision_type, (typeCounts.get(d.decision_type) ?? 0) + 1);
  }

  const totalTokensIn = decisions.reduce((s, d) => s + (d.llm_tokens_in ?? 0), 0);
  const totalTokensOut = decisions.reduce((s, d) => s + (d.llm_tokens_out ?? 0), 0);
  const totalLatencyMs = decisions.reduce((s, d) => s + (d.latency_ms ?? 0), 0);

  const graphNames = Array.from(new Set(decisions.map((d) => d.graph_name)));
  const llmModels = Array.from(
    new Set(decisions.map((d) => d.llm_model).filter((m): m is string => !!m)),
  );

  const relatedApprovals = buildRelatedApprovals(decisions);
  const relatedCampaigns = Array.from(
    new Set(decisions.map((d) => d.campaign_id).filter((c): c is string => !!c)),
  );
  const hasErrors = (typeCounts.get("error") ?? 0) > 0;
  const guardrailHits = decisions.reduce(
    (s, d) => s + (d.guardrail_violations?.length ?? 0),
    0,
  );

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <Nav active="/runs" />

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold">ריצה</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span dir="ltr" className="font-mono text-xs">{runId}</span>
              <span>·</span>
              <span>{graphNames.join(", ")}</span>
              <span>·</span>
              <span>התחילה {relativeHe(first.created_at)}</span>
            </div>
          </div>
          <Link href="/approvals">
            <Button variant="outline">הצעות</Button>
          </Link>
        </header>

        {hasErrors ? (
          <Card className="border-red-300 bg-red-50/40">
            <CardHeader>
              <CardTitle className="text-red-900">הריצה כללה שגיאות</CardTitle>
              <CardDescription className="text-red-800">
                {typeCounts.get("error")} רשומות error. בדוק את השורות המסומנות באדום למטה.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>סיכום הריצה</CardTitle>
            <CardDescription>
              {decisions.length} החלטות · {formatDuration(durationMs)} מקצה לקצה
              {llmModels.length > 0 ? ` · ${llmModels.join(", ")}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="החלטות" value={decisions.length.toString()} />
              <Stat label="משך כולל" value={formatDuration(durationMs)} />
              <Stat
                label="טוקנים (in/out)"
                value={
                  totalTokensIn + totalTokensOut > 0
                    ? `${totalTokensIn.toLocaleString("he-IL")} / ${totalTokensOut.toLocaleString("he-IL")}`
                    : "—"
                }
              />
              <Stat
                label="סך latency"
                value={totalLatencyMs > 0 ? formatDuration(totalLatencyMs) : "—"}
              />
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                התפלגות לפי סוג החלטה
              </h3>
              <div className="flex flex-wrap gap-2">
                {DECISION_ORDER.filter((t) => typeCounts.has(t)).map((t) => (
                  <span
                    key={t}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${DECISION_STYLES[t]}`}
                  >
                    {DECISION_LABEL_HE[t]} · {typeCounts.get(t)}
                  </span>
                ))}
              </div>
            </div>

            {guardrailHits > 0 ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                🛡 {guardrailHits} guardrail violations בריצה הזו
              </div>
            ) : null}
          </CardContent>
        </Card>

        {relatedApprovals.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>הצעות שנוצרו מהריצה</CardTitle>
              <CardDescription>
                {relatedApprovals.length} הצעות יחודיות עם קישורי `related_approval_id`.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {relatedApprovals.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/approvals/${r.id}`}
                      className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm hover:bg-muted/50"
                    >
                      <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                        {r.id.slice(0, 8)}
                      </span>
                      {r.taskType ? (
                        <span className="font-medium">{taskTypeLabel(r.taskType)}</span>
                      ) : null}
                      {r.campaignId ? (
                        <span className="text-xs text-muted-foreground">
                          קמפיין{" "}
                          <span dir="ltr" className="font-mono">
                            {r.campaignId}
                          </span>
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {relatedCampaigns.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>קמפיינים שנגעו בריצה</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {relatedCampaigns.map((c) => (
                  <Link
                    key={c}
                    href={`/campaigns#campaign-${c}`}
                    className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs hover:bg-muted/50"
                  >
                    <span dir="ltr" className="font-mono">{c}</span>
                    <span>↗</span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>כל ההחלטות ({decisions.length})</CardTitle>
            <CardDescription>כרונולוגי, מוקדם לאחרון.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3">
              {decisions.map((d) => (
                <DecisionRow
                  key={d.id}
                  d={d}
                  showRunLink={false}
                  showApprovalLink={true}
                />
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

type RelatedApproval = {
  id: string;
  taskType: string | null;
  campaignId: string | null;
};

function buildRelatedApprovals(decisions: AgentDecision[]): RelatedApproval[] {
  const byId = new Map<string, RelatedApproval>();
  for (const d of decisions) {
    if (!d.related_approval_id) continue;
    const existing = byId.get(d.related_approval_id);
    if (existing) {
      if (!existing.campaignId && d.campaign_id) existing.campaignId = d.campaign_id;
    } else {
      byId.set(d.related_approval_id, {
        id: d.related_approval_id,
        taskType: inferTaskType(d),
        campaignId: d.campaign_id,
      });
    }
  }
  return Array.from(byId.values());
}

function inferTaskType(d: AgentDecision): string | null {
  const outputs = d.outputs as Record<string, unknown> | null;
  const task = outputs?.task_type;
  return typeof task === "string" ? task : null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
