"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

const AGE_BUCKETS: Array<{ id: AgeBucket; label: string; maxMs: number | null }> = [
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
  const [selectedUrgencies, setSelectedUrgencies] = useState<Set<Urgency>>(new Set());
  const [age, setAge] = useState<AgeBucket>("all");
  const [onlyHumanReview, setOnlyHumanReview] = useState(false);
  const [campaignFilter, setCampaignFilter] = useState<string | null>(
    initialCampaignFilter ?? null,
  );

  const availableTaskTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of approvals) counts.set(a.task_type, (counts.get(a.task_type) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [approvals]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ageCutoff = AGE_BUCKETS.find((b) => b.id === age)?.maxMs ?? null;
    const now = Date.now();
    return approvals.filter((a) => {
      if (campaignFilter) {
        if (a.target_kind !== "campaign" || a.target_id !== campaignFilter) return false;
      }
      if (selectedTypes.size > 0 && !selectedTypes.has(a.task_type)) return false;
      if (selectedUrgencies.size > 0 && !selectedUrgencies.has(a.urgency)) return false;
      if (ageCutoff !== null) {
        const ageMs = now - new Date(a.created_at).getTime();
        if (ageMs > ageCutoff) return false;
      }
      if (onlyHumanReview && !requiresHumanReview(a)) return false;
      if (q) {
        const label = (TASK_TYPE_LABEL_HE[a.task_type] ?? a.task_type).toLowerCase();
        const haystack = [
          a.task_type,
          label,
          a.target_id ?? "",
          a.rationale,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [approvals, search, selectedTypes, selectedUrgencies, age, onlyHumanReview]);

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

  return (
    <>
      {campaignFilter ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <span>
            מסונן להצעות על קמפיין{" "}
            <span dir="ltr" className="font-mono text-xs">
              {campaignFilter}
            </span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => setCampaignFilter(null)}>
            הצג הכל
          </Button>
        </div>
      ) : null}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי מזהה יעד, נימוק, או סוג משימה"
            dir="auto"
          />

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">דחיפות</span>
            <div className="flex flex-wrap gap-2">
              {URGENCIES.map((u) => {
                const active = selectedUrgencies.has(u);
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setSelectedUrgencies((s) => toggle(s, u))}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      active ? URGENCY_STYLES[u] : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {URGENCY_LABEL_HE[u]}
                  </button>
                );
              })}
            </div>
          </div>

          {availableTaskTypes.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">סוג משימה</span>
              <div className="flex flex-wrap gap-2">
                {availableTaskTypes.map(([type, count]) => {
                  const active = selectedTypes.has(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setSelectedTypes((s) => toggle(s, type))}
                      className={`rounded-full px-3 py-1 text-xs transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {TASK_TYPE_LABEL_HE[type] ?? type}
                      <span className="mr-1 opacity-70">({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">גיל ההצעה</span>
              <div className="flex flex-wrap gap-2">
                {AGE_BUCKETS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setAge(b.id)}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${
                      age === b.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyHumanReview}
                onChange={(e) => setOnlyHumanReview(e.target.checked)}
                className="h-4 w-4"
              />
              <span>רק דורשות בדיקה אנושית</span>
            </label>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              מציג {filtered.length} מתוך {approvals.length}
            </span>
            {activeFilterCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                ניקוי פילטרים ({activeFilterCount})
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>אין התאמות</CardTitle>
            <CardDescription>אף הצעה לא תואמת את הפילטרים הנוכחיים.</CardDescription>
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
            const targetLabel = a.target_kind ? TARGET_KIND_LABEL_HE[a.target_kind] : "";
            return (
              <Card key={a.id} className={hrReason ? "border-amber-500 border-2" : ""}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${URGENCY_STYLES[a.urgency]}`}
                        >
                          {URGENCY_LABEL_HE[a.urgency]}
                        </span>
                        <span className="font-semibold">{taskTypeLabel(a.task_type)}</span>
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
                    <span className="text-xs text-muted-foreground">{relativeHe(a.created_at)}</span>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-sm">{truncate(a.rationale)}</p>
                  {impact ? (
                    <div className="rounded-md bg-muted px-3 py-2 text-sm">
                      <span className="text-muted-foreground">השפעה צפויה: </span>
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
