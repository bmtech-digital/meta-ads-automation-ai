"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const active = theme ?? "system";
  const showSun = mounted && resolvedTheme === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="מצב תצוגה"
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {mounted ? (
            showSun ? <Sun size={16} /> : <Moon size={16} />
          ) : (
            <Moon size={16} />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        <DropdownMenuLabel>מצב תצוגה</DropdownMenuLabel>
        <ThemeItem icon={<Sun size={15} />} label="בהיר" value="light" active={active} onSelect={setTheme} />
        <ThemeItem icon={<Moon size={15} />} label="כהה" value="dark" active={active} onSelect={setTheme} />
        <ThemeItem
          icon={<Monitor size={15} />}
          label="לפי המערכת"
          value="system"
          active={active}
          onSelect={setTheme}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeItem({
  icon,
  label,
  value,
  active,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  active: string;
  onSelect: (v: string) => void;
}) {
  const isActive = active === value;
  return (
    <DropdownMenuItem
      onSelect={(e: Event) => {
        e.preventDefault();
        onSelect(value);
      }}
      className={cn("gap-2", isActive && "text-brand-500 dark:text-brand-400")}
    >
      {icon}
      <span>{label}</span>
      {isActive ? (
        <span
          aria-hidden
          className="ms-auto inline-block h-1.5 w-1.5 rounded-full bg-brand-500 dark:bg-brand-400"
        />
      ) : null}
    </DropdownMenuItem>
  );
}
