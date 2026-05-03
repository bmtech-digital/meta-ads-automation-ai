import Link from "next/link";
import type { ReactNode } from "react";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "דשבורד" },
  { href: "/campaigns", label: "קמפיינים" },
  { href: "/approvals", label: "הצעות ממתינות" },
  { href: "/history", label: "היסטוריה" },
  { href: "/business-knowledge", label: "ידע עסקי" },
  { href: "/settings", label: "הגדרות" },
];

export function Nav({ active, right }: { active?: string; right?: ReactNode }) {
  return (
    <nav className="flex flex-wrap items-center gap-2 border-b pb-3">
      <div className="flex flex-wrap gap-2">
        {LINKS.map((l) => {
          const isActive = active === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={
                "rounded-md px-3 py-1.5 text-sm transition-colors " +
                (isActive
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground")
              }
            >
              {l.label}
            </Link>
          );
        })}
      </div>
      {right ? <div className="ms-auto">{right}</div> : null}
    </nav>
  );
}
