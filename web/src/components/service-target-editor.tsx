"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, AlertTriangle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SaveResponse {
  ok: boolean;
  kpi_target?: { value: number; kind: string; set_at: string; source: string };
  error?: string;
  message?: string;
}

/**
 * ServiceTargetEditor — per-service KPI target input. Inline edit, save
 * to /api/business-knowledge/service-target. Persists on product.kpi_target
 * jsonb. The agent reads this for campaigns matching this service.
 *
 * Two modes:
 *   1. Manual entry — operator types a value.
 *   2. "Use research average" — if `derivedFromResearchIls` is provided,
 *      shows a quick-action that sets the target to that value with
 *      source="derived_from_research".
 */
export function ServiceTargetEditor({
  serviceName,
  kind,
  currentValue,
  derivedFromResearchIls,
  unitLabel = "₪",
}: {
  serviceName: string;
  kind: "cpa" | "cpl" | "roas";
  currentValue: number | undefined;
  derivedFromResearchIls?: number;
  unitLabel?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(
    currentValue !== undefined ? String(currentValue) : "",
  );
  const [phase, setPhase] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const save = async (
    valueToSave: number,
    source: "manual" | "derived_from_research",
  ) => {
    setPhase("saving");
    setError(null);
    try {
      const res = await fetch("/api/business-knowledge/service-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_name: serviceName,
          value: valueToSave,
          kind,
          source,
        }),
      });
      const data = (await res.json()) as SaveResponse;
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        setPhase("error");
        return;
      }
      setPhase("done");
      setEditing(false);
      setTimeout(() => router.refresh(), 400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
      setPhase("error");
    }
  };

  const handleManualSave = () => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      setError("ערך חייב להיות מספר חיובי");
      setPhase("error");
      return;
    }
    save(num, "manual");
  };

  if (!editing && currentValue === undefined) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-muted-foreground">
          יעד לשירות הזה לא הוגדר.
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditing(true)}
          className="h-6 gap-1 px-2 text-[10.5px]"
        >
          <Pencil size={10} /> קבע יעד
        </Button>
        {derivedFromResearchIls ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => save(derivedFromResearchIls, "derived_from_research")}
            disabled={phase === "saving"}
            className="h-6 gap-1 px-2 text-[10.5px] text-emerald-700 dark:text-emerald-400"
          >
            {phase === "saving" ? (
              <Loader2 size={10} className="animate-spin" />
            ) : null}
            השתמש בממוצע המחקר ({unitLabel}
            {derivedFromResearchIls.toLocaleString("he-IL")})
          </Button>
        ) : null}
        {phase === "error" && error ? (
          <span className="text-[10.5px] text-red-700 dark:text-red-400">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-[11.5px] text-muted-foreground">יעד:</span>
        <span className="font-tabular text-[14px] font-bold">
          {kind === "roas"
            ? `≥ ${currentValue}x`
            : `≤ ${unitLabel}${currentValue?.toLocaleString("he-IL")}`}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditing(true)}
          className="h-5 gap-1 px-1.5 text-[10px]"
        >
          <Pencil size={9} /> ערוך
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Input
        type="number"
        step="0.1"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-7 w-24 text-[12px]"
        placeholder={kind === "roas" ? "2.5" : "120"}
      />
      <span className="text-[11px] text-muted-foreground">
        {kind === "roas" ? "x" : unitLabel}
      </span>
      <Button
        type="button"
        size="sm"
        onClick={handleManualSave}
        disabled={phase === "saving"}
        className="h-7 gap-1 px-2 text-[10.5px]"
      >
        {phase === "saving" ? (
          <Loader2 size={10} className="animate-spin" />
        ) : (
          <Check size={10} />
        )}
        שמור
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setEditing(false);
          setValue(currentValue !== undefined ? String(currentValue) : "");
        }}
        className="h-7 px-2 text-[10.5px]"
      >
        בטל
      </Button>
      {phase === "error" && error ? (
        <span className="inline-flex items-center gap-1 text-[10.5px] text-red-700 dark:text-red-400">
          <AlertTriangle size={10} /> {error}
        </span>
      ) : null}
    </div>
  );
}
