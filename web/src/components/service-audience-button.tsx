"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Users, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TriggerResult {
  ok: boolean;
  service_name?: string;
  flow?: string;
  message?: string;
  error?: string;
}

interface StatusResult {
  ok: boolean;
  running: boolean;
  last_start_at: string | null;
  last_end_at: string | null;
  last_error_at: string | null;
  last_status: "idle" | "running" | "completed" | "errored";
  pending_audience_count: number;
}

type Phase = "idle" | "running" | "done" | "error";

const POLL_MS = 2500;
const MAX_POLL_DURATION_MS = 4 * 60 * 1000; // 4 min — agent normally finishes in 60-90s

/**
 * ServiceAudienceButton — operator-initiated trigger for Flow E.
 *
 * Block 13 follow-up (2026-05-13): polls `/audience-flow-status` every 2.5s
 * while the runner is in flight so the operator sees real progress (rather
 * than the previous lying "הוצע ✓" after 1.5s).
 *
 * Lifecycle:
 *   idle ──click──▶ running (poll status) ──┬──▶ done (heartbeat=end) — shows pending count + link to /approvals
 *                                            ├──▶ error (heartbeat=error)
 *                                            └──▶ timeout (4 min — no heartbeat=end yet, falls back to "still running" UI)
 *
 * Dedupe: if the API returns 409 `already_running`, the button latches into
 * "running" and starts polling the same way as a fresh spawn would.
 */
export function ServiceAudienceButton({ serviceName }: { serviceName: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartRef = useRef<number>(0);

  // Cleanup any pending poll when unmounting.
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const poll = async () => {
    try {
      const res = await fetch(
        `/api/business-knowledge/audience-flow-status?service_name=${encodeURIComponent(serviceName)}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as StatusResult;
      if (!res.ok || !data.ok) {
        setErrorMsg("שגיאת רשת בעדכון סטטוס");
        setPhase("error");
        stopPolling();
        return;
      }

      setPendingCount(data.pending_audience_count);

      if (data.last_status === "errored") {
        setErrorMsg("הריצה נכשלה — בדוק לוגים של campaigner");
        setPhase("error");
        stopPolling();
        return;
      }
      if (data.last_status === "completed" && !data.running) {
        setPhase("done");
        stopPolling();
        router.refresh();
        return;
      }

      // Still running. Check we haven't exceeded the cap.
      if (Date.now() - pollStartRef.current > MAX_POLL_DURATION_MS) {
        setErrorMsg(
          "הריצה לוקחת יותר מהצפוי — בדוק /approvals ידנית בעוד דקה",
        );
        setPhase("error");
        stopPolling();
        return;
      }

      pollTimerRef.current = setTimeout(poll, POLL_MS);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "שגיאת רשת");
      setPhase("error");
      stopPolling();
    }
  };

  const startPolling = () => {
    pollStartRef.current = Date.now();
    stopPolling();
    pollTimerRef.current = setTimeout(poll, POLL_MS);
  };

  const onClick = async () => {
    setPhase("running");
    setErrorMsg(null);
    setPendingCount(0);
    try {
      const res = await fetch("/api/business-knowledge/propose-audiences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_name: serviceName }),
      });
      const data = (await res.json()) as TriggerResult;
      if (res.status === 409) {
        // Already running — latch into the same polling path as a fresh spawn.
        startPolling();
        return;
      }
      if (!res.ok || !data.ok) {
        setErrorMsg(data.message ?? data.error ?? `HTTP ${res.status}`);
        setPhase("error");
        return;
      }
      startPolling();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "fetch failed");
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
        title="הסוכן יבדוק את הקהלים הקיימים בחשבון Meta, יחבר אותם לשירות הזה, ויציע 1-3 קהלים חדשים (Custom / Lookalike / Saved) לאישור שלך"
      >
        {phase === "running" ? (
          <Loader2 size={10} className="animate-spin" />
        ) : phase === "done" ? (
          <Check size={10} className="text-emerald-600 dark:text-emerald-400" />
        ) : phase === "error" ? (
          <AlertTriangle size={10} className="text-amber-600 dark:text-amber-400" />
        ) : (
          <Users size={10} />
        )}
        {phase === "running"
          ? "חוקר קהלים..."
          : phase === "done"
            ? pendingCount > 0
              ? `${pendingCount} הצעות חדשות`
              : "הריצה הסתיימה"
            : "הצע קהל מבוסס מחקר"}
      </Button>
      {phase === "running" ? (
        <span className="text-[10px] leading-tight text-muted-foreground">
          ~30-90 שניות. ההצעות יגיעו ל-/approvals.
        </span>
      ) : null}
      {phase === "done" ? (
        <span className="text-[10px] leading-tight text-emerald-700 dark:text-emerald-400">
          {pendingCount > 0 ? (
            <>
              <Link
                href="/approvals"
                className="underline-offset-2 hover:underline"
              >
                עבור לאישורים →
              </Link>{" "}
              ({pendingCount} בהמתנה לשירות זה)
            </>
          ) : (
            <>הסוכן לא מצא lane חדש להציע השבוע (אולי כבר יש לך את כולם)</>
          )}
        </span>
      ) : null}
      {phase === "error" && errorMsg ? (
        <span className="text-[10px] leading-tight text-red-700 dark:text-red-400">
          {errorMsg}
        </span>
      ) : null}
    </div>
  );
}
