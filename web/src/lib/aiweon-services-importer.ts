/**
 * AIWEON services importer.
 *
 * Reads the canonical service list from the AIWEON marketing-site repo
 * (`d:\aiweon-ser\aiweon-ser\messages\he.json`) and converts it to the
 * `business_knowledge.products` shape — `Product[]` (name + description).
 *
 * Why this exists: operator feedback 2026-05-13 — the agent was matching
 * on a thin product list (often empty or single-item) and anchoring every
 * proposal to the dominant sub-vertical even when the running campaign was
 * about a different service. The fix has two parts:
 *
 *   1. Auto-populate `products[]` with ALL 4 AIWEON services (this file).
 *   2. Per-campaign matching via campaign name → which service (E4-E6).
 *
 * The source path is hardcoded to the local repo for the Aiweon-only MVP.
 * In production this'll need to either fetch from aiweon.co.il or live in
 * a shared seed file. For now the operator runs the importer once after
 * editing the marketing site copy.
 */

import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

import type { Product } from "@/lib/db/types";

const DEFAULT_AIWEON_JSON_PATH =
  process.env.AIWEON_SERVICES_JSON_PATH ??
  "d:\\aiweon-ser\\aiweon-ser\\messages\\he.json";

interface AiweonServicePage {
  name: string;
  title: string;
  description: string;
  subhead: string;
  trustBadges: string[];
  deliverables: Array<{ title: string; description: string }>;
  howItWorks: Array<{ title: string; description: string }>;
  faqs: Array<{ q: string; a: string }>;
}

interface AiweonMessages {
  ServicesPages: {
    agents: AiweonServicePage;
    videos: AiweonServicePage;
    campaigns: AiweonServicePage;
    influencers: AiweonServicePage;
  };
  Slides?: Record<string, { kicker: string; title: string; body: string }>;
}

export interface AiweonImportResult {
  products: Product[];
  /** Where the data came from — useful for the preview UI + audit trail. */
  source_path: string;
  /** Compact one-line preview for telemetry / decisions. */
  summary: string;
}

/**
 * Read the messages/he.json from the AIWEON site repo and produce a
 * Product[] suitable for upserting into business_knowledge.products.
 *
 * Throws if the file is missing, malformed, or lacks ServicesPages — the
 * caller routes those into a 4xx with a clear message.
 */
export async function importAiweonServices(opts?: {
  /** Override the JSON path. Useful for tests + future env flexibility. */
  jsonPath?: string;
}): Promise<AiweonImportResult> {
  const jsonPath = opts?.jsonPath ?? DEFAULT_AIWEON_JSON_PATH;
  let raw: string;
  try {
    raw = await fs.readFile(path.resolve(jsonPath), "utf-8");
  } catch (e) {
    throw new Error(
      `aiweon services file not readable at ${jsonPath} — ${
        e instanceof Error ? e.message : "unknown"
      }`,
    );
  }
  let parsed: AiweonMessages;
  try {
    parsed = JSON.parse(raw) as AiweonMessages;
  } catch (e) {
    throw new Error(
      `aiweon services file is not valid JSON at ${jsonPath} — ${
        e instanceof Error ? e.message : "unknown"
      }`,
    );
  }
  if (!parsed.ServicesPages) {
    throw new Error(
      `aiweon services file at ${jsonPath} is missing ServicesPages key`,
    );
  }

  const products: Product[] = [];
  const KEYS = ["agents", "videos", "campaigns", "influencers"] as const;
  for (const key of KEYS) {
    const page = parsed.ServicesPages[key];
    if (!page?.name) continue;
    // Description: short subhead is best for matcher hits — it carries the
    // specific terms (CRM, voice cloning, etc.) without bloat. Strip the
    // long-form `description` because match_terms scan is haystack-length-
    // bounded and we want signal-dense text.
    const description = page.subhead || page.description || page.title || "";
    products.push({
      name: page.name,
      description: description,
    });
  }

  if (products.length === 0) {
    throw new Error(
      `aiweon services file at ${jsonPath} had ServicesPages but no usable entries`,
    );
  }

  return {
    products,
    source_path: jsonPath,
    summary: `${products.length} services: ${products
      .map((p) => p.name)
      .join(", ")}`,
  };
}
