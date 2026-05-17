import type {
  AudienceCustomRef,
  AudienceGeoEnvelope,
  AudienceRow,
  AudienceTargetingEntry,
} from "@/lib/db/types";

// Operator-readable Hebrew labels for the placement enums Meta returns.
// Source: targeting.publisher_platforms / facebook_positions / etc.
const PLATFORM_LABEL_HE: Record<string, string> = {
  facebook: "פייסבוק",
  instagram: "אינסטגרם",
  messenger: "מסנג'ר",
  audience_network: "Audience Network",
  whatsapp: "ווטסאפ",
};

const POSITION_LABEL_HE: Record<string, string> = {
  feed: "פיד",
  story: "סטוריז",
  stories: "סטוריז",
  reels: "ריילז",
  explore: "אקספלור",
  marketplace: "מרקטפלייס",
  search: "חיפוש",
  right_hand_column: "טור ימני",
  video_feeds: "פיד וידאו",
  instream_video: "וידאו מובנה",
  facebook_reels: "ריילז פייסבוק",
  instagram_reels: "ריילז אינסטגרם",
  instagram_explore: "אקספלור",
  instagram_explore_grid_home: "אקספלור (גריד)",
  instagram_profile_feed: "פיד פרופיל",
  ig_search: "חיפוש אינסטגרם",
  messenger_home: "מסנג'ר הום",
  messenger_inbox: "תיבת הודעות",
  messenger_stories: "מסנג'ר סטוריז",
  classic: "Audience Network קלאסי",
  rewarded_video: "וידאו מתוגמל",
  biz_disco_feed: "Business Discovery",
};

const DEVICE_LABEL_HE: Record<string, string> = {
  mobile: "מובייל",
  desktop: "דסקטופ",
};

function formatGeoEnvelope(env: AudienceGeoEnvelope | null): {
  cities: string[];
  customLocations: string[];
  regions: string[];
  countries: string[];
  zips: string[];
  geoMarkets: string[];
  locationTypes: string[];
} {
  if (!env) {
    return {
      cities: [],
      customLocations: [],
      regions: [],
      countries: [],
      zips: [],
      geoMarkets: [],
      locationTypes: [],
    };
  }
  const cities = (env.cities ?? []).map((c) => {
    const name = c.name ?? c.key ?? "—";
    if (c.radius) {
      const unit =
        c.distance_unit === "kilometer"
          ? "ק״מ"
          : c.distance_unit === "mile"
            ? "מייל"
            : "";
      return `${name} + ${c.radius} ${unit}`.trim();
    }
    return name;
  });
  const customLocations = (env.custom_locations ?? []).map((c) => {
    const name =
      c.name ?? c.address_string ?? (c.latitude && c.longitude ? "פין על המפה" : "מיקום");
    if (c.radius) {
      const unit =
        c.distance_unit === "kilometer"
          ? "ק״מ"
          : c.distance_unit === "mile"
            ? "מייל"
            : "";
      return `${name} + ${c.radius} ${unit}`.trim();
    }
    return name;
  });
  const regions = (env.regions ?? []).map((r) => r.name ?? r.key ?? "").filter(Boolean);
  const countries = (env.countries ?? []).map((c) => {
    if (typeof c === "string") return c === "IL" ? "ישראל" : c;
    return c.name ?? c.key ?? "";
  }).filter(Boolean);
  const zips = (env.zips ?? []).map((z) => z.name ?? z.key ?? "").filter(Boolean);
  const geoMarkets = (env.geo_markets ?? [])
    .map((g) => g.name ?? g.key ?? "")
    .filter(Boolean);
  const locationTypes = (env.location_types ?? []).map(
    (t) =>
      ({
        home: "מתגוררים",
        recent: "ביקרו לאחרונה",
        travel_in: "מטיילים באזור",
        recent_and_home: "מתגוררים + ביקרו לאחרונה",
      } as Record<string, string>)[t] ?? t,
  );
  return { cities, customLocations, regions, countries, zips, geoMarkets, locationTypes };
}

function ChipList({
  items,
  emptyHint,
  tone = "neutral",
  max = 8,
}: {
  items: string[];
  emptyHint?: string;
  tone?: "neutral" | "warn" | "info";
  max?: number;
}) {
  if (items.length === 0) {
    return emptyHint ? (
      <span className="text-[11px] text-muted-foreground/60">{emptyHint}</span>
    ) : null;
  }
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const toneCls =
    tone === "warn"
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
      : tone === "info"
        ? "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30"
        : "bg-muted/60 text-muted-foreground border-border";
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((t, i) => (
        <span
          key={`${t}-${i}`}
          className={`rounded-full border px-2 py-0.5 text-[11px] ${toneCls}`}
        >
          {t}
        </span>
      ))}
      {rest > 0 ? (
        <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground/70">
          +{rest}
        </span>
      ) : null}
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:grid sm:grid-cols-[120px_1fr] sm:items-start sm:gap-3">
      <span className="text-[11px] font-medium text-muted-foreground sm:pt-0.5">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function entryName(e: AudienceTargetingEntry): string {
  return e.name ?? (e.id != null ? String(e.id) : "—");
}

function refName(r: AudienceCustomRef): string {
  return r.name ?? r.id ?? "—";
}

/**
 * Expandable per-audience targeting block. Rendered inside the existing
 * audience card on /audiences. Server-component-safe: uses a plain
 * `<details>` so toggling needs no JS.
 *
 * Renders nothing if the audience has no parsed targeting (custom +
 * lookalike rows fall through here — their selection logic is already
 * shown elsewhere on the card via `rule` / `lookalike_spec`).
 */
export function AudienceTargetingDetail({ row }: { row: AudienceRow }) {
  // Render the block when EITHER our parsed targeting has anything OR
  // Meta gave us sentence_lines. Custom + lookalike rows typically have
  // neither, so they get nothing — keeps the card lean.
  const hasParsed =
    row.targeting_parsed === true &&
    (row.age_min != null ||
      row.age_max != null ||
      (row.genders && row.genders.length > 0) ||
      row.geo_locations ||
      row.excluded_geo_locations ||
      (row.interests && row.interests.length > 0) ||
      (row.behaviors && row.behaviors.length > 0) ||
      (row.life_events && row.life_events.length > 0) ||
      (row.industries && row.industries.length > 0) ||
      (row.work_employers && row.work_employers.length > 0) ||
      (row.work_positions && row.work_positions.length > 0) ||
      (row.education_schools && row.education_schools.length > 0) ||
      (row.education_majors && row.education_majors.length > 0) ||
      (row.family_statuses && row.family_statuses.length > 0) ||
      (row.relationship_statuses && row.relationship_statuses.length > 0) ||
      (row.custom_audiences_included &&
        row.custom_audiences_included.length > 0) ||
      (row.custom_audiences_excluded &&
        row.custom_audiences_excluded.length > 0) ||
      (row.flexible_spec && row.flexible_spec.length > 0) ||
      row.exclusions);

  const hasSentenceLines =
    Array.isArray(row.sentence_lines) && row.sentence_lines.length > 0;

  if (!hasParsed && !hasSentenceLines) return null;

  const geo = formatGeoEnvelope(row.geo_locations);
  const excludedGeo = formatGeoEnvelope(row.excluded_geo_locations);

  const ageLabel =
    row.age_min != null && row.age_max != null
      ? `${row.age_min}–${row.age_max}`
      : row.age_min != null
        ? `${row.age_min}+`
        : row.age_max != null
          ? `עד ${row.age_max}`
          : null;

  const genderLabel =
    !row.genders || row.genders.length === 0
      ? "כל המגדרים"
      : row.genders.length === 2
        ? "כל המגדרים"
        : row.genders[0] === "male"
          ? "גברים"
          : row.genders[0] === "female"
            ? "נשים"
            : null;

  // Placements only show if the operator actually pinned them. Otherwise
  // Meta is set to "Advantage+ Placements" and showing every option would
  // be noise.
  const platforms = (row.publisher_platforms ?? []).map(
    (p) => PLATFORM_LABEL_HE[p] ?? p,
  );
  const fbPositions = (row.facebook_positions ?? []).map(
    (p) => POSITION_LABEL_HE[p] ?? p,
  );
  const igPositions = (row.instagram_positions ?? []).map(
    (p) => POSITION_LABEL_HE[p] ?? p,
  );
  const audienceNetworkPositions = (
    row.audience_network_positions ?? []
  ).map((p) => POSITION_LABEL_HE[p] ?? p);
  const messengerPositions = (row.messenger_positions ?? []).map(
    (p) => POSITION_LABEL_HE[p] ?? p,
  );
  const devices = (row.device_platforms ?? []).map(
    (d) => DEVICE_LABEL_HE[d] ?? d,
  );

  return (
    <details className="mt-3 rounded-lg border border-border/60 bg-background/40 group">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground">
        <span className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-500/50 transition-colors group-open:bg-brand-500" />
          פירוט קהל מלא
          {row.targeting_summary ? (
            <span className="hidden text-foreground/80 sm:inline">
              · {row.targeting_summary}
            </span>
          ) : null}
        </span>
        <span className="text-[11px] opacity-60 transition-transform group-open:rotate-90">
          ▸
        </span>
      </summary>

      <div className="space-y-3 px-3 pb-3 pt-1 text-[12px]">
        {/* --- Demographics ----------------------------------------------- */}
        {(ageLabel || genderLabel || Boolean(row.locales)) && (
          <DetailRow label="דמוגרפיה">
            <div className="flex flex-wrap gap-1.5">
              {ageLabel ? (
                <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px]">
                  גילאים {ageLabel}
                </span>
              ) : null}
              {genderLabel ? (
                <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px]">
                  {genderLabel}
                </span>
              ) : null}
            </div>
          </DetailRow>
        )}

        {/* --- Geo (inclusions) ------------------------------------------- */}
        {geo.cities.length +
          geo.customLocations.length +
          geo.regions.length +
          geo.countries.length +
          geo.zips.length +
          geo.geoMarkets.length >
          0 && (
          <DetailRow label="מיקומים">
            <div className="space-y-1.5">
              {geo.cities.length > 0 ? (
                <ChipList items={geo.cities} tone="info" />
              ) : null}
              {geo.customLocations.length > 0 ? (
                <ChipList items={geo.customLocations} tone="info" />
              ) : null}
              {geo.regions.length > 0 ? <ChipList items={geo.regions} /> : null}
              {geo.countries.length > 0 ? (
                <ChipList items={geo.countries} />
              ) : null}
              {geo.zips.length > 0 ? <ChipList items={geo.zips} /> : null}
              {geo.geoMarkets.length > 0 ? (
                <ChipList items={geo.geoMarkets} />
              ) : null}
              {geo.locationTypes.length > 0 ? (
                <div className="text-[11px] text-muted-foreground">
                  סוגי מיקום: {geo.locationTypes.join(", ")}
                </div>
              ) : null}
            </div>
          </DetailRow>
        )}

        {/* --- Geo exclusions --------------------------------------------- */}
        {excludedGeo.cities.length +
          excludedGeo.customLocations.length +
          excludedGeo.regions.length +
          excludedGeo.countries.length >
          0 && (
          <DetailRow label="לא כולל מיקומים">
            <div className="space-y-1.5">
              {excludedGeo.cities.length > 0 ? (
                <ChipList items={excludedGeo.cities} tone="warn" />
              ) : null}
              {excludedGeo.customLocations.length > 0 ? (
                <ChipList items={excludedGeo.customLocations} tone="warn" />
              ) : null}
              {excludedGeo.regions.length > 0 ? (
                <ChipList items={excludedGeo.regions} tone="warn" />
              ) : null}
              {excludedGeo.countries.length > 0 ? (
                <ChipList items={excludedGeo.countries} tone="warn" />
              ) : null}
            </div>
          </DetailRow>
        )}

        {/* --- Interests --------------------------------------------------- */}
        {row.interests && row.interests.length > 0 ? (
          <DetailRow label={`תחומי עניין (${row.interests.length})`}>
            <ChipList items={row.interests.map(entryName)} />
          </DetailRow>
        ) : null}

        {/* --- Behaviors --------------------------------------------------- */}
        {row.behaviors && row.behaviors.length > 0 ? (
          <DetailRow label={`התנהגויות (${row.behaviors.length})`}>
            <ChipList items={row.behaviors.map(entryName)} />
          </DetailRow>
        ) : null}

        {/* --- Life events ------------------------------------------------- */}
        {row.life_events && row.life_events.length > 0 ? (
          <DetailRow label="אירועי חיים">
            <ChipList items={row.life_events.map(entryName)} />
          </DetailRow>
        ) : null}

        {/* --- Industries (סוגי עסקים) ------------------------------------ */}
        {row.industries && row.industries.length > 0 ? (
          <DetailRow label="תחומי עיסוק">
            <ChipList items={row.industries.map(entryName)} />
          </DetailRow>
        ) : null}

        {/* --- Work positions / employers ---------------------------------- */}
        {(row.work_positions && row.work_positions.length > 0) ||
        (row.work_employers && row.work_employers.length > 0) ? (
          <DetailRow label="עבודה">
            <div className="space-y-1.5">
              {row.work_positions && row.work_positions.length > 0 ? (
                <ChipList items={row.work_positions.map(entryName)} />
              ) : null}
              {row.work_employers && row.work_employers.length > 0 ? (
                <ChipList items={row.work_employers.map(entryName)} />
              ) : null}
            </div>
          </DetailRow>
        ) : null}

        {/* --- Education --------------------------------------------------- */}
        {(row.education_schools && row.education_schools.length > 0) ||
        (row.education_majors && row.education_majors.length > 0) ? (
          <DetailRow label="השכלה">
            <div className="space-y-1.5">
              {row.education_majors && row.education_majors.length > 0 ? (
                <ChipList items={row.education_majors.map(entryName)} />
              ) : null}
              {row.education_schools && row.education_schools.length > 0 ? (
                <ChipList items={row.education_schools.map(entryName)} />
              ) : null}
            </div>
          </DetailRow>
        ) : null}

        {/* --- Family / relationship --------------------------------------- */}
        {(row.family_statuses && row.family_statuses.length > 0) ||
        (row.relationship_statuses &&
          row.relationship_statuses.length > 0) ? (
          <DetailRow label="סטטוס משפחתי">
            <ChipList
              items={[
                ...(row.family_statuses ?? []).map(entryName),
                ...(row.relationship_statuses ?? []).map(entryName),
              ]}
            />
          </DetailRow>
        ) : null}

        {/* --- Custom audiences (included) -------------------------------- */}
        {row.custom_audiences_included &&
        row.custom_audiences_included.length > 0 ? (
          <DetailRow label="כולל קהלים">
            <ChipList items={row.custom_audiences_included.map(refName)} tone="info" />
          </DetailRow>
        ) : null}

        {/* --- Custom audiences (excluded) -------------------------------- */}
        {row.custom_audiences_excluded &&
        row.custom_audiences_excluded.length > 0 ? (
          <DetailRow label="לא כולל קהלים">
            <ChipList items={row.custom_audiences_excluded.map(refName)} tone="warn" />
          </DetailRow>
        ) : null}

        {/* --- Placements (only if explicitly pinned) --------------------- */}
        {platforms.length +
          fbPositions.length +
          igPositions.length +
          audienceNetworkPositions.length +
          messengerPositions.length +
          devices.length >
          0 && (
          <DetailRow label="מיקומי הצגה">
            <div className="space-y-1.5">
              {platforms.length > 0 ? <ChipList items={platforms} /> : null}
              {fbPositions.length > 0 ? (
                <div>
                  <span className="text-[10px] text-muted-foreground/60">פייסבוק: </span>
                  <ChipList items={fbPositions} />
                </div>
              ) : null}
              {igPositions.length > 0 ? (
                <div>
                  <span className="text-[10px] text-muted-foreground/60">אינסטגרם: </span>
                  <ChipList items={igPositions} />
                </div>
              ) : null}
              {audienceNetworkPositions.length > 0 ? (
                <div>
                  <span className="text-[10px] text-muted-foreground/60">Audience Network: </span>
                  <ChipList items={audienceNetworkPositions} />
                </div>
              ) : null}
              {messengerPositions.length > 0 ? (
                <div>
                  <span className="text-[10px] text-muted-foreground/60">מסנג'ר: </span>
                  <ChipList items={messengerPositions} />
                </div>
              ) : null}
              {devices.length > 0 ? (
                <div>
                  <span className="text-[10px] text-muted-foreground/60">מכשירים: </span>
                  <ChipList items={devices} />
                </div>
              ) : null}
            </div>
          </DetailRow>
        )}

        {/* --- Flexible spec (OR clauses) --------------------------------- */}
        {row.flexible_spec && row.flexible_spec.length > 0 ? (
          <DetailRow label={`קבוצות OR (${row.flexible_spec.length})`}>
            <span className="text-[11px] text-muted-foreground">
              {row.flexible_spec.length} סטים מצורפים ב-OR — מטא מאחדת אותם.
            </span>
          </DetailRow>
        ) : null}

        {/* --- Meta's pre-localized breakdown ----------------------------
            Meta returns sentence_lines as [{content: "label:", children:
            ["val1", "val2"]}]. The labels are pre-translated to the
            account language (Hebrew for IL ad accounts) and the values
            carry the full targeting story including behaviors, employers,
            job titles, and industries that don't surface in flat top-level
            `targeting` keys. Rendering this verbatim is often the most
            faithful "what does this audience actually do?" view. */}
        {hasSentenceLines ? (
          <DetailRow label="פירוט מ-Meta">
            <ul className="space-y-2 text-[12px]">
              {(row.sentence_lines ?? []).map((line, i) => {
                // Defensive: Meta historically returned plain strings here;
                // current API returns {content, children}. Handle both.
                if (typeof line === "string") {
                  return (
                    <li key={i} className="leading-relaxed text-muted-foreground">
                      {line}
                    </li>
                  );
                }
                if (!line || typeof line !== "object") return null;
                const label =
                  typeof line.content === "string" ? line.content : null;
                const values = Array.isArray(line.children)
                  ? line.children.filter(
                      (v): v is string => typeof v === "string",
                    )
                  : [];
                if (!label && values.length === 0) return null;
                return (
                  <li key={i} className="flex flex-col gap-1">
                    {label ? (
                      <span className="font-medium text-foreground/80">
                        {label}
                      </span>
                    ) : null}
                    {values.length > 0 ? (
                      <ul className="flex flex-col gap-0.5 ps-3 text-muted-foreground">
                        {values.map((v, j) => (
                          <li key={j} className="leading-relaxed">
                            {v}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </DetailRow>
        ) : null}
      </div>
    </details>
  );
}
