"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Search, X } from "lucide-react";
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
  formatExpectedImpact,
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
        <div className="flex flex-col gap-4">
          {filtered.map((a) => {
            const hrReason = requiresHumanReview(a);
            const impact = formatExpectedImpact(a.expected_impact);
            const targetLabel = a.target_kind
              ? TARGET_KIND_LABEL_HE[a.target_kind]
              : "";
            return (
              <Card
                key={a.id}
                className={hrReason ? "border-amber-500 border-2" : ""}
              >
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${URGENCY_STYLES[a.urgency]}`}
                        >
                          {URGENCY_LABEL_HE[a.urgency]}
                        </span>
                        <span className="font-semibold">
                          {taskTypeLabel(a.task_type)}
                        </span>
                        {a.task_type === "alert" &&
                        (a.payload as Record<string, unknown> | null)
                          ?.acknowledgment_only === true ? (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                            התראה לאישור-קבלה
                          </span>
                        ) : null}
                        {targetLabel && a.target_id ? (
                          <span className="text-sm text-muted-foreground">
                            {targetLabel}:{" "}
                            <span dir="ltr" className="font-mono text-xs">
                              {a.target_id}
                            </span>
                          </span>
                        ) : null}
                      </div>
                      {hrReason ? (
                        <Badge className="bg-amber-500 hover:bg-amber-600 text-white">
                          ⚠️ דורש בדיקה: {hrReason}
                        </Badge>
                      ) : null}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {relativeHe(a.created_at)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-sm">{truncate(a.rationale)}</p>
                  {impact ? (
                    <div className="rounded-md bg-muted px-3 py-2 text-sm">
                      <span className="text-muted-foreground">
                        השפעה צפויה:{" "}
                      </span>
                      <span className="font-semibold">{impact}</span>
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <Link href={`/approvals/${a.id}`}>
                      <Button>פתח וסקור</Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

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
