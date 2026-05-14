"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SyncLeadsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | {
        kind: "ok";
        summary: {
          forms_seen?: number;
          leads_synced?: number;
          leads_inserted?: number;
          leads_updated?: number;
        };
      }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function trigger() {
    setStatus({ kind: "running" });
    try {
      const res = await fetch("/api/leads/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setStatus({
          kind: "error",
          message: data.error ?? `נכשל (${res.status})`,
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
          {summarize(status.summary)}
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

function summarize(s: {
  forms_seen?: number;
  leads_synced?: number;
  leads_inserted?: number;
  leads_updated?: number;
}) {
  const parts: string[] = [];
  if (s.forms_seen != null) parts.push(`${s.forms_seen} טפסים`);
  if (s.leads_inserted) parts.push(`${s.leads_inserted} חדשים`);
  if (s.leads_updated) parts.push(`${s.leads_updated} עודכנו`);
  return parts.length ? parts.join(" · ") : "ללא שינוי";
}
