"use client";

/**
 * GeoTargetingEditor — per-business geographic targeting editor.
 *
 * Migration 025 (Phase 1 add-on, Campaigner Mastery Plan §4). Roi 2026-05-13:
 * Aiweon needs both an inclusion pool AND explicit exclusions ("כן ת"א + רדיוס
 * 25km מהמשרד; לא בני ברק"). City-only without radius is intentional — Meta
 * defaults a city target to ~17km around its center, which matches the
 * operator's mental model of "טרגט את ת"א".
 *
 * State is local. On every change, the component writes JSON.stringify(value)
 * to a hidden input named `geo_targeting`, which the parent form's Server
 * Action picks up and Zod-parses via `geoTargetingSchema`.
 *
 * Two panels: include + exclude. Each panel supports cities (free-text name +
 * Meta key) and radius centers (name + lat/lng + km). The operator types Meta
 * city keys manually for now; v2 will add a live targeting_search lookup.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import type {
  GeoBlock,
  GeoNamedKey,
  GeoRadiusCenter,
  GeoTargeting,
} from "@/lib/schemas/business-knowledge";
import { cn } from "@/lib/utils";

interface GeoTargetingEditorProps {
  initialValue: GeoTargeting | null;
  fieldName?: string; // hidden input name (default 'geo_targeting')
}

type Panel = "include" | "exclude";
const PANELS: { key: Panel; label: string; description: string }[] = [
  {
    key: "include",
    label: "כלול",
    description: "ערים, אזורים ורדיוסים שאתה כן רוצה לטרגט.",
  },
  {
    key: "exclude",
    label: "החרג",
    description:
      "מיקומים שלא תרצה לטרגט גם אם הם בתוך אזורי הכלילה (למשל בני ברק בתוך גוש דן).",
  },
];

const DEFAULT_VALUE: GeoTargeting = {
  include: { countries: ["IL"] },
  exclude: {},
};

function ensurePanel(value: GeoTargeting, panel: Panel): GeoBlock {
  return value[panel] ?? {};
}

function setPanel(
  value: GeoTargeting,
  panel: Panel,
  next: GeoBlock,
): GeoTargeting {
  // Normalize empty arrays out of the block; if the block ends up empty, drop it.
  const cleaned: GeoBlock = {};
  if (next.countries?.length) cleaned.countries = next.countries;
  if (next.regions?.length) cleaned.regions = next.regions;
  if (next.cities?.length) cleaned.cities = next.cities;
  if (next.radius_centers?.length) cleaned.radius_centers = next.radius_centers;
  if (next.zips?.length) cleaned.zips = next.zips;
  return {
    ...value,
    [panel]: Object.keys(cleaned).length > 0 ? cleaned : undefined,
  };
}

function isEmpty(v: GeoTargeting): boolean {
  return !v.include && !v.exclude;
}

export function GeoTargetingEditor({
  initialValue,
  fieldName = "geo_targeting",
}: GeoTargetingEditorProps) {
  const [value, setValue] = useState<GeoTargeting>(
    initialValue ?? DEFAULT_VALUE,
  );

  const serialized = useMemo(() => {
    if (isEmpty(value)) return "";
    return JSON.stringify(value);
  }, [value]);

  // Mirror serialized state into the hidden input on every change so the
  // form submission picks up the latest value.
  const [hidden, setHidden] = useState(serialized);
  useEffect(() => {
    setHidden(serialized);
  }, [serialized]);

  return (
    <div className="space-y-4">
      <input type="hidden" name={fieldName} value={hidden} readOnly />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {PANELS.map((p) => (
          <PanelCard
            key={p.key}
            panel={p.key}
            label={p.label}
            description={p.description}
            value={ensurePanel(value, p.key)}
            onChange={(next) => setValue(setPanel(value, p.key, next))}
          />
        ))}
      </div>
    </div>
  );
}

function CountriesField({
  value,
  onChange,
  hint,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  hint?: string;
}) {
  const [input, setInput] = useState("");

  function addCode() {
    const code = input.trim().toUpperCase();
    if (code.length !== 2) return;
    if (value.includes(code)) {
      setInput("");
      return;
    }
    onChange([...value, code]);
    setInput("");
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium">מדינות</span>
        <span className="text-[10px] text-muted-foreground">
          {hint ?? "קוד ISO 2 אותיות (IL / US / GB ...)"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {value.map((code) => (
          <Chip
            key={code}
            label={code}
            onRemove={() => onChange(value.filter((c) => c !== code))}
          />
        ))}
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCode();
              }
            }}
            placeholder="IL"
            maxLength={2}
            className="h-7 w-16 rounded-md border border-border bg-background px-2 text-xs uppercase outline-none focus:border-brand-500/50"
          />
          <button
            type="button"
            onClick={addCode}
            disabled={input.trim().length !== 2}
            className="h-7 rounded-md border border-border px-2 text-xs disabled:opacity-50"
          >
            הוסף
          </button>
        </div>
      </div>
    </div>
  );
}

function PanelCard({
  panel,
  label,
  description,
  value,
  onChange,
}: {
  panel: Panel;
  label: string;
  description: string;
  value: GeoBlock;
  onChange: (next: GeoBlock) => void;
}) {
  const accentClass =
    panel === "include"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : "border-rose-500/30 bg-rose-500/5";

  return (
    <div className={cn("rounded-xl border p-4", accentClass)}>
      <div className="mb-3">
        <h4 className="text-sm font-semibold">{label}</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>

      <div className="space-y-4">
        <CountriesField
          value={value.countries ?? []}
          onChange={(next) => onChange({ ...value, countries: next })}
          hint={
            panel === "include"
              ? "ברירת מחדל: IL. הוסף עוד מדינות אם אתה משווק גם מחוץ לישראל."
              : "הוסף קוד מדינה להחרגה (לדוגמה PS לשטחים הפלסטיניים)."
          }
        />
        <CitiesEditor
          value={value.cities ?? []}
          onChange={(next) => onChange({ ...value, cities: next })}
        />
        <RadiusCentersEditor
          value={value.radius_centers ?? []}
          onChange={(next) => onChange({ ...value, radius_centers: next })}
        />
      </div>
    </div>
  );
}

function CitiesEditor({
  value,
  onChange,
}: {
  value: GeoNamedKey[];
  onChange: (next: GeoNamedKey[]) => void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");

  function addCity() {
    const n = name.trim();
    const k = key.trim();
    if (!n || !k) return;
    if (value.some((c) => c.key === k)) return;
    onChange([...value, { name: n, key: k }]);
    setName("");
    setKey("");
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium">ערים</span>
        <span className="text-[10px] text-muted-foreground">
          Meta city key נדרש (Ads Manager → Audience → Locations)
        </span>
      </div>

      {value.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {value.map((c) => (
            <li
              key={c.key}
              className="flex items-center justify-between rounded-md border border-border bg-background/60 px-2 py-1 text-xs"
            >
              <span className="truncate">
                {c.name}
                <span className="ms-2 text-muted-foreground">({c.key})</span>
              </span>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.key !== c.key))}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`הסר ${c.name}`}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="שם עיר (תל אביב)"
          className="h-7 flex-1 min-w-[7rem] rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand-500/50"
        />
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="key (2643743)"
          className="h-7 w-24 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand-500/50"
        />
        <button
          type="button"
          onClick={addCity}
          disabled={!name.trim() || !key.trim()}
          className="h-7 rounded-md border border-border px-2 text-xs disabled:opacity-50"
          aria-label="הוסף עיר"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}

function RadiusCentersEditor({
  value,
  onChange,
}: {
  value: GeoRadiusCenter[];
  onChange: (next: GeoRadiusCenter[]) => void;
}) {
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [km, setKm] = useState("25");

  function addCenter() {
    const n = name.trim();
    const latNum = Number.parseFloat(lat);
    const lngNum = Number.parseFloat(lng);
    const kmNum = Number.parseInt(km, 10);
    if (!n) return;
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) return;
    if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) return;
    if (!Number.isInteger(kmNum) || kmNum < 1 || kmNum > 80) return;
    onChange([
      ...value,
      { name: n, latitude: latNum, longitude: lngNum, radius_km: kmNum },
    ]);
    setName("");
    setLat("");
    setLng("");
    setKm("25");
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium">רדיוס מנקודה</span>
        <span className="text-[10px] text-muted-foreground">
          רוחב/אורך מ-Google Maps; רדיוס 1–80 ק"מ
        </span>
      </div>

      {value.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {value.map((c, i) => (
            <li
              key={`${c.name}-${i}`}
              className="flex items-center justify-between rounded-md border border-border bg-background/60 px-2 py-1 text-xs"
            >
              <span className="truncate">
                {c.name}
                <span className="ms-2 text-muted-foreground">
                  ({c.latitude.toFixed(4)}, {c.longitude.toFixed(4)} · {c.radius_km}
                  ק"מ)
                </span>
              </span>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`הסר ${c.name}`}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="שם (משרד ת״א)"
          className="col-span-2 h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand-500/50 sm:col-span-1"
        />
        <input
          type="text"
          inputMode="decimal"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          placeholder="lat (32.0853)"
          className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand-500/50"
        />
        <input
          type="text"
          inputMode="decimal"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          placeholder="lng (34.7818)"
          className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand-500/50"
        />
        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            value={km}
            onChange={(e) => setKm(e.target.value)}
            placeholder="km"
            className="h-7 w-14 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-brand-500/50"
          />
          <button
            type="button"
            onClick={addCenter}
            className="h-7 rounded-md border border-border px-2 text-xs"
            aria-label="הוסף רדיוס"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive"
        aria-label={`הסר ${label}`}
      >
        <X size={10} />
      </button>
    </span>
  );
}
