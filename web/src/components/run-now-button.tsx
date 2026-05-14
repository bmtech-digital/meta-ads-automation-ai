"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HeartbeatFlow } from "@/lib/db/types";

export function RunNowButton({ flow }: { flow: HeartbeatFlow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const onClick = () => {
    setErr(null);
    setSent(false);
    start(async () => {
      const res = await fetch("/api/runners/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow }),
      });
      if (!res.ok) {
        const resp = await res.json().catch(() => ({ error: res.statusText }));
        setErr(resp.error ?? `HTTP ${res.status}`);
        return;
      }
      setSent(true);
      setTimeout(() => {
        router.refresh();
        setSent(false);
      }, 5000);
    });
  };

  const label = pending
    ? "מריץ..."
    : err
      ? `שגיאה: ${err}`
      : sent
        ? "נשלח ✓"
        : "הרץ";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending}
      title={
        err ?? "הרץ עכשיו (local only) — לוקח ~5-10 שניות עד שה-heartbeat נכתב"
      }
      className="h-7 gap-1 px-2 text-[11.5px]"
    >
      <Play size={11} />
      {label}
    </Button>
  );
}
