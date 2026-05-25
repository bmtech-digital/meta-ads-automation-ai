import type { Config } from "tailwindcss";

/**
 * Tailwind config — wired to the "Warm Industrial Editorial" design system
 * (docs/design/aiweon-handoff/project/design-system.html). The CSS variables
 * here all resolve in src/app/globals.css under :root (light) and .dark
 * (dark, the default).
 */
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        // Body — Rubik for Latin and Hebrew. Browser auto-falls-back to
        // Heebo for Hebrew when Rubik is missing the glyph.
        sans: [
          "var(--font-rubik)",
          "var(--font-heebo)",
          "system-ui",
          "sans-serif",
        ],
        // Display — Outfit for Latin headlines. Heebo carries the Hebrew
        // weight when an element has lang="he" / dir="rtl" (globals.css
        // swaps to var(--font-display-he) automatically).
        display: [
          "var(--font-outfit)",
          "var(--font-heebo)",
          "system-ui",
          "sans-serif",
        ],
        // Editorial — long-form / pull-quote variant for Hebrew.
        editorial: [
          "var(--font-frank-ruhl)",
          "Georgia",
          "serif",
        ],
        // Mono — JetBrains Mono with tabular figures for IDs and metrics.
        mono: [
          "var(--font-jetbrains-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        // Design-system scale (§02 Typography) — editorial-weight headings.
        hero: [
          "4.5rem", // 72px
          { lineHeight: "1", letterSpacing: "-0.035em", fontWeight: "700" },
        ],
        display: [
          "3rem", // 48px — kept name for back-compat with existing usage
          { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "700" },
        ],
        h1: [
          "3rem", // 48px
          { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "700" },
        ],
        h2: [
          "2rem", // 32px
          { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
        h3: [
          "1.5rem", // 24px
          { lineHeight: "1.2", letterSpacing: "-0.015em", fontWeight: "600" },
        ],
        h4: [
          "1.125rem", // 18px
          { lineHeight: "1.3", fontWeight: "500" },
        ],
      },
      colors: {
        // shadcn semantic tokens — resolved from globals.css HSL aliases.
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Brand amber — design-system §01 Color → Accent. Same scale used by
        // every existing `bg-brand-500`, `text-brand-400`, etc. utility class
        // across the codebase; values now point to amber (#FBBF24 in dark,
        // #D97706 in light) rather than the previous Aiweon-orange.
        brand: {
          DEFAULT: "#FBBF24",
          50: "#FFFBEB",
          100: "#FEF3C7",
          200: "#FDE68A",
          300: "#FCD34D",
          400: "#FBBF24",
          500: "#F59E0B",
          600: "#D97706",
          700: "#B45309",
          800: "#92400E",
          900: "#78350F",
          950: "#422006",
        },
        // Sage — secondary thread (design-system §01 Color → Sage).
        sage: {
          DEFAULT: "#9CAB9B",
          light: "#E8EDE7",
          tint: "#2D3D2C",
          deep: "#7B8B7A",
        },
      },
      borderRadius: {
        // Mapped to design-system --r-* scale.
        xs: "calc(var(--radius) - 6px)",
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 12px)",
        full: "9999px",
      },
      boxShadow: {
        // Design-system §05 Elevation — dark-tuned shadows.
        "ds-sm":  "var(--sh-sm)",
        "ds-md":  "var(--sh-md)",
        "ds-lg":  "var(--sh-lg)",
        "ds-xl":  "var(--sh-xl)",
        "ds-2xl": "var(--sh-2xl)",
        "ds-brand": "var(--sh-brand)",
        "ds-brand-lg": "var(--sh-brand-lg)",

        // Legacy aliases — pre-design-system code references these.
        "elev-1": "var(--sh-sm)",
        "elev-2": "var(--sh-md)",
        "elev-3": "var(--sh-lg)",
        "elev-lift": "var(--sh-xl)",
        "brand-glow": "var(--sh-brand-lg)",
        "focus-brand": "0 0 0 3px rgba(251, 191, 36, 0.28)",
      },
      transitionTimingFunction: {
        spring:   "cubic-bezier(0.34, 1.56, 0.64, 1)",
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      transitionDuration: {
        fast: "150ms",
        base: "200ms",
        slow: "300ms",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(2px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        // Design-system §06 Motion — pulse halo on status pills.
        "ds-pulse": {
          "0%":   { transform: "scale(0.6)", opacity: "0.7" },
          "100%": { transform: "scale(1.7)", opacity: "0" },
        },
        // Skeleton shimmer
        "ds-shim": {
          "0%":   { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
        "ds-pulse": "ds-pulse 1.8s infinite",
        "ds-shim": "ds-shim 1.5s infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
