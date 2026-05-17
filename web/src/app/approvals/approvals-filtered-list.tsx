"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  Search,
  Sparkles,
  Target,
  X,
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { Approval, Urgency } from "@/lib/db/types";
import {
  TASK_TYPE_LABEL_HE,
  TARGET_KIND_LABEL_HE,
  URGENCY_LABEL_HE,
  URGENCY_STYLES,
  parsePlanSection,
  parsePlanSteps,
  relativeHe,
  requiresHumanReview,
  taskTypeLabel,
  truncate,
} from "@/lib/approvals-fmt";

type AgeBucket = "all" | "h4" | "h24" | "d7";

const AGE_BUCKETS: Array<{
  id: AgeBucket;
  label: string;
  maxMs: number | null;
}> = [
  { id: "all", label: "הכל", maxMs: null },
  { id: "h4", label: "< 4ש׳", maxMs: 4 * 3600_000 },
  { id: "h24", label: "< 24ש׳", maxMs: 24 * 3600_000 },
  { id: "d7", label: "< 7 ימים", maxMs: 7 * 24 * 3600_000 },
];

const URGENCIES: Urgency[] = ["urgent", "high", "medium", "low"];

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

export function ApprovalsFilteredList({
  approvals,
  initialCampaignFilter,
}: {
  approvals: Approval[];
  initialCampaignFilter?: string | null;
}) {
  const [search, setSearch] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedUrgencies, setSelectedUrgencies] = useState<Set<Urgency>>(
    new Set(),
  );
  const [age, setAge] = useState<AgeBucket>("all");
  const [onlyHumanReview, setOnlyHumanReview] = useState(false);
  const [campaignFilter, setCampaignFilter] = useState<string | null>(
    initialCampaignFilter ?? null,
  );
  // Selected approval drives the right-side detail panel. Defaults to the
  // first item; resyncs whenever filters change so the panel never shows
  // a row that was filtered out.
  const [selectedId, setSelectedId] = useState<string | null>(
    approvals[0]?.id ?? null,
  );

  const availableTaskTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of approvals)
      counts.set(a.task_type, (counts.get(a.task_type) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [approvals]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ageCutoff = AGE_BUCKETS.find((b) => b.id === age)?.maxMs ?? null;
    const now = Date.now();
    return approvals.filter((a) => {
      if (campaignFilter) {
        if (a.target_kind !== "campaign" || a.target_id !== campaignFilter)
          return false;
      }
      if (selectedTypes.size > 0 && !selectedTypes.has(a.task_type))
        return false;
      if (selectedUrgencies.size > 0 && !selectedUrgencies.has(a.urgency))
        return false;
      if (ageCutoff !== null) {
        const ageMs = now - new Date(a.created_at).getTime();
        if (ageMs > ageCutoff) return false;
      }
      if (onlyHumanReview && !requiresHumanReview(a)) return false;
      if (q) {
        const label = (
          TASK_TYPE_LABEL_HE[a.task_type] ?? a.task_type
        ).toLowerCase();
        const haystack = [a.task_type, label, a.target_id ?? "", a.rationale]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [
    approvals,
    search,
    selectedTypes,
    selectedUrgencies,
    age,
    onlyHumanReview,
  ]);

  const activeFilterCount =
    (search ? 1 : 0) +
    selectedTypes.size +
    selectedUrgencies.size +
    (age !== "all" ? 1 : 0) +
    (onlyHumanReview ? 1 : 0) +
    (campaignFilter ? 1 : 0);

  const clearAll = () => {
    setSearch("");
    setSelectedTypes(new Set());
    setSelectedUrgencies(new Set());
    setAge("all");
    setOnlyHumanReview(false);
    setCampaignFilter(null);
  };

  // Toolbar dropdown labels — show selected count inline so the trigger
  // already communicates filter state. "הכל" = no filter applied for that
  // axis. Linear's filter-toolbar pattern: search left, filters right.
  const urgencyLabel =
    selectedUrgencies.size === 0
      ? "כל הדחיפויות"
      : selectedUrgencies.size === 1
        ? URGENCY_LABEL_HE[Array.from(selectedUrgencies)[0]]
        : `${selectedUrgencies.size} דחיפויות`;
  const typeLabel =
    selectedTypes.size === 0
      ? "כל הסוגים"
      : selectedTypes.size === 1
        ? (TASK_TYPE_LABEL_HE[Array.from(selectedTypes)[0]] ??
          Array.from(selectedTypes)[0])
        : `${selectedTypes.size} סוגים`;
  const ageLabel = AGE_BUCKETS.find((b) => b.id === age)?.label ?? "הכל";

  return (
    <>
      {campaignFilter ? (
        <div className="glass-panel flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">
            מסונן להצעות על קמפיין{" "}
            <span dir="ltr" className="mono-ltr text-foreground">
              {campaignFilter}
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={() => setCampaignFilter(null)}
          >
            <X size={14} />
            נקה
          </Button>
        </div>
      ) : null}

      {/* Toolbar — single horizontal row, glass surface, no "form" feel.
          Search expands to fill space; chip-dropdowns are tight on the left
          (RTL: shown on the right). Mobile: wraps to multiple rows but each
          element keeps its pill identity. */}
      <div className="glass-panel sticky top-24 z-30 flex flex-wrap items-center gap-2 rounded-full p-1.5 sm:rounded-full">
        {/* Flexbox layout (icon + input) — avoids absolute positioning
            so the icon sits at the RTL inline-start (right side) naturally,
            next to where the Hebrew placeholder begins. */}
        <div className="flex flex-1 items-center gap-2 ps-3.5 pe-1">
          <Search
            size={15}
            className="shrink-0 text-muted-foreground"
            aria-hidden
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי מזהה יעד, נימוק, או סוג משימה"
            className="h-10 w-full bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/80"
          />
        </div>

        <FilterPill
          label={urgencyLabel}
          active={selectedUrgencies.size > 0}
          onClear={
            selectedUrgencies.size > 0
              ? () => setSelectedUrgencies(new Set())
              : undefined
          }
        >
          <DropdownMenuLabel>דחיפות</DropdownMenuLabel>
          {URGENCIES.map((u) => (
            <DropdownMenuCheckboxItem
              key={u}
              checked={selectedUrgencies.has(u)}
              onCheckedChange={() =>
                setSelectedUrgencies((s) => toggle(s, u))
              }
              onSelect={(e) => e.preventDefault()}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${URGENCY_STYLES[u]}`}
                  aria-hidden
                />
                {URGENCY_LABEL_HE[u]}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </FilterPill>

        {availableTaskTypes.length > 0 ? (
          <FilterPill
            label={typeLabel}
            active={selectedTypes.size > 0}
            onClear={
              selectedTypes.size > 0
                ? () => setSelectedTypes(new Set())
                : undefined
            }
          >
            <DropdownMenuLabel>סוג משימה</DropdownMenuLabel>
            <div className="max-h-72 overflow-y-auto">
              {availableTaskTypes.map(([type, count]) => (
                <DropdownMenuCheckboxItem
                  key={type}
                  checked={selectedTypes.has(type)}
                  onCheckedChange={() =>
                    setSelectedTypes((s) => toggle(s, type))
                  }
                  onSelect={(e) => e.preventDefault()}
                >
                  <span className="flex w-full items-center justify-between gap-3">
                    <span className="truncate">
                      {TASK_TYPE_LABEL_HE[type] ?? type}
                    </span>
                    <span className="font-tabular text-[11px] text-muted-foreground">
                      {count}
                    </span>
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </div>
          </FilterPill>
        ) : null}

        <FilterPill label={`גיל · ${ageLabel}`} active={age !== "all"}>
          <DropdownMenuLabel>גיל ההצעה</DropdownMenuLabel>
          {AGE_BUCKETS.map((b) => (
            <DropdownMenuItem
              key={b.id}
              onSelect={() => setAge(b.id)}
              className={
                age === b.id ? "bg-accent text-accent-foreground" : ""
              }
            >
              {b.label}
            </DropdownMenuItem>
          ))}
        </FilterPill>

        <button
          type="button"
          onClick={() => setOnlyHumanReview((v) => !v)}
          className={`h-9 rounded-full px-3.5 text-[12.5px] font-medium transition-colors ${
            onlyHumanReview
              ? "bg-warning/20 text-warning ring-1 ring-warning/40"
              : "text-muted-foreground hover:bg-muted/40"
          }`}
          aria-pressed={onlyHumanReview}
        >
          דורש בדיקה
        </button>

        {activeFilterCount > 0 ? (
          <button
            type="button"
            onClick={clearAll}
            className="me-1 inline-flex h-9 items-center gap-1 rounded-full px-3 text-[12.5px] text-muted-foreground hover:text-foreground"
            aria-label="נקה את כל הפילטרים"
          >
            <X size={13} />
            נקה ({activeFilterCount})
          </button>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-[12.5px] text-muted-foreground">
        <span>
          מציג {filtered.length} מתוך {approvals.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>אין התאמות</CardTitle>
            <CardDescription>
              אף הצעה לא תואמת את הפילטרים הנוכחיים.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={clearAll}>
              נקה פילטרים
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ApprovalsSplitView
          filtered={filtered}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
        />
      )}
    </>
  );
}

/**
 * Split view per CLAUDE-HANDOFF brief — list (360px on lg+) + rich detail
 * panel. Reasoning block is brand-tinted; metric grid auto-derives from
 * the approval's `expected_impact` shape. Detail panel is sticky on lg+ so
 * it stays in view while the user scans the list.
 */
function ApprovalsSplitView({
  filtered,
  selectedId,
  setSelectedId,
}: {
  filtered: Approval[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}) {
  // Keep the selection consistent with the visible (filtered) list. If the
  // user filters out the currently-selected row, jump to the first visible
  // one so the right panel doesn't show stale or empty content.
  useEffect(() => {
    if (!filtered.some((a) => a.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? null);
    }
  }, [filtered, selectedId, setSelectedId]);

  const selected = useMemo(
    () => filtered.find((a) => a.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start">
      {/* List column (right in RTL on lg+) — scrollable, capped height so
          the sticky detail panel always has a reference point. */}
      <ul className="glass-surface max-h-[720px] overflow-hidden overflow-y-auto rounded-xl">
        {filtered.map((a, i) => (
          <ApprovalListRow
            key={a.id}
            approval={a}
            selected={a.id === selected?.id}
            onSelect={() => setSelectedId(a.id)}
            divider={i > 0}
          />
        ))}
      </ul>

      {/* Detail column (left in RTL on lg+) — sticky so it tracks scroll. */}
      {selected ? (
        <ApprovalDetailPanel approval={selected} />
      ) : null}
    </div>
  );
}

function ApprovalListRow({
  approval,
  selected,
  onSelect,
  divider,
}: {
  approval: Approval;
  selected: boolean;
  onSelect: () => void;
  divider: boolean;
}) {
  const stripeCls =
    approval.urgency === "urgent"
      ? "bg-destructive shadow-[0_0_12px_hsl(0_72%_51%/0.55)]"
      : approval.urgency === "high"
        ? "bg-brand-500 shadow-[0_0_10px_hsl(28_91%_54%/0.5)] dark:bg-brand-400"
        : approval.urgency === "medium"
          ? "bg-warning shadow-[0_0_8px_hsl(38_92%_48%/0.4)]"
          : "bg-muted-foreground/50";
  return (
    <li className={divider ? "border-t border-border/60" : ""}>
      <button
        type="button"
        onClick={onSelect}
        className={`group flex w-full items-start gap-3 px-4 py-4 text-start transition-colors ${
          selected
            ? "bg-brand-500/[0.08]"
            : "hover:bg-foreground/[0.03]"
        }`}
      >
        <span
          className={`mt-1 h-9 w-1 shrink-0 rounded-full ${stripeCls}`}
          aria-label={URGENCY_LABEL_HE[approval.urgency]}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`inline-flex h-[20px] items-center rounded-full px-2 text-[10.5px] font-semibold ${URGENCY_STYLES[approval.urgency]}`}
            >
              {URGENCY_LABEL_HE[approval.urgency]}
            </span>
            <span className="font-tabular text-[11px] text-muted-foreground/80">
              {relativeHe(approval.created_at)}
            </span>
          </div>
          <div className="mt-2 text-[13.5px] font-semibold leading-tight">
            {taskTypeLabel(approval.task_type)}
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {truncate(approval.rationale, 120)}
          </p>
        </div>
      </button>
    </li>
  );
}

function ApprovalDetailPanel({ approval }: { approval: Approval }) {
  const hrReason = requiresHumanReview(approval);
  const targetLabel = approval.target_kind
    ? TARGET_KIND_LABEL_HE[approval.target_kind]
    : "";
  const { main: rationaleMain, plan: rationalePlan } = parsePlanSection(
    approval.rationale,
  );
  const planSteps = rationalePlan ? parsePlanSteps(rationalePlan) : null;
  const metrics = extractMetrics(approval.expected_impact);

  return (
    <article
      key={approval.id}
      className="glass-panel rounded-xl p-6 sm:p-7 lg:sticky lg:top-24 animate-fade-in"
    >
      {/* Header — badges + title + sub */}
      <header className="border-b border-border/60 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex h-[22px] items-center rounded-full px-2.5 text-[11px] font-semibold ${URGENCY_STYLES[approval.urgency]}`}
          >
            דחיפות · {URGENCY_LABEL_HE[approval.urgency]}
          </span>
          <span className="mono-ltr inline-flex h-[22px] items-center rounded-full border border-border bg-muted/40 px-2.5 text-[10.5px] text-muted-foreground">
            {approval.id.slice(0, 8)}…
          </span>
          {targetLabel && approval.target_id ? (
            <span className="inline-flex h-[22px] items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 text-[11px] text-muted-foreground">
              <Target size={11} aria-hidden />
              {targetLabel}:{" "}
              <span className="mono-ltr text-foreground">
                {approval.target_id.slice(0, 12)}
                {approval.target_id.length > 12 ? "…" : ""}
              </span>
            </span>
          ) : null}
          {hrReason ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-[2px] text-[10.5px] font-semibold text-warning ring-1 ring-warning/30">
              דורש בדיקה
            </span>
          ) : null}
        </div>
        <h2 className="mt-3 text-[22px] font-bold leading-tight tracking-[-0.015em]">
          {taskTypeLabel(approval.task_type)}
        </h2>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          הסוכן הציע · {relativeHe(approval.created_at)}
        </p>
      </header>

      {/* Metric grid — auto-derived from expected_impact */}
      {metrics.length > 0 ? (
        <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          {metrics.map((m) => (
            <div
              key={m.key}
              className="rounded-lg border border-border/60 bg-foreground/[0.025] p-3.5 dark:bg-foreground/[0.04]"
            >
              <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                {m.label}
              </div>
              <div className="mt-1 font-tabular text-[19px] font-bold leading-none tracking-[-0.02em]">
                {m.display}
              </div>
              {m.deltaTone ? (
                <div
                  className={`mt-1 text-[11px] font-semibold ${
                    m.deltaTone === "good"
                      ? "text-success"
                      : "text-destructive"
                  }`}
                >
                  {m.deltaTone === "good"
                    ? "השפעה חיובית"
                    : "השפעה שלילית"}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Reasoning block — brand-tinted callout */}
      <div className="mt-5 rounded-lg border border-brand-500/25 bg-brand-500/[0.06] p-4">
        <div className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand-600 dark:text-brand-300">
          <Sparkles size={12} aria-hidden />
          נימוק הסוכן
        </div>
        <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-foreground">
          {rationaleMain}
        </p>
        {planSteps && planSteps.length > 0 ? (
          <div className="mt-3 border-t border-brand-500/20 pt-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand-600 dark:text-brand-300">
              תוכנית
            </div>
            <ol className="mt-1.5 list-inside list-decimal space-y-1 text-[12.5px] text-foreground/90">
              {planSteps.map((step, i) => (
                <li key={i} className="leading-relaxed">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>

      {/* Actions — open full review page (real approve/reject lives there) */}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Link
          href={`/approvals/${approval.id}`}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-[13px] font-medium transition-colors hover:border-brand-500/40 hover:bg-brand-500/[0.06]"
        >
          פתח לסקירה מלאה
          <ChevronLeft size={14} />
        </Link>
      </div>
    </article>
  );
}

type DerivedMetric = {
  key: string;
  label: string;
  display: string;
  deltaTone: "good" | "bad" | null;
};

/**
 * Convert the raw `expected_impact` blob (any agent can write arbitrary
 * keys) into a small set of named metric cells. We rely on key naming
 * conventions: `*_pct` = percent, `*_ils` = NIS, `confidence` = 0–1 ratio.
 * Unknown numeric keys fall through with raw value. Strings become a
 * single key/value cell. Unparseable shapes are skipped silently — the
 * grid just doesn't render that row.
 */
function extractMetrics(
  impact: Record<string, unknown> | null,
): DerivedMetric[] {
  if (!impact) return [];
  const out: DerivedMetric[] = [];
  for (const [k, v] of Object.entries(impact)) {
    if (v === null || v === undefined) continue;
    const lc = k.toLowerCase();
    const label = METRIC_LABEL_HE[lc] ?? humanizeKey(k);
    if (typeof v === "number") {
      if (lc === "confidence" || lc === "agent_confidence") {
        out.push({
          key: k,
          label,
          display: `${Math.round(v * (v <= 1 ? 100 : 1))}%`,
          deltaTone: null,
        });
        continue;
      }
      if (lc.includes("cpl")) {
        out.push({
          key: k,
          label,
          display: signedPct(v),
          // Lower CPL is good → negative delta is "good" tone.
          deltaTone: v < 0 ? "good" : v > 0 ? "bad" : null,
        });
        continue;
      }
      if (lc.includes("pct") || lc.includes("percent")) {
        out.push({
          key: k,
          label,
          display: signedPct(v),
          deltaTone: v > 0 ? "good" : v < 0 ? "bad" : null,
        });
        continue;
      }
      if (lc.includes("ils") || lc.includes("budget") || lc.includes("spend")) {
        out.push({
          key: k,
          label,
          display: `${v > 0 ? "+" : ""}₪${Math.abs(Math.round(v)).toLocaleString("he-IL")}${v < 0 ? "−" : ""}`,
          deltaTone: null,
        });
        continue;
      }
      // Generic number — count of leads, ads, etc. Positive = good by default.
      out.push({
        key: k,
        label,
        display: `${v > 0 ? "+" : ""}${v.toLocaleString("he-IL")}`,
        deltaTone: v > 0 ? "good" : v < 0 ? "bad" : null,
      });
      continue;
    }
    if (typeof v === "string" && v.trim().length > 0) {
      out.push({ key: k, label, display: v, deltaTone: null });
    }
  }
  return out;
}

function signedPct(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(v % 1 === 0 ? 0 : 1)}%`;
}

function humanizeKey(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const METRIC_LABEL_HE: Record<string, string> = {
  cpl_pct: "השפעה צפויה · CPL",
  ctr_pct: "שיפור CTR צפוי",
  leads: "תוספת לידים",
  leads_weekly: "תוספת לידים שבועית",
  spend_delta_ils: "השפעה תקציבית",
  spend_ils: "השפעה תקציבית",
  spend_delta: "השפעה תקציבית",
  confidence: "ביטחון הסוכן",
  agent_confidence: "ביטחון הסוכן",
};

/**
 * FilterPill — a single dropdown trigger styled as a pill that fits inside
 * the floating toolbar. Active state lifts to brand-tinted. Optional onClear
 * exposes an inline ✕ to remove the filter without opening the dropdown.
 */
function FilterPill({
  label,
  active,
  onClear,
  children,
}: {
  label: string;
  active: boolean;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-colors ${
              active
                ? "bg-brand-500/15 text-brand-600 ring-1 ring-brand-500/35 dark:text-brand-400"
                : "text-muted-foreground hover:bg-muted/40"
            }`}
          >
            <span className="max-w-[150px] truncate">{label}</span>
            <ChevronDown
              size={13}
              className="opacity-70"
              strokeWidth={2.5}
              aria-hidden
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {children}
          {onClear ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onClear}
                className="text-muted-foreground"
              >
                <X size={13} className="ms-auto" />
                נקה
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
