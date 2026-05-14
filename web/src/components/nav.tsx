"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import {
  SignalIcon,
  InboxIcon,
  TargetIcon,
  KnowledgeIcon,
} from "@/components/brand/icons";
import {
  Menu,
  Settings as SettingsIcon,
  Images as ImagesIcon,
  Plug as PlugIcon,
  FileText as ReportIcon,
  FlaskConical as AbTestIcon,
  Users as AudienceIcon,
  ClipboardCheck as LeadsIcon,
} from "lucide-react";
import { AiweonLogo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type IconCmp = (props: {
  size?: number | string;
  className?: string;
}) => ReactNode;

type NavLink = {
  href: string;
  label: string;
  Icon: IconCmp;
};

const LINKS: NavLink[] = [
  { href: "/", label: "דשבורד", Icon: SignalIcon },
  { href: "/approvals", label: "הצעות", Icon: InboxIcon },
  { href: "/campaigns", label: "קמפיינים", Icon: TargetIcon },
  { href: "/business-knowledge", label: "העסק שלי", Icon: KnowledgeIcon },
  { href: "/gallery", label: "גלריה", Icon: ImagesIcon as IconCmp },
  { href: "/reports", label: "דוחות", Icon: ReportIcon as IconCmp },
  { href: "/plans", label: "תוכניות", Icon: ReportIcon as IconCmp },
  { href: "/ab-tests", label: "מבחני A/B", Icon: AbTestIcon as IconCmp },
  { href: "/audiences", label: "קהלים", Icon: AudienceIcon as IconCmp },
  { href: "/leads", label: "לידים", Icon: LeadsIcon as IconCmp },
  { href: "/integrations", label: "אינטגרציות", Icon: PlugIcon as IconCmp },
  { href: "/settings", label: "הגדרות", Icon: SettingsIcon as IconCmp },
];

/**
 * Three-pill floating header — ported from aiweon-ser (D:\aiweon-ser\src\
 * components\site-header.tsx). Logo pill (right in RTL), nav pill (center),
 * action pill (left). All three sit on `glass-surface rounded-full` so the
 * page atmosphere shows through behind them.
 */
export function Nav({ active, right }: { active?: string; right?: ReactNode }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 pt-2 sm:pt-4">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-1.5 px-2 sm:gap-3 sm:px-4">
        {/* Logo pill — tighter on mobile, full lockup with subtitle on sm+ */}
        <Link
          href="/"
          aria-label="Aiweon Campaigner — בית"
          className="glass-surface group inline-flex shrink-0 items-center rounded-full py-1.5 pe-2.5 ps-2.5 transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:py-2 sm:pe-4 sm:ps-3"
        >
          {/* Mobile: compact mark only */}
          <AiweonLogo size={20} className="sm:hidden" />
          {/* sm+: full wordmark + Campaigner subtitle */}
          <AiweonLogo
            size={26}
            subtitle="Campaigner"
            className="hidden sm:inline-flex"
          />
        </Link>

        {/* Nav pill — desktop only */}
        <nav
          aria-label="ניווט ראשי"
          className="glass-surface hidden items-center gap-0.5 rounded-full px-1 py-1 lg:flex"
        >
          {LINKS.map((link) => (
            <NavPill key={link.href} link={link} active={active} />
          ))}
        </nav>

        {/* Right pill — theme + user menu + mobile hamburger */}
        <div className="glass-surface flex shrink-0 items-center gap-0.5 rounded-full px-1 py-1">
          <ThemeToggle className="h-9 w-9 hover:bg-foreground/5" />
          {right ? (
            <div className="flex items-center gap-0.5">{right}</div>
          ) : null}
          <MobileNav active={active} />
        </div>
      </div>
    </header>
  );
}

function NavPill({ link, active }: { link: NavLink; active?: string }) {
  const { href, label, Icon } = link;
  const isActive = active === href;
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        isActive
          ? "bg-brand-500/15 text-foreground"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      <Icon
        size={14}
        className={cn(
          "transition-colors",
          isActive ? "text-brand-500" : "opacity-80",
        )}
      />
      <span>{label}</span>
    </Link>
  );
}

function MobileNav({ active }: { active?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="תפריט"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        >
          <Menu size={18} />
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="flex flex-col p-0">
        <SheetHeader className="p-5">
          <SheetTitle className="flex items-center gap-2">
            <AiweonLogo size={24} />
          </SheetTitle>
        </SheetHeader>
        <nav
          className="flex flex-1 flex-col gap-1 p-3 overflow-y-auto"
          aria-label="ניווט ראשי"
        >
          {LINKS.map(({ href, label, Icon }) => {
            const isActive = active === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-brand-500/15 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon
                  size={18}
                  className={
                    isActive
                      ? "text-brand-500"
                      : "opacity-80"
                  }
                />
                <span>{label}</span>
                {isActive ? (
                  <span
                    aria-hidden
                    className="ms-auto inline-block h-2 w-2 rounded-full bg-brand-500"
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
