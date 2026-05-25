import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Shell, PageHeader } from "@/components/shell";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { relativeHe } from "@/lib/approvals-fmt";
import type { RunSummaryRow } from "@/lib/db/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ריצות הסוכן" };

const PAGE_LIMIT = 50;

/**
 * /runs — index of recent agent runs. One row per distinct `run_id`,
 * newest first. Added per `docs/todos/surface-runs-detail.md`: gives
 * the operator a paginated way to scroll back through scans without
 * going through /history. Each row links into the existing
 * /runs/[run_id] detail page.
 *
 * No graph_name filter — daily-scan, weekly creative-firehose and
 * weekly competitive-research all show up here. Each row is labeled
 * with its graph_name so the operator can tell them apart.
 */
export default async function RunsIndexPage() {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/runs");

  const db = getDataClient();
  const business = await getActiveBusiness();

  if (!business) {
    return (
      <Shell active="/runs">
        <PageHeader eyebrow="ריצות" title="ריצות הסוכן" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק ב-DB</CardTitle>
            <CardDescription>הרץ migrations ו-seed קודם.</CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const runs = await db.listRunsForBusiness(business.id, {
    limit: PAGE_LIMIT,
  });

  return (
    <Shell active="/runs">
      <PageHeader
        eyebrow="ריצות"
        title="ריצות הסוכן"
        subtitle={`${PAGE_LIMIT} הריצות האחרונות. כל ריצה היא סבב אחד של הסוכן — תצפיות, אבחונים, הצעות, ודחיות.`}
      />

      {runs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>אין ריצות עדיין</CardTitle>
            <CardDescription>
              הסוכן עוד לא רץ עבור העסק הזה. הפעל את ה-runner היומי כדי
              ליצור ריצה ראשונה.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="glass-surface divide-y divide-border/60 overflow-hidden rounded-lg">
          {runs.map((r) => (
            <RunRow key={r.run_id} run={r} />
          ))}
        </ul>
      )}
    </Shell>
  );
}

function RunRow({ run }: { run: RunSummaryRow }) {
  const duration = durationLabel(run.started_at, run.ended_at);
  const tone = run.error_count > 0
    ? "border-red-400/60"
    : run.proposal_count > 0
      ? "border-emerald-500/60"
      : "border-transparent";

  return (
    <li>
      <Link
        href={`/runs/${run.run_id}`}
        className={`grid grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-foreground/[0.03] border-r-4 ${tone}`}
      >
        <span aria-hidden />
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[14.5px] font-semibold">
              {graphLabelHe(run.graph_name)}
            </span>
            <span className="font-tabular text-[11.5px] text-muted-foreground">
              {relativeHe(run.ended_at)}
            </span>
            {duration ? (
              <span className="text-[11.5px] text-muted-foreground">
                · {duration}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <Stat label="החלטות" value={run.decision_count} />
            {run.proposal_count > 0 ? (
              <Stat
                label="הצעות"
                value={run.proposal_count}
                tone="good"
              />
            ) : null}
            {run.skip_count > 0 ? (
              <Stat label="דילוגים" value={run.skip_count} />
            ) : null}
            {run.rejection_count > 0 ? (
              <Stat
                label="דחיות"
                value={run.rejection_count}
                tone="warn"
              />
            ) : null}
            {run.observation_blocked_count > 0 ? (
              <Stat
                label="ממצאים חסומים"
                value={run.observation_blocked_count}
                tone="warn"
              />
            ) : null}
            {run.error_count > 0 ? (
              <Stat label="שגיאות" value={run.error_count} tone="bad" />
            ) : null}
            {run.campaigns_touched > 0 ? (
              <Stat
                label="קמפיינים"
                value={run.campaigns_touched}
              />
            ) : null}
          </div>
        </div>
        <span
          dir="ltr"
          className="font-mono text-[10.5px] text-muted-foreground"
        >
          {run.run_id.slice(0, 8)}
        </span>
      </Link>
    </li>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : tone === "bad"
          ? "bg-red-500/15 text-red-700 dark:text-red-300"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${toneCls}`}
    >
      <span className="font-tabular font-semibold">{value}</span>
      <span className="opacity-80">{label}</span>
    </span>
  );
}

function durationLabel(start: string, end: string): string | null {
  const ms = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 1000) return null;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}ש״נ`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} דק׳`;
  const hr = Math.floor(min / 60);
  return `${hr}ש׳ ${min % 60}ד׳`;
}

const GRAPH_LABELS_HE: Record<string, string> = {
  observe_propose: "סריקה יומית",
  execute_approvals: "ביצוע אישורים",
  weekly_creative_firehose: "ייצור קריאייטיבים",
  weekly_competitive_research: "מחקר תחרותי",
  onboarding_chain: "תהליך onboarding",
};

function graphLabelHe(graph: string): string {
  return GRAPH_LABELS_HE[graph] ?? graph;
}
