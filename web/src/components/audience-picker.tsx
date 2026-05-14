"use client";

/**
 * AudiencePicker — multi-select reusable audience selector.
 *
 * Phase 1 of the Campaigner Mastery Plan (docs/plans/campaigner-mastery-plan.md
 * §4.2). Renders a searchable list of audiences with per-row "כלול / החרג"
 * controls and emits the three-array shape that `expand_audience` and
 * `new_campaign` payloads expect:
 *
 *   {
 *     custom_audience_ids:    string[],
 *     lookalike_audience_ids: string[],
 *     excluded_audience_ids:  string[],
 *   }
 *
 * The parent passes the value verbatim into the proposal payload — no
 * additional kind-routing logic in the parent. Lookalike audiences the
 * operator clicks "כלול" on land in `lookalike_audience_ids`; custom
 * audiences land in `custom_audience_ids`. Excluded audiences land in
 * `excluded_audience_ids` regardless of kind (both arrays accept exclusions
 * in Meta's targeting spec).
 *
 * Saved audiences are intentionally *not* selectable — they apply via Meta's
 * own targeting spec, not via the CA/LAL ID arrays. Special-ad audiences
 * are read-only in Phase 1 (regulated category).
 *
 * Visual: server-component parent fetches the audience list once and passes
 * it in; this component does no I/O.
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { AudienceRow } from "@/lib/db/types";
import { cn } from "@/lib/utils";

export interface AudiencePickerValue {
  custom_audience_ids: string[];
  lookalike_audience_ids: string[];
  excluded_audience_ids: string[];
}

export const EMPTY_AUDIENCE_PICKER_VALUE: AudiencePickerValue = {
  custom_audience_ids: [],
  lookalike_audience_ids: [],
  excluded_audience_ids: [],
};

interface AudiencePickerProps {
  audiences: AudienceRow[];
  value: AudiencePickerValue;
  onChange: (next: AudiencePickerValue) => void;
  disabled?: boolean;
  className?: string;
  emptyHint?: string;
}

const SUBTYPE_LABEL_HE: Record<string, string> = {
  WEBSITE: "מבקרי אתר",
  CUSTOMER_FILE: "קובץ לקוחות",
  LEAD_GENERATION: "טופסי לידים",
  ENGAGEMENT: "התעניינו בעמוד",
  VIDEO: "צופי וידאו",
  APP_ACTIVITY: "משתמשי אפליקציה",
  LOOKALIKE: "דומה",
};

function formatSize(low: number | null, up: number | null): string {
  if (low == null && up == null) return "—";
  if (low === up || up == null) return formatNumber(low ?? 0);
  if (low == null) return `עד ${formatNumber(up)}`;
  return `${formatNumber(low)}–${formatNumber(up)}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

type RowState = "none" | "include" | "exclude";

function rowStateFor(
  audience: AudienceRow,
  value: AudiencePickerValue,
): RowState {
  if (value.excluded_audience_ids.includes(audience.meta_audience_id)) {
    return "exclude";
  }
  if (audience.kind === "lookalike") {
    return value.lookalike_audience_ids.includes(audience.meta_audience_id)
      ? "include"
      : "none";
  }
  return value.custom_audience_ids.includes(audience.meta_audience_id)
    ? "include"
    : "none";
}

function withRowState(
  audience: AudienceRow,
  value: AudiencePickerValue,
  next: RowState,
): AudiencePickerValue {
  const id = audience.meta_audience_id;
  const removeFromAll = {
    custom_audience_ids: value.custom_audience_ids.filter((x) => x !== id),
    lookalike_audience_ids: value.lookalike_audience_ids.filter((x) => x !== id),
    excluded_audience_ids: value.excluded_audience_ids.filter((x) => x !== id),
  };
  if (next === "none") return removeFromAll;
  if (next === "exclude") {
    return {
      ...removeFromAll,
      excluded_audience_ids: [...removeFromAll.excluded_audience_ids, id],
    };
  }
  // include
  if (audience.kind === "lookalike") {
    return {
      ...removeFromAll,
      lookalike_audience_ids: [...removeFromAll.lookalike_audience_ids, id],
    };
  }
  return {
    ...removeFromAll,
    custom_audience_ids: [...removeFromAll.custom_audience_ids, id],
  };
}

export function AudiencePicker({
  audiences,
  value,
  onChange,
  disabled = false,
  className,
  emptyHint,
}: AudiencePickerProps) {
  const [query, setQuery] = useState("");

  // Saved audiences apply via targeting spec, not via CA/LAL arrays.
  // Special-ad audiences are read-only in Phase 1 (Meta regulated category).
  const selectable = useMemo(
    () =>
      audiences.filter(
        (a) => a.kind === "custom" || a.kind === "lookalike",
      ),
    [audiences],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return selectable;
    return selectable.filter((a) => a.name.toLowerCase().includes(q));
  }, [selectable, query]);

  const totalSelected =
    value.custom_audience_ids.length +
    value.lookalike_audience_ids.length +
    value.excluded_audience_ids.length;

  if (selectable.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground",
          className,
        )}
      >
        {emptyHint ??
          "אין קהלים זמינים לבחירה. הרץ סנכרון בעמוד הקהלים, או הצע יצירת קהל חדש."}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground"
            style={{ insetInlineStart: "0.6rem" }}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חפש קהל לפי שם"
            disabled={disabled}
            className="h-9 w-full rounded-md border border-border bg-background ps-8 pe-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-brand-500/50"
          />
        </div>
        {totalSelected > 0 ? (
          <button
            type="button"
            onClick={() => onChange(EMPTY_AUDIENCE_PICKER_VALUE)}
            disabled={disabled}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            נקה ({totalSelected})
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          לא נמצאו קהלים תואמים את החיפוש.
        </p>
      ) : (
        <ul className="space-y-2" dir="rtl">
          {filtered.map((a) => {
            const rs = rowStateFor(a, value);
            const subtypeLabel = a.subtype
              ? SUBTYPE_LABEL_HE[a.subtype] ?? a.subtype
              : null;
            return (
              <li
                key={a.id}
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  rs === "include"
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : rs === "exclude"
                      ? "border-rose-500/40 bg-rose-500/5"
                      : "border-border bg-card",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {a.kind === "lookalike" ? "Lookalike" : "Custom"}
                      {subtypeLabel ? ` · ${subtypeLabel}` : ""}
                      {" · גודל: "}
                      {formatSize(
                        a.approximate_count_lower_bound,
                        a.approximate_count_upper_bound,
                      )}
                    </p>
                  </div>
                  <SegmentedRowControl
                    state={rs}
                    disabled={disabled}
                    onSelect={(next) =>
                      onChange(withRowState(a, value, next))
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SegmentedRowControl({
  state,
  onSelect,
  disabled,
}: {
  state: RowState;
  onSelect: (next: RowState) => void;
  disabled: boolean;
}) {
  const options: { value: RowState; label: string }[] = [
    { value: "include", label: "כלול" },
    { value: "exclude", label: "החרג" },
    { value: "none", label: "—" },
  ];
  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
      {options.map((opt) => {
        const active = state === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(opt.value)}
            className={cn(
              "min-w-[2.75rem] px-2 py-1 text-xs transition-colors",
              active
                ? opt.value === "include"
                  ? "bg-emerald-500/15 text-emerald-500"
                  : opt.value === "exclude"
                    ? "bg-rose-500/15 text-rose-500"
                    : "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/70",
              "disabled:opacity-50",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
