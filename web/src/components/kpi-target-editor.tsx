"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Vertical } from "@/lib/db/types";
import {
  type KpiKind,
  classifyAgainstBenchmark,
  formatBandHe,
  getBenchmark,
  verdictHe,
} from "@/lib/kpi-benchmarks";

/**
 * KpiTargetEditor — the "יעדי ביצוע" input on /business-knowledge.
 *
 * The plain `<Input type="number">` we had on 2026-05-12 Block 1 was wrong:
 * it asked the operator to set ₪80 for CPL with no context — no market band,
 * no reality-check, no signal whether that number is sane for the vertical.
 * The user can't make an informed choice that way.
 *
 * This editor surfaces:
 *   - The market band for the (vertical, kpi) pair via `getBenchmark`
 *   - A live verdict badge as the operator types (good / ok / worrying /
 *     implausible) via `classifyAgainstBenchmark` + `verdictHe`
 *   - The source note explaining where the band comes from
 *
 * The verdict is client-side because it needs to update on every keystroke.
 * Field name + form submission stay identical to the prior plain-input shape,
 * so the existing `businessKnowledgeFormSchema` + saveKnowledgeAction work
 * unchanged.
 *
 * When the band is `null` for this (vertical, kpi) — e.g. ROAS for a leads
 * business — the editor stays editable but skips the verdict and warns the
 * operator that this isn't typically tracked for their vertical.
 */
export function KpiTargetEditor({
  kpi,
  vertical,
  defaultValue,
  inputName,
  label,
  helpText,
}: {
  kpi: KpiKind;
  vertical: Vertical | null;
  defaultValue: number | null;
  inputName: string;
  label: string;
  helpText: string;
}) {
  const [value, setValue] = useState(
    defaultValue !== null ? String(defaultValue) : "",
  );
  const band = getBenchmark(vertical, kpi);
  const trimmed = value.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const parsedValid = parsed !== null && Number.isFinite(parsed) && parsed > 0;
  const verdict =
    parsedValid && band
      ? classifyAgainstBenchmark(parsed, kpi, band)
      : null;
  const verdictInfo = verdict ? verdictHe(verdict) : null;

  const toneClass = {
    good: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-700",
    ok: "bg-muted text-muted-foreground ring-1 ring-border",
    warn: "bg-amber-100 text-amber-900 ring-1 ring-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-700",
    bad: "bg-red-100 text-red-900 ring-1 ring-red-300 dark:bg-red-950/50 dark:text-red-200 dark:ring-red-700",
  };

  const placeholder = band
    ? kpi === "roas"
      ? `לדוגמה ${band.median}`
      : `לדוגמה ${band.median}`
    : "—";
  const step = kpi === "roas" ? "0.1" : "0.5";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={inputName}>{label}</Label>
        {verdictInfo ? (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${toneClass[verdictInfo.tone]}`}
            title={
              verdict === "implausible"
                ? "הערך שהזנת נמוך באופן לא ריאלי לתחום שלך — הסוכן יסמן אותו לבדיקה"
                : verdict === "off_band"
                  ? "הערך מחוץ לטווח הנהוג — הסוכן יבקש לוודא"
                  : ""
            }
          >
            {verdictInfo.label}
          </span>
        ) : null}
      </div>
      <Input
        id={inputName}
        name={inputName}
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
      />
      {band ? (
        <div className="rounded-md border bg-muted/30 px-2.5 py-1.5">
          <div className="text-[11.5px] text-muted-foreground">
            <span className="font-semibold">טווח שוק בישראל: </span>
            <span dir="auto">{formatBandHe(kpi, band)}</span>
          </div>
          <div className="mt-0.5 text-[10.5px] italic text-muted-foreground/80">
            {band.source_note}
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed bg-muted/20 px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
          לא רלוונטי ל-{vertical ?? "vertical"} — אפשר להשאיר ריק.
        </div>
      )}
      <p className="text-xs text-muted-foreground">{helpText}</p>
    </div>
  );
}
