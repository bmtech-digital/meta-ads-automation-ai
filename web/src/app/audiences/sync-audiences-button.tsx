"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SyncAudiencesButton({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | {
        kind: "ok";
        summary: {
          synced_custom?: number;
          synced_lookalike?: number;
          synced_saved?: number;
          archived?: number;
        };
      }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function trigger() {
    setStatus({ kind: "running" });
    try {
      const res = await fetch("/api/audiences/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ business_id: businessId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus({
          kind: "error",
          message:
            data.error ??
            data.stderr?.slice(-200) ??
            `נכשל (status ${res.status})`,
        });
        return;
      }
      setStatus({ kind: "ok", summary: data.summary });
      startTransition(() => router.refresh());
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={trigger}
        disabled={status.kind === "running" || pending}
        size="sm"
      >
        <RefreshCw
          size={14}
          className={
            status.kind === "running" || pending ? "animate-spin" : undefined
          }
        />
        סנכרן עכשיו
      </Button>
      {status.kind === "ok" ? (
        <span className="text-xs text-muted-foreground">
          {summarizeOk(status.summary)}
        </span>
      ) : null}
      {status.kind === "error" ? (
        <span className="text-xs text-destructive">
          שגיאה: {status.message.slice(0, 120)}
        </span>
      ) : null}
    </div>
  );
}

function summarizeOk(s: {
  synced_custom?: number;
  synced_lookalike?: number;
  synced_saved?: number;
  archived?: number;
}) {
  const parts: string[] = [];
  if (s.synced_custom) parts.push(`${s.synced_custom} custom`);
  if (s.synced_lookalike) parts.push(`${s.synced_lookalike} lookalike`);
  if (s.synced_saved) parts.push(`${s.synced_saved} שמורים`);
  if (s.archived) parts.push(`${s.archived} ארכובו`);
  return parts.length ? `סונכרן: ${parts.join(", ")}` : "ללא שינוי";
}
