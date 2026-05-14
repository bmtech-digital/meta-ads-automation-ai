"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ResearchBenchmarkButton — kicks off `daily_observe_propose` so the agent
 * researches a business-specific KPI benchmark via WebSearch, then polls
 * until the new approval lands in the DB (or times out at 3 min).
 *
 * The Python agent run takes ~1-3 minutes (Claude headless + WebSearch +
 * multi-step decision tree + DB writes). The trigger endpoint returns 202
 * almost immediately because the runner is spawned async, so a "we're done"
 * UX based on the fetch's return is wrong — that's the gap the user hit.
 *
 * State machine:
 *   idle ──click──▶ running (polling every 8s) ──┬──▶ done (new approval id)
 *                                                  ├──▶ timeout (180s elapsed)
 *                                                  └──▶ error (trigger failed)
 *
 * The "new approval id" check uses the prop `currentResearchApprovalId` — when
 * it changes from the value we saw at click-time, the agent finished.
 */
export function ResearchBenchmarkButton({
  currentResearchApprovalId,
}: {
  /** Latest set_kpi_target approval id for this business+KPI, from server. */
  currentResearchApprovalId: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<
    "idle" | "running" | "done" | "timeout" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const seenApprovalIdRef = useRef<string | null>(currentResearchApprovalId);
  const [elapsedSec, setElapsedSec] = useState(0);

  // When polling lands a NEW approval id (different from what we saw at
  // click), the agent finished. Transition to done. Note: refs avoid making
  // currentResearchApprovalId a useEffect dep that would re-fire on every
  // unrelated prop change.
  useEffect(() => {
    if (phase !== "running") return;
    if (
      currentResearchApprovalId &&
      currentResearchApprovalId !== seenApprovalIdRef.current
    ) {
      setPhase("done");
      // Linger on "done" for 2s so the user sees confirmation, then
      // re-render the page so the green tile state takes over.
      setTimeout(() => {
        seenApprovalIdRef.current = currentResearchApprovalId;
        router.refresh();
        setPhase("idle");
      }, 2000);
    }
  }, [currentResearchApprovalId, phase, router]);

  // Poll + elapsed-time counter while running.
  useEffect(() => {
    if (phase !== "running") return;
    const startedAt = startedAtRef.current ?? Date.now();
    const tick = setInterval(() => {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      setElapsedSec(elapsed);
      if (elapsed >= 180) {
        setPhase("timeout");
        return;
      }
      // Pull fresh server data — page reloads `currentResearchApprovalId`
      // from `getLatestKpiResearch`. When the prop changes, the effect
      // above flips us to done.
      router.refresh();
    }, 8000);
    return () => clearInterval(tick);
  }, [phase, router]);

  const onClick = async () => {
    if (phase === "running") return; // guard double-click
    setError(null);
    seenApprovalIdRef.current = currentResearchApprovalId;
    startedAtRef.current = Date.now();
    setElapsedSec(0);
    setPhase("running");
    try {
      const res = await fetch("/api/runners/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow: "daily_observe_propose" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setError(body.error ?? `HTTP ${res.status}`);
        setPhase("error");
      }
      // 202 success → leave in "running" state until polling finds the approval
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
      setPhase("error");
    }
  };

  const label =
    phase === "running"
      ? `הסוכן חוקר... ${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`
      : phase === "done"
        ? "המחקר מוכן ✓"
        : phase === "timeout"
          ? "לא חזרה תוצאה — נסה שוב"
          : phase === "error"
            ? `שגיאה: ${error ?? "—"}`
            : "חקור יעד לעסק שלי";

  const icon =
    phase === "running" ? (
      <Loader2 size={11} className="animate-spin" />
    ) : phase === "done" ? (
      <CheckCircle2 size={11} className="text-emerald-600 dark:text-emerald-400" />
    ) : phase === "timeout" || phase === "error" ? (
      <AlertTriangle size={11} className="text-amber-600 dark:text-amber-400" />
    ) : (
      <Search size={11} />
    );

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={phase === "running"}
        className="h-7 gap-1.5 px-2 text-[11.5px] font-medium"
        title="הסוכן ירוץ ב-Python, יחקור WebSearch לפי הוורטיקל והקהל שלך, וייצור הצעת set_kpi_target עם המחקר המלא"
      >
        {icon}
        {label}
      </Button>
      {phase === "running" ? (
        <span className="text-[10px] leading-tight text-muted-foreground">
          ריצה ממוצעת 1-3 דקות. בטוח לחכות — אפשר לעבור עמוד וזה ימשיך ברקע.
        </span>
      ) : null}
      {phase === "timeout" ? (
        <span className="text-[10px] leading-tight text-amber-700 dark:text-amber-400">
          חרגנו מ-3 דקות בלי שהסוכן יצר approval. ייתכן שנכשל — בדוק
          ב-dev console / docker logs campaigner.
        </span>
      ) : null}
    </div>
  );
}
