"use client";

import { Check, ChevronDown, LogOut, Building2 } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface BusinessOption {
  id: string;
  name: string;
  meta_ad_account_id: string;
}

interface Props {
  email: string;
  activeBusinessId: string | null;
  businesses: BusinessOption[];
  signOutAction: () => void;
}

/**
 * Combined user-menu + business switcher.
 *
 * Trigger: shows the active business name (or "בחר עסק" if none) and the
 * operator email below it as the subtext. Clicking opens a dropdown with:
 *   - The list of businesses (each row submits a form → /api/businesses/select)
 *   - A separator
 *   - Sign-out button
 *
 * Each business row is its own form so the click triggers a server redirect
 * that sets the cookie and lands the operator back on the current path.
 * Using forms rather than `fetch` keeps the no-JS path working and avoids the
 * client needing to know the current path beyond `window.location`.
 */
export function UserMenuClient({
  email,
  activeBusinessId,
  businesses,
  signOutAction,
}: Props) {
  // Capture current path at click time so the redirect lands the user back
  // where they were. `window.location.pathname` is ref'd through a hidden
  // input populated on submit (avoids a re-render per route change).
  const formsRef = useRef<HTMLDivElement>(null);

  const active = businesses.find((b) => b.id === activeBusinessId);
  const triggerTitle = active ? active.name : "בחר עסק";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 max-w-[240px] gap-2 px-2 sm:px-2.5"
          aria-label="תפריט משתמש ובחירת עסק"
          title={`${triggerTitle} · ${email}`}
        >
          <Building2 size={14} className="opacity-80" />
          {/* Text stack — hidden on mobile to keep the floating-pill header
              from overflowing. The dropdown still shows full context on tap. */}
          <div className="hidden min-w-0 flex-col items-start text-start leading-tight sm:flex">
            <span className="truncate text-[12.5px] font-medium">
              {triggerTitle}
            </span>
            <span
              dir="ltr"
              className="truncate text-[10.5px] text-muted-foreground"
            >
              {email}
            </span>
          </div>
          <ChevronDown size={14} className="hidden opacity-60 sm:inline" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[280px]">
        <DropdownMenuLabel className="text-[11.5px] uppercase tracking-wider text-muted-foreground">
          בחר עסק / חשבון מודעות
        </DropdownMenuLabel>
        <div ref={formsRef} className="flex flex-col">
          {businesses.length === 0 ? (
            <div className="px-2 py-2 text-[12.5px] text-muted-foreground">
              אין עדיין עסקים. התחבר ל-Meta ב-/integrations.
            </div>
          ) : (
            businesses.map((b) => (
              <form
                key={b.id}
                method="POST"
                action="/api/businesses/select"
                onSubmit={(e) => {
                  const nextInput = e.currentTarget.querySelector(
                    'input[name="next"]',
                  ) as HTMLInputElement | null;
                  if (nextInput) nextInput.value = window.location.pathname;
                }}
              >
                <input type="hidden" name="business_id" value={b.id} />
                <input type="hidden" name="next" value="/" />
                <button
                  type="submit"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-[13px] outline-none transition-colors hover:bg-muted focus-visible:bg-muted",
                    b.id === activeBusinessId
                      ? "bg-brand-500/5 text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <Check
                    size={14}
                    className={cn(
                      b.id === activeBusinessId
                        ? "text-brand-500 dark:text-brand-400"
                        : "opacity-0",
                    )}
                  />
                  <div className="flex min-w-0 flex-1 flex-col items-start text-start">
                    <span className="truncate font-medium">{b.name}</span>
                    <span
                      dir="ltr"
                      className="truncate text-[10.5px] text-muted-foreground"
                    >
                      {b.meta_ad_account_id}
                    </span>
                  </div>
                </button>
              </form>
            ))
          )}
        </div>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button
              type="submit"
              className="flex w-full cursor-pointer items-center gap-2 text-destructive"
            >
              <LogOut size={14} />
              <span>התנתק</span>
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
