import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  /** Rendered height in px (width auto, aspect preserved) */
  size?: number;
  /** Small uppercase subtitle shown after the wordmark (e.g. "Campaigner") */
  subtitle?: string;
  /** Render only the Ai mark (no wordmark) */
  markOnly?: boolean;
};

/**
 * Aiweon logo — uses the official brand PNGs (served by weon.co.il, mirrored
 * locally at `web/public/brand/`) with separate light/dark variants so the
 * black "weOn" wordmark stays readable in both themes.
 */
export function AiweonLogo({ className, size = 28, subtitle, markOnly = false }: LogoProps) {
  const logoHeight = size;
  // The official logo has an aspect ratio of ~3.17:1 (1024×323). Derive width.
  const logoWidth = Math.round(logoHeight * 3.17);

  if (markOnly) {
    return (
      <span dir="ltr" className={cn("inline-flex items-center", className)}>
        <Image
          src="/brand/aiweon-mark.png"
          width={size}
          height={size}
          alt="Aiweon"
          priority
          className="block h-auto w-auto select-none"
          style={{ height: size }}
        />
      </span>
    );
  }

  return (
    <span dir="ltr" className={cn("inline-flex items-center gap-2.5", className)}>
      <picture className="inline-flex shrink-0">
        {/* Light mode: black "weOn" on light background */}
        <Image
          src="/brand/aiweon-logo.png"
          alt="Aiweon Campaigner"
          width={logoWidth}
          height={logoHeight}
          priority
          className="block dark:hidden select-none"
          style={{ height: logoHeight, width: "auto" }}
        />
        {/* Dark mode: white "weOn" on dark background */}
        <Image
          src="/brand/aiweon-logo-dark.png"
          alt=""
          aria-hidden="true"
          width={logoWidth}
          height={logoHeight}
          priority
          className="hidden dark:block select-none"
          style={{ height: logoHeight, width: "auto" }}
        />
      </picture>

      {subtitle ? (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="hidden sm:inline-block h-4 w-px bg-border" />
          <span className="hidden sm:inline text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {subtitle}
          </span>
        </span>
      ) : null}
    </span>
  );
}
