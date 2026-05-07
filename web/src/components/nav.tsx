"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import {
  SignalIcon,
  InboxIcon,
  TargetIcon,
  HistoryIcon,
  KnowledgeIcon,
} from "@/components/brand/icons";
import {
  Menu,
  Settings as SettingsIcon,
  Images as ImagesIcon,
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
  { href: "/history", label: "היסטוריה", Icon: HistoryIcon },
  { href: "/business-knowledge", label: "ידע עסקי", Icon: KnowledgeIcon },
  { href: "/gallery", label: "גלריה", Icon: ImagesIcon as IconCmp },
  { href: "/settings", label: "הגדרות", Icon: SettingsIcon as IconCmp },
];

export function Nav({ active, right }: { active?: string; right?: ReactNode }) {
  return (
    <header className="glass-header sticky top-0 z-40">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center rounded-md outline-none transition-transform hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="Aiweon Campaigner — בית"
        >
          <AiweonLogo size={34} subtitle="Campaigner" />
        </Link>

        {/* Desktop nav (lg+): all links inline */}
        <nav
          className="hidden flex-1 items-center justify-center gap-1 lg:flex"
          aria-label="ניווט ראשי"
        >
          {LINKS.map((link) => (
            <NavPill key={link.href} link={link} active={active} />
          ))}
        </nav>

        {/* Tablet/Mobile: spacer */}
        <div className="flex-1 lg:hidden" />

        <div className="flex shrink-0 items-center gap-1.5">
          <ThemeToggle />
          {right ? (
            <div className="flex items-center gap-2">{right}</div>
          ) : null}
          {/* Hamburger appears below lg */}
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
        "nav-link-underline inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[13.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        isActive
          ? "bg-brand-500/10 text-foreground dark:bg-brand-400/10"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <Icon
        size={16}
        className={cn(
          "transition-colors",
          isActive ? "text-brand-500 dark:text-brand-400" : "opacity-80",
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
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
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
                    ? "bg-brand-500/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon
                  size={18}
                  className={
                    isActive
                      ? "text-brand-500 dark:text-brand-400"
                      : "opacity-80"
                  }
                />
                <span>{label}</span>
                {isActive ? (
                  <span
                    aria-hidden
                    className="ms-auto inline-block h-2 w-2 rounded-full bg-brand-500 dark:bg-brand-400"
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
