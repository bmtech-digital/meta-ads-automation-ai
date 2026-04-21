import Link from "next/link";

const LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "דשבורד" },
  { href: "/campaigns", label: "קמפיינים" },
  { href: "/approvals", label: "הצעות ממתינות" },
  { href: "/history", label: "היסטוריה" },
  { href: "/business-knowledge", label: "ידע עסקי" },
  { href: "/settings", label: "הגדרות" },
];

export function Nav({ active }: { active?: string }) {
  return (
    <nav className="flex flex-wrap gap-2 border-b pb-3">
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
    </nav>
  );
}
