"use client";

import { useRef } from "react";

/**
 * AssetSwitcher — a single dropdown that submits on change to /api/meta/select.
 *
 * Pattern per integrations UX decision:
 *   - 1 option available → caller renders the asset as a static badge and
 *     does NOT mount this component. Auto-selection happens server-side.
 *   - >1 options available → render this component. The user picks from the
 *     dropdown and the form submits immediately — no extra "save" button.
 *
 * The current selection is the dropdown's defaultValue. Changing it fires
 * a form submit that hits /api/meta/select and redirects back to
 * /integrations?selected=<kind>.
 */
export function AssetSwitcher({
  connectionId,
  assetKind,
  options,
  selectedId,
  label,
}: {
  connectionId: string;
  assetKind: "page" | "ig" | "ad_account";
  options: Array<{ id: string; label: string; sub?: string | null }>;
  selectedId: string;
  label: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      method="POST"
      action="/api/meta/select"
      className="flex items-center gap-3"
    >
      <input type="hidden" name="connection_id" value={connectionId} />
      <input type="hidden" name="asset_kind" value={assetKind} />
      <label
        htmlFor={`asset-${assetKind}`}
        className="shrink-0 text-[13px] font-semibold text-muted-foreground"
      >
        {label}
      </label>
      <select
        id={`asset-${assetKind}`}
        name="asset_id"
        defaultValue={selectedId}
        onChange={() => formRef.current?.submit()}
        className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.sub ? `${opt.label} · ${opt.sub}` : opt.label}
          </option>
        ))}
      </select>
    </form>
  );
}
