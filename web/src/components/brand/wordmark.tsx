import { cn } from "@/lib/utils";

type WordmarkProps = {
  className?: string;
  tagline?: boolean;
  subtitle?: string;
};

/**
 * Aiweon wordmark lockup. Typography-based so it adapts to theme + scales
 * cleanly; `Ai` sits in the brand orange, `weOn` inherits foreground.
 */
export function AiweonWordmark({ className, tagline = false, subtitle }: WordmarkProps) {
  return (
    <span dir="ltr" className={cn("inline-flex items-baseline gap-2", className)}>
      <span className="font-sans font-extrabold leading-none tracking-[-0.035em]">
        <span className="text-brand-500 dark:text-brand-400">A</span>
        <span className="relative text-brand-500 dark:text-brand-400">
          i
          <span
            aria-hidden
            className="absolute start-1/2 top-0 -translate-x-1/2 h-[0.18em] w-[0.18em] rounded-full bg-foreground"
          />
        </span>
        <span className="text-foreground">weOn</span>
      </span>
      {subtitle ? (
        <span className="hidden sm:inline text-[0.68em] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {subtitle}
        </span>
      ) : null}
      {tagline ? (
        <span className="sr-only">Aiweon — AI-driven marketing</span>
      ) : null}
    </span>
  );
}
