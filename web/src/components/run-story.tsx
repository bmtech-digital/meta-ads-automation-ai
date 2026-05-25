import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AgentDecision } from "@/lib/db/types";
import { buildRunStory, type StoryGroup, type StoryStep } from "@/lib/run-story";
import { relativeHe } from "@/lib/approvals-fmt";

/**
 * `<RunStory>` — friendly, non-technical retelling of a single agent run.
 * Always rendered on `/runs/[run_id]`. Reads the same `agent_decisions`
 * trail the technical sections use, but frames it as a per-campaign
 * Hebrew diary:
 *
 *   1. Header paragraph — what happened in this run, in one sentence.
 *   2. One card per campaign (and one for account-level observations).
 *      Inside each card: a vertical timeline of steps the agent took.
 *      Steps that *would have* produced an action but were blocked are
 *      highlighted with "the agent would have proposed X but couldn't
 *      because Y."
 *
 * Server component — no client JS. Native `<details>` lets the operator
 * peek at the agent's full rationale per step without bloating the page.
 */
export function RunStory({ decisions }: { decisions: AgentDecision[] }) {
  const { groups, intro } = buildRunStory(decisions);

  return (
    <Card>
      <CardHeader>
        <CardTitle>סיפור הריצה</CardTitle>
        <CardDescription className="leading-relaxed">{intro}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">לא נרשמו צעדים בריצה.</p>
        ) : (
          groups.map((g) => <GroupCard key={g.campaignId ?? "_"} group={g} />)
        )}
      </CardContent>
    </Card>
  );
}

function GroupCard({ group }: { group: StoryGroup }) {
  const accent = group.hasError
    ? "border-red-400/60"
    : group.producedProposal
      ? "border-emerald-500/50"
      : group.hasBlocked
        ? "border-amber-500/50"
        : "border-border";
  return (
    <section
      className={`rounded-lg border bg-card/40 p-4 sm:p-5 ${accent}`}
    >
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15.5px] font-semibold">{group.title}</h3>
        <span className="text-[12px] text-muted-foreground">
          {group.subtitle}
        </span>
      </header>
      <ol className="relative flex flex-col gap-3 ps-6">
        <span
          aria-hidden
          className="absolute inset-y-1 end-auto start-[10px] w-px bg-border"
        />
        {group.steps.map((step) => (
          <Step key={step.d.id} step={step} />
        ))}
      </ol>
    </section>
  );
}

function Step({ step }: { step: StoryStep }) {
  const dotCls =
    step.tone === "good"
      ? "bg-emerald-500"
      : step.tone === "warn"
        ? "bg-amber-500"
        : step.tone === "bad"
          ? "bg-red-500"
          : step.tone === "info"
            ? "bg-sky-500"
            : "bg-muted-foreground/40";
  return (
    <li className="relative">
      <span
        aria-hidden
        className={`absolute end-auto -start-6 top-2 inline-flex h-3 w-3 items-center justify-center rounded-full ring-4 ring-background ${dotCls}`}
      />
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span aria-hidden className="text-[13px]">
            {step.glyph}
          </span>
          <span className="text-[14px] font-medium leading-snug">
            {step.headline}
          </span>
          <span className="ms-auto font-tabular text-[11px] text-muted-foreground">
            {relativeHe(step.d.created_at)}
          </span>
        </div>

        {step.wouldDo ? (
          <div className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/[0.06] px-3 py-2 text-[13px] leading-relaxed">
            <span className="text-amber-800 dark:text-amber-300">
              היה מציע:
            </span>{" "}
            <span>{step.wouldDo}</span>
            {step.blockedBy.length > 0 ? (
              <div className="mt-1.5 text-[12.5px] text-muted-foreground">
                לא הציע כי חסר:{" "}
                <span className="text-foreground">
                  {step.blockedBy.join(" · ")}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {step.guardrailReasons.length > 0 ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/[0.05] px-3 py-2 text-[13px] leading-relaxed">
            <span className="text-amber-800 dark:text-amber-300">
              בדיקת הבטיחות סינטה:
            </span>{" "}
            <span>{step.guardrailReasons.join(" · ")}</span>
          </div>
        ) : null}

        {step.body ? (
          <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <span aria-hidden className="transition-transform group-open:rotate-90">
                ›
              </span>
              <span>הצג את ההסבר המלא של הסוכן</span>
            </summary>
            <p className="mt-1.5 whitespace-pre-wrap rounded-md border bg-background/40 p-3 text-[12.5px] leading-relaxed text-foreground/90">
              {step.body}
            </p>
          </details>
        ) : null}
      </div>
    </li>
  );
}
