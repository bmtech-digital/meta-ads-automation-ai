import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type RunNarrative,
  SHAPE_LABEL_HE,
  shapeTone,
  TONE_CHIP_CLASS,
} from "@/lib/runs-summary";

/**
 * Debug-only TL;DR card on `/runs/[run_id]`. Renders the auto-generated
 * Hebrew sentence from `buildRunNarrative` plus a shape chip and a small
 * counts strip. The whole point is to answer "why did this run look the
 * way it did?" before the operator has to scroll through the trail.
 *
 * See `docs/plans/debug-runs-page.md` §5.1.
 */
export function RunNarrative({ narrative }: { narrative: RunNarrative }) {
  const tone = shapeTone(narrative.shape);
  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            דיבאג · TL;DR
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${TONE_CHIP_CLASS[tone]}`}
          >
            {SHAPE_LABEL_HE[narrative.shape]}
          </span>
        </div>
        <CardTitle className="text-h3 mt-2 leading-snug">
          {narrative.sentence}
        </CardTitle>
        <CardDescription>
          סיכום אוטומטי שמוסבר מתוך רשומות ה־agent_decisions של הריצה.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5 text-[12px]">
          <NarrativeStat label="תצפיות" value={narrative.observations} />
          {narrative.wouldPropose > 0 ? (
            <NarrativeStat
              label="ממצאים בני־פעולה"
              value={narrative.wouldPropose}
            />
          ) : null}
          {narrative.blocked > 0 ? (
            <NarrativeStat
              label="חסומים ע״י capability"
              value={narrative.blocked}
              tone="warn"
            />
          ) : null}
          {narrative.rejected > 0 ? (
            <NarrativeStat
              label="נדחו ע״י guardrails"
              value={narrative.rejected}
              tone="warn"
            />
          ) : null}
          {narrative.proposals > 0 ? (
            <NarrativeStat
              label="הצעות לתור"
              value={narrative.proposals}
              tone="good"
            />
          ) : null}
          {narrative.skips > 0 ? (
            <NarrativeStat label="דילוגים" value={narrative.skips} />
          ) : null}
          {narrative.errors > 0 ? (
            <NarrativeStat
              label="שגיאות"
              value={narrative.errors}
              tone="bad"
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function NarrativeStat({
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
