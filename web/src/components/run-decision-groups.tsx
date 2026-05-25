import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AgentDecision } from "@/lib/db/types";
import type { GroupedDecisions } from "@/lib/runs-summary";
import { relativeHe, taskTypeLabel } from "@/lib/approvals-fmt";

/**
 * Debug-only "key decisions" view on `/runs/[run_id]`. Five collapsible
 * sections, each telling its own story:
 *
 *   1. Blocked findings  — agent saw a finding, capability gated the action.
 *   2. Guardrail rejects — proposal was killed before reaching the queue.
 *   3. Skips             — deliberate "nothing to do here".
 *   4. Proposals         — what actually made it to /approvals.
 *   5. Errors            — exceptions during the run.
 *
 * Server component — uses native `<details>` so no client JS is shipped.
 * See `docs/plans/debug-runs-page.md` §5.3.
 */
export function RunDecisionGroups({ groups }: { groups: GroupedDecisions }) {
  const anyContent =
    groups.blockedFindings.length > 0 ||
    groups.rejections.length > 0 ||
    groups.skips.length > 0 ||
    groups.proposals.length > 0 ||
    groups.errors.length > 0;

  if (!anyContent) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>החלטות מפתח</CardTitle>
          <CardDescription>
            לריצה הזו לא היו ממצאים חסומים, דחיות, דילוגים, הצעות או שגיאות —
            רק תצפיות שגרתיות.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle>החלטות מפתח</CardTitle>
        <CardDescription>
          קיבוץ של החלטות הסוכן לפי סוג, עם הנימוק המלא של כל אחת.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {groups.errors.length > 0 ? (
          <Group
            title="שגיאות"
            icon="💥"
            tone="bad"
            count={groups.errors.length}
            defaultOpen
          >
            <ul className="flex flex-col gap-2">
              {groups.errors.map((d) => (
                <ErrorRow key={d.id} d={d} />
              ))}
            </ul>
          </Group>
        ) : null}

        {groups.blockedFindings.length > 0 ? (
          <Group
            title="ממצאים חסומים ע״י capability"
            icon="🛑"
            tone="warn"
            count={groups.blockedFindings.length}
            defaultOpen
            blurb="הסוכן זיהה משהו ראוי לפעולה — אבל לא הציע אותה כי דרישה מסוימת לא מתקיימת (למשל מעקב לא מאומת, יעד KPI חסר). פתיחה של הדרישה תאפשר את הפעולה."
          >
            <ul className="flex flex-col gap-2">
              {groups.blockedFindings.map((d) => (
                <BlockedRow key={d.id} d={d} />
              ))}
            </ul>
          </Group>
        ) : null}

        {groups.rejections.length > 0 ? (
          <Group
            title="הצעות שנדחו ע״י guardrails"
            icon="❌"
            tone="warn"
            count={groups.rejections.length}
            blurb="הסוכן הכין הצעות, אבל בדיקת guardrails חסמה אותן לפני שנכנסו לתור."
          >
            <GuardrailHistogram decisions={groups.rejections} />
            <ul className="mt-2 flex flex-col gap-2">
              {groups.rejections.map((d) => (
                <RejectionRow key={d.id} d={d} />
              ))}
            </ul>
          </Group>
        ) : null}

        {groups.proposals.length > 0 ? (
          <Group
            title="הצעות שנוצרו"
            icon="✅"
            tone="good"
            count={groups.proposals.length}
            blurb="הצעות שעברו את כל הבדיקות וממתינות לאישורך."
          >
            <ul className="flex flex-col gap-2">
              {groups.proposals.map((d) => (
                <ProposalRow key={d.id} d={d} />
              ))}
            </ul>
          </Group>
        ) : null}

        {groups.skips.length > 0 ? (
          <Group
            title="דילוגים מודעים"
            icon="⏭️"
            tone="neutral"
            count={groups.skips.length}
            blurb="קמפיינים שהסוכן בחר לא לגעת בהם (בלימוד, אפס spend, וכו׳)."
          >
            <ul className="flex flex-col gap-1.5">
              {groups.skips.map((d) => (
                <SkipRow key={d.id} d={d} />
              ))}
            </ul>
          </Group>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---- Group wrapper -------------------------------------------------------

type GroupTone = "good" | "warn" | "bad" | "neutral";

function Group({
  title,
  icon,
  tone,
  count,
  blurb,
  defaultOpen,
  children,
}: {
  title: string;
  icon: string;
  tone: GroupTone;
  count: number;
  blurb?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const accent =
    tone === "good"
      ? "border-emerald-500/40"
      : tone === "warn"
        ? "border-amber-500/40"
        : tone === "bad"
          ? "border-red-500/40"
          : "border-border";
  const badge =
    tone === "good"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : tone === "bad"
          ? "bg-red-500/15 text-red-700 dark:text-red-300"
          : "bg-muted text-muted-foreground";
  return (
    <details
      open={defaultOpen ?? false}
      className={`group rounded-md border bg-card/40 ${accent}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 outline-none hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden>{icon}</span>
          <span>{title}</span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}`}
          >
            {count}
          </span>
        </span>
        <span
          aria-hidden
          className="text-muted-foreground transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="border-t bg-background/40 px-4 py-3">
        {blurb ? (
          <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
            {blurb}
          </p>
        ) : null}
        {children}
      </div>
    </details>
  );
}

// ---- Row renderers --------------------------------------------------------

function BlockedRow({ d }: { d: AgentDecision }) {
  const outs = (d.outputs ?? {}) as Record<string, unknown>;
  const findingType =
    typeof outs.finding_type === "string" ? outs.finding_type : null;
  const blockedBy = Array.isArray(outs.blocked_by)
    ? (outs.blocked_by.filter((x) => typeof x === "string") as string[])
    : [];
  const wouldPropose = isObj(outs.would_propose)
    ? (outs.would_propose as Record<string, unknown>)
    : null;
  const wouldSummary =
    wouldPropose && typeof wouldPropose.summary === "string"
      ? (wouldPropose.summary as string)
      : wouldPropose && typeof wouldPropose.task_type === "string"
        ? (wouldPropose.task_type as string)
        : null;
  return (
    <li className="rounded-md border bg-card/30 p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {findingType ? (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-mono text-amber-800 dark:text-amber-300">
            {findingType}
          </span>
        ) : null}
        <span className="text-sm font-medium">{d.summary}</span>
        {d.campaign_id ? (
          <span className="text-[11px] text-muted-foreground">
            קמפיין{" "}
            <span dir="ltr" className="font-mono">
              {d.campaign_id}
            </span>
          </span>
        ) : null}
        <span className="ms-auto font-tabular text-[10.5px] text-muted-foreground">
          {relativeHe(d.created_at)}
        </span>
      </div>
      {wouldSummary ? (
        <div className="mt-2 rounded border border-dashed border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[12.5px]">
          <span className="text-muted-foreground">היה מציע: </span>
          <span>{wouldSummary}</span>
        </div>
      ) : null}
      {blockedBy.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="text-[11px] text-muted-foreground">חסום ע״י:</span>
          {blockedBy.map((req) => (
            <span
              key={req}
              dir="ltr"
              className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10.5px] text-amber-800 ring-1 ring-amber-500/30 dark:text-amber-300"
              title={REQUIREMENT_LABEL_HE[req] ?? req}
            >
              {req}
            </span>
          ))}
        </div>
      ) : null}
      {d.rationale ? (
        <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
          {d.rationale}
        </p>
      ) : null}
    </li>
  );
}

function RejectionRow({ d }: { d: AgentDecision }) {
  const codes = d.guardrail_violations ?? [];
  const ins = (d.inputs ?? {}) as Record<string, unknown>;
  const taskType =
    typeof ins.task_type === "string" ? (ins.task_type as string) : null;
  return (
    <li className="rounded-md border bg-card/30 p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {taskType ? (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px]">
            {taskTypeLabel(taskType)}
          </span>
        ) : null}
        <span className="text-sm font-medium">{d.summary}</span>
        {d.campaign_id ? (
          <span className="text-[11px] text-muted-foreground">
            קמפיין{" "}
            <span dir="ltr" className="font-mono">
              {d.campaign_id}
            </span>
          </span>
        ) : null}
        <span className="ms-auto font-tabular text-[10.5px] text-muted-foreground">
          {relativeHe(d.created_at)}
        </span>
      </div>
      {codes.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {codes.map((c) => (
            <span
              key={c}
              dir="ltr"
              className="rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-[10.5px] text-red-800 ring-1 ring-red-500/30 dark:text-red-300"
            >
              {c}
            </span>
          ))}
        </div>
      ) : null}
      {d.rationale ? (
        <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
          {d.rationale}
        </p>
      ) : null}
    </li>
  );
}

function SkipRow({ d }: { d: AgentDecision }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border bg-card/30 px-3 py-2">
      {d.campaign_id ? (
        <span
          dir="ltr"
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
        >
          {d.campaign_id}
        </span>
      ) : null}
      <span className="text-[13px]">{d.summary}</span>
      {d.rationale ? (
        <span className="text-[11.5px] text-muted-foreground">
          · {d.rationale}
        </span>
      ) : null}
      <span className="ms-auto font-tabular text-[10.5px] text-muted-foreground">
        {relativeHe(d.created_at)}
      </span>
    </li>
  );
}

function ProposalRow({ d }: { d: AgentDecision }) {
  const outs = (d.outputs ?? {}) as Record<string, unknown>;
  const taskType =
    typeof outs.task_type === "string" ? (outs.task_type as string) : null;
  const inner = (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {taskType ? (
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-800 dark:text-emerald-300">
          {taskTypeLabel(taskType)}
        </span>
      ) : null}
      <span className="text-sm font-medium">{d.summary}</span>
      {d.campaign_id ? (
        <span className="text-[11px] text-muted-foreground">
          קמפיין{" "}
          <span dir="ltr" className="font-mono">
            {d.campaign_id}
          </span>
        </span>
      ) : null}
      {d.related_approval_id ? (
        <span
          dir="ltr"
          className="ms-auto font-mono text-[10.5px] text-muted-foreground"
        >
          {d.related_approval_id.slice(0, 8)} ↗
        </span>
      ) : null}
    </div>
  );
  return (
    <li>
      {d.related_approval_id ? (
        <Link
          href={`/approvals/${d.related_approval_id}`}
          className="block rounded-md border bg-card/30 p-3 transition-colors hover:bg-muted/40"
        >
          {inner}
        </Link>
      ) : (
        <div className="rounded-md border bg-card/30 p-3">{inner}</div>
      )}
      {d.rationale ? (
        <p className="mx-3 mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
          {d.rationale}
        </p>
      ) : null}
    </li>
  );
}

function ErrorRow({ d }: { d: AgentDecision }) {
  return (
    <li className="rounded-md border border-red-500/40 bg-red-500/[0.04] p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-red-900 dark:text-red-200">
          {d.summary}
        </span>
        <span
          dir="ltr"
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
        >
          {d.node_name}
        </span>
        <span className="ms-auto font-tabular text-[10.5px] text-muted-foreground">
          {relativeHe(d.created_at)}
        </span>
      </div>
      {d.rationale ? (
        <pre
          dir="ltr"
          className="mt-2 max-h-64 overflow-auto rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-red-900 dark:text-red-200"
        >
          {d.rationale}
        </pre>
      ) : null}
    </li>
  );
}

function GuardrailHistogram({ decisions }: { decisions: AgentDecision[] }) {
  const counts = new Map<string, number>();
  for (const d of decisions) {
    for (const c of d.guardrail_violations ?? []) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  const rows = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map(([code, n]) => (
        <span
          key={code}
          className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] ring-1 ring-amber-500/30"
        >
          <span className="font-tabular font-semibold">{n}×</span>
          <span dir="ltr" className="font-mono text-amber-800 dark:text-amber-300">
            {code}
          </span>
        </span>
      ))}
    </div>
  );
}

// ---- Helpers --------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Hebrew labels for the capability-requirement names that show up in
 * `outputs.blocked_by`. Used for tooltips on the requirement chips — the
 * raw name stays visible so it matches what appears in the agent's logs.
 * See `campaigner/lib/capabilities.py` for the canonical list.
 */
const REQUIREMENT_LABEL_HE: Record<string, string> = {
  tracking_verified: "מעקב (Pixel/CAPI) מאומת",
  primary_kpi_set: "KPI ראשי הוגדר",
  target_value_set: "ערך יעד ל־KPI הוגדר",
  not_in_learning: "הקמפיין יצא משלב הלימוד",
  utilization_7d_at_least_50: "ניצול תקציב ≥50% ב־7 ימים",
  cpa_above_target: "CPA מעל היעד",
  research_sources_at_least_2: "לפחות 2 מקורות מחקר",
  matched_terms_present: "מונחים תואמים נמצאו",
  test_age_at_least_7d: "ניסוי בן 7 ימים לפחות",
};
