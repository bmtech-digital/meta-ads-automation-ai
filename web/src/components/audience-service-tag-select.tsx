"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, AlertTriangle } from "lucide-react";

interface Props {
  audienceId: string;
  /** Current service_tag value — null when audience is untagged. */
  currentTag: string | null;
  /** Available product names from business_knowledge.products. */
  productNames: string[];
}

interface MutationResult {
  ok: boolean;
  audience?: { service_tag: string | null };
  error?: string;
  message?: string;
}

const CLEAR_VALUE = "__clear__";

/**
 * AudienceServiceTagSelect — operator-facing dropdown to attribute a synced
 * Meta audience to a specific service.
 *
 * Block 13 follow-up (2026-05-13): closes the gap where audiences pulled by
 * sync_audiences.py kept `service_tag = NULL` forever (only audiences created
 * THROUGH Flow E had the tag set, via the propose_audience.py service-tag arg).
 *
 * Lifecycle: idle → saving → saved / error. After 1.5s the saved/error pip
 * fades back to idle; the parent <Link> re-renders on next navigation.
 */
export function AudienceServiceTagSelect({
  audienceId,
  currentTag,
  productNames,
}: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [optimisticTag, setOptimisticTag] = useState<string | null>(currentTag);

  const onChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next: string | null =
      e.target.value === CLEAR_VALUE ? null : e.target.value;
    setOptimisticTag(next);
    setPhase("saving");
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/audiences/${encodeURIComponent(audienceId)}/service-tag`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ service_tag: next }),
        },
      );
      const data = (await res.json()) as MutationResult;
      if (!res.ok || !data.ok) {
        setOptimisticTag(currentTag); // rollback
        setErrorMsg(data.message ?? data.error ?? `HTTP ${res.status}`);
        setPhase("error");
        return;
      }
      setPhase("saved");
      // Re-fetch the server component so other rows + counts stay in sync.
      router.refresh();
      window.setTimeout(() => setPhase("idle"), 1500);
    } catch (err) {
      setOptimisticTag(currentTag);
      setErrorMsg(err instanceof Error ? err.message : "fetch failed");
      setPhase("error");
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={optimisticTag ?? CLEAR_VALUE}
        onChange={onChange}
        disabled={phase === "saving"}
        className="h-6 rounded border border-border bg-background px-1.5 text-[11px] disabled:opacity-60"
        aria-label="תיוג שירות לקהל"
        title="שייך את הקהל הזה לאחד מהשירותים שלך — הסוכן ישתמש בזה בפילטר 'פר שירות' בריצות הבאות"
      >
        <option value={CLEAR_VALUE}>ללא תיוג</option>
        {productNames.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      {phase === "saving" ? (
        <Loader2 size={11} className="animate-spin text-muted-foreground" />
      ) : phase === "saved" ? (
        <Check size={11} className="text-emerald-600 dark:text-emerald-400" />
      ) : phase === "error" ? (
        <span
          className="inline-flex items-center gap-1 text-[10px] text-red-700 dark:text-red-400"
          title={errorMsg ?? "שגיאה"}
        >
          <AlertTriangle size={11} />
          שגיאה
        </span>
      ) : null}
    </div>
  );
}
