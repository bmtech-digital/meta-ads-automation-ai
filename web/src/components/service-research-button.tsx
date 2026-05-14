"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ResearchResult {
  ok: boolean;
  service_name?: string;
  research?: {
    market_average_ils: number;
    band_low_ils: number;
    band_high_ils: number;
    sub_vertical: string;
    confidence: string;
    sources: Array<{ title: string; url: string; extracted: string }>;
  };
  summary?: string;
  error?: string;
  message?: string;
}

/**
 * ServiceResearchButton — runs per-service research via the static
 * cpl-infrastructure (no WebSearch, no agent roundtrip). Persists the
 * result to `product.research` on `business_knowledge.products`.
 *
 * Lifecycle:
 *   idle ──click──▶ running ──┬──▶ done (refreshes the page)
 *                              └──▶ error (shows message)
 *
 * Why this exists: operator feedback 2026-05-13 — each AIWEON service
 * needs its own market benchmark, not a shared one. This button writes
 * a research_block per product, keyed by the product name as
 * `campaign_name` (×3 matcher weight).
 */
export function ServiceResearchButton({
  serviceName,
  hasExistingResearch,
}: {
  serviceName: string;
  hasExistingResearch: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setPhase("running");
    setError(null);
    try {
      const res = await fetch("/api/business-knowledge/research-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_name: serviceName }),
      });
      const data = (await res.json()) as ResearchResult;
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        setPhase("error");
        return;
      }
      setPhase("done");
      setTimeout(() => router.refresh(), 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
      setPhase("error");
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={phase === "running"}
        className="h-6 gap-1 px-2 text-[10.5px] font-medium"
        title={
          hasExistingResearch
            ? "הרץ מחקר מחדש על השירות הזה"
            : "חקור את השירות הזה — נקבע סאב-ורטיקל וטווח מחיר ספציפיים אליו"
        }
      >
        {phase === "running" ? (
          <Loader2 size={10} className="animate-spin" />
        ) : phase === "done" ? (
          <Check size={10} className="text-emerald-600 dark:text-emerald-400" />
        ) : phase === "error" ? (
          <AlertTriangle size={10} className="text-amber-600 dark:text-amber-400" />
        ) : (
          <Search size={10} />
        )}
        {phase === "running"
          ? "חוקר..."
          : phase === "done"
            ? "נשמר ✓"
            : hasExistingResearch
              ? "חקור מחדש"
              : "חקור שירות זה"}
      </Button>
      {phase === "error" && error ? (
        <span className="text-[10px] leading-tight text-red-700 dark:text-red-400">
          {error}
        </span>
      ) : null}
    </div>
  );
}
