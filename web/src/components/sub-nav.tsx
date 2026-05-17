"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type SubNavItem = {
  href: string;
  label: string;
};

/**
 * SubNav — secondary navigation between sibling routes inside a consolidated
 * Top Nav group (e.g. קמפיינים | מבחני A/B | תוכניות הרצה). Lives at the top
 * of grouped pages, above PageHeader. Shares the `glass-surface rounded-full`
 * DNA of the Top Nav so the chrome reads as one continuous layer.
 *
 * Active-state matching: exact for "/" (otherwise it matches every path);
 * exact OR prefix-with-slash for everything else (`/campaigns` matches
 * `/campaigns` and `/campaigns/new` but not `/campaigns-x`).
 */
export function SubNav({
  items,
  className,
}: {
  items: SubNavItem[];
  className?: string;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="ניווט משני"
      className={cn(
        "glass-surface mb-8 inline-flex items-center gap-0.5 rounded-full p-1",
        className,
      )}
    >
      {items.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href ||
              pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[12.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-brand-500/15 text-foreground"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Campaigns group — main `/campaigns` + A/B + planning sub-routes. */
export const CAMPAIGN_GROUP_ITEMS: SubNavItem[] = [
  { href: "/campaigns", label: "קמפיינים" },
  { href: "/ab-tests", label: "מבחני A/B" },
  { href: "/plans", label: "תוכניות הרצה" },
];

/** Audience + leads group — `/audiences` (custom + saved + lookalike) + `/leads`. */
export const AUDIENCE_GROUP_ITEMS: SubNavItem[] = [
  { href: "/audiences", label: "קהלים" },
  { href: "/leads", label: "לידים" },
];

/** Settings group — `/settings` (general) + `/integrations` (Meta + others). */
export const SETTINGS_GROUP_ITEMS: SubNavItem[] = [
  { href: "/settings", label: "כללי" },
  { href: "/integrations", label: "אינטגרציות" },
];
