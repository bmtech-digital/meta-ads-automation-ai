"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Download, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImportResponse {
  ok: boolean;
  preview: boolean;
  products?: Array<{ name: string; description?: string }>;
  source_path?: string;
  summary?: string;
  error?: string;
  message?: string;
  products_count?: number;
}

/**
 * AiweonImportButton — two-step import for the active business's products.
 *
 *   1. Click "ייבא שירותים מ-AIWEON" → POST with preview=true → shows the
 *      product list inline so the operator can review before committing.
 *   2. Click "אשר ייבוא" → POST with preview=false → REPLACES products[]
 *      and refreshes the page.
 *
 * Replacement (not merge) is intentional: stale products are the original
 * problem this importer fixes. If the operator wants to keep something
 * custom, they edit after import.
 */
export function AiweonImportButton() {
  const router = useRouter();
  const [phase, setPhase] = useState<
    "idle" | "previewing" | "preview_ready" | "committing" | "done" | "error"
  >("idle");
  const [products, setProducts] = useState<ImportResponse["products"]>([]);
  const [error, setError] = useState<string | null>(null);

  const runPreview = async () => {
    setPhase("previewing");
    setError(null);
    try {
      const res = await fetch("/api/business-knowledge/import-aiweon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true }),
      });
      const data = (await res.json()) as ImportResponse;
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        setPhase("error");
        return;
      }
      setProducts(data.products ?? []);
      setPhase("preview_ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
      setPhase("error");
    }
  };

  const runCommit = async () => {
    setPhase("committing");
    setError(null);
    try {
      const res = await fetch("/api/business-knowledge/import-aiweon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: false }),
      });
      const data = (await res.json()) as ImportResponse;
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        setPhase("error");
        return;
      }
      setPhase("done");
      setTimeout(() => router.refresh(), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
      setPhase("error");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {phase === "idle" || phase === "previewing" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={runPreview}
          disabled={phase === "previewing"}
          className="self-start gap-1.5"
        >
          {phase === "previewing" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Download size={13} />
          )}
          ייבא שירותים מ-AIWEON
        </Button>
      ) : null}

      {phase === "preview_ready" && products && products.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-sky-300/60 bg-sky-50/40 p-3 dark:border-sky-500/30 dark:bg-sky-950/20">
          <span className="text-[11.5px] font-semibold text-sky-900 dark:text-sky-200">
            {products.length} שירותים יזוהו ב-AIWEON. אישור יחליף את הרשימה
            הנוכחית (לא ימזג). תוכל לערוך ידנית אחרי הייבוא.
          </span>
          <ul className="flex flex-col gap-1.5">
            {products.map((p) => (
              <li
                key={p.name}
                className="rounded border border-border/60 bg-background/60 px-3 py-1.5 text-[12px]"
              >
                <div className="font-semibold">{p.name}</div>
                {p.description ? (
                  <div className="text-[11px] text-muted-foreground">
                    {p.description}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={runCommit}
              className="gap-1.5"
            >
              <Check size={13} />
              אשר ייבוא
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setProducts([]);
                setPhase("idle");
              }}
            >
              בטל
            </Button>
          </div>
        </div>
      ) : null}

      {phase === "committing" ? (
        <div className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> מייבא...
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="inline-flex items-center gap-2 rounded-md border border-emerald-300/60 bg-emerald-50/40 px-3 py-1.5 text-[12px] text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/20 dark:text-emerald-200">
          <Check size={13} /> השירותים יובאו. רענן את העמוד.
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="inline-flex items-start gap-2 rounded-md border border-red-300/60 bg-red-50/40 px-3 py-1.5 text-[12px] text-red-900 dark:border-red-500/30 dark:bg-red-950/20 dark:text-red-200">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span>שגיאה: {error}</span>
        </div>
      ) : null}
    </div>
  );
}
