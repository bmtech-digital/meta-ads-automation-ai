import "server-only";

/**
 * FX rate resolver — USD/ILS and friends, with a daily ECB rate from
 * frankfurter.app + an in-memory cache.
 *
 * Why we need it: Meta returns ad-account spend in the account's native
 * currency (`account_currency` field on insights). Aiweon's Meta ad account
 * is denominated in USD; `business_knowledge.monthly_budget_ils` and every
 * pace calculation downstream is in ILS. Without conversion the dashboard
 * displays "₪484" when the real spend is ~₪1,800 — same numeric value
 * mislabeled, which silently breaks every pace/budget reading the agent does
 * for non-ILS accounts.
 *
 * Why frankfurter.app: no API key, no rate limit for our usage (one fetch
 * per day per process), uses ECB reference rates which are the most widely
 * accepted "official" rate. Fallback to a hardcoded conservative rate if the
 * API is unreachable — better than crashing the dashboard.
 *
 * Cache: module-level Map keyed by `YYYY-MM-DD`. The rate changes ~once per
 * banking day; intra-day churn isn't worth chasing. Cache survives across
 * requests within the same Node process.
 */

/** Conservative fallback used when the FX API is unreachable. */
const USD_TO_ILS_FALLBACK = 3.7;

const rateCache = new Map<string, number>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

interface FrankfurterResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

/**
 * Resolve 1 USD → ILS for today. Cached by calendar date. Returns the
 * fallback rate (with `source: "fallback"`) on any network/parse error so
 * the caller can still render and surface "FX unavailable" if it cares.
 */
export async function getUsdToIlsRate(): Promise<{
  rate: number;
  source: "live" | "cached" | "fallback";
  date: string;
}> {
  const key = todayKey();
  const cached = rateCache.get(key);
  if (cached !== undefined) {
    return { rate: cached, source: "cached", date: key };
  }
  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?from=USD&to=ILS",
      {
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      },
    );
    if (!res.ok) throw new Error(`frankfurter HTTP ${res.status}`);
    const body = (await res.json()) as FrankfurterResponse;
    const rate = body.rates?.ILS;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`frankfurter returned invalid ILS rate: ${rate}`);
    }
    rateCache.set(key, rate);
    return { rate, source: "live", date: body.date ?? key };
  } catch (e) {
    console.warn(
      `[fx] USD/ILS fetch failed, using fallback ${USD_TO_ILS_FALLBACK}: ${
        e instanceof Error ? e.message : "unknown"
      }`,
    );
    return { rate: USD_TO_ILS_FALLBACK, source: "fallback", date: key };
  }
}

/**
 * Convert an amount to ILS. `from === "ILS"` is a no-op. Currencies other
 * than USD currently fall through to identity — extend this when a real
 * non-USD/non-ILS account shows up. Returns the conversion metadata so the
 * UI can surface "מומר מ-$X (שער 3.71)".
 */
export async function convertToIls(
  amount: number,
  from: string | null | undefined,
): Promise<{
  amount_ils: number;
  rate_used: number;
  source_currency: string;
  fx_source: "live" | "cached" | "fallback" | "none";
}> {
  const cur = (from ?? "ILS").toUpperCase();
  if (cur === "ILS") {
    return {
      amount_ils: amount,
      rate_used: 1,
      source_currency: "ILS",
      fx_source: "none",
    };
  }
  if (cur === "USD") {
    const { rate, source } = await getUsdToIlsRate();
    return {
      amount_ils: amount * rate,
      rate_used: rate,
      source_currency: "USD",
      fx_source: source,
    };
  }
  // Unknown currency — pass through unchanged. The display layer should
  // catch `source_currency !== "ILS" && rate_used === 1` and warn.
  console.warn(`[fx] unsupported currency ${cur}, passing through 1:1`);
  return {
    amount_ils: amount,
    rate_used: 1,
    source_currency: cur,
    fx_source: "none",
  };
}
