"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadRow } from "@/lib/db/types";

const GRADE_LABELS: Record<number, string> = {
  1: "ספאם / לא רלוונטי",
  2: "לא איכותי",
  3: "ממוצע",
  4: "איכותי",
  5: "איכותי מאוד",
};

const GRADE_COLORS: Record<number, string> = {
  1: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  2: "bg-orange-500/15 text-orange-500 border-orange-500/30",
  3: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  4: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  5: "bg-emerald-600/20 text-emerald-600 border-emerald-600/30",
};

export function LeadCard({ lead }: { lead: LeadRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submitGrade(grade: number) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/leads/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lead_id: lead.id,
          business_id: lead.business_id,
          grade,
          note: note.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? `שגיאה (${res.status})`);
        return;
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const fieldEntries: Array<[string, string]> = [];
  for (const entry of lead.field_data ?? []) {
    const v = (entry.values ?? []).join(" / ");
    if (v) fieldEntries.push([entry.name, v]);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-h3 truncate">
            {lead.full_name || "(ללא שם)"}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {lead.email && <span dir="ltr">{lead.email}</span>}
            {lead.phone && <span dir="ltr">{lead.phone}</span>}
            {lead.city && <span>{lead.city}</span>}
            {lead.meta_created_at && (
              <span dir="ltr">
                {new Date(lead.meta_created_at).toLocaleDateString("he-IL")}
              </span>
            )}
          </div>
        </div>
        {lead.latest_grade != null && (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
              GRADE_COLORS[lead.latest_grade],
            )}
          >
            {lead.latest_grade} · {GRADE_LABELS[lead.latest_grade]}
          </span>
        )}
      </div>

      {fieldEntries.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-1 rounded-lg border border-border bg-muted/30 p-2 text-xs sm:grid-cols-2">
          {fieldEntries.map(([k, v]) => (
            <div key={k} className="truncate">
              <span className="text-muted-foreground">{k.replace(/_/g, " ")}:</span>{" "}
              <span className="text-foreground">{v}</span>
            </div>
          ))}
        </div>
      )}

      {lead.latest_grade_note && (
        <p className="mt-2 rounded-lg bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
          הערה אחרונה: {lead.latest_grade_note}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="הערה אופציונלית (למה הליד טוב/גרוע)..."
          className="min-h-[36px] w-full flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 sm:w-auto"
          rows={1}
          disabled={submitting || pending}
        />
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((g) => (
            <button
              key={g}
              onClick={() => submitGrade(g)}
              disabled={submitting || pending}
              className={cn(
                "h-8 w-8 rounded-md border text-sm font-medium transition-colors disabled:opacity-50",
                lead.latest_grade === g
                  ? GRADE_COLORS[g]
                  : "border-border text-muted-foreground hover:border-brand-500/40 hover:text-foreground",
              )}
              title={GRADE_LABELS[g]}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mt-2 text-xs text-destructive">שגיאה: {error.slice(0, 200)}</p>
      )}
    </div>
  );
}
