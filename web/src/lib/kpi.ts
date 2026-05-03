import type { PrimaryKpi, Vertical } from "./db/types";

/**
 * Spec §6.1 — agent auto-picks primary_kpi from business_knowledge.vertical.
 * Kept here as a pure function so both the UI (settings display) and the
 * business-knowledge save action can share the derivation.
 */
export function deriveKpiFromVertical(vertical: Vertical | null): PrimaryKpi | null {
  switch (vertical) {
    case "ecommerce":
      return "roas";
    case "leads":
      return "cpl";
    case "awareness":
      return "cpm";
    case "app":
      return "cpi";
    case "other":
    case null:
    default:
      return null;
  }
}

export const VERTICAL_LABELS_HE: Record<Vertical, string> = {
  ecommerce: "eCommerce",
  leads: "לידים B2C",
  awareness: "Awareness / מותג",
  app: "אפליקציה",
  other: "אחר",
};

export const VERTICALS: Vertical[] = ["ecommerce", "leads", "awareness", "app", "other"];
