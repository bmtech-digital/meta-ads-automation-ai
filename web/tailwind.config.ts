import type { Config } from "tailwindcss";

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
        // Assistant carries Hebrew, Geist carries Latin. Browser picks per
        // glyph — Assistant has Latin too but Geist's Latin is sharper at
        // small sizes, so we list it first as a hint.
        sans: [
          "var(--font-assistant)",
          "var(--font-geist)",
          "system-ui",
          "sans-serif",
        ],
        display: [
          "var(--font-assistant)",
          "var(--font-geist)",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        // Display sizes — bumped a touch with tighter tracking so headings
        // carry editorial weight (per "looks like a form" feedback fix).
        display: [
          "2.5rem",
          { lineHeight: "1.05", letterSpacing: "-0.025em", fontWeight: "700" },
        ],
        h1: [
          "1.875rem",
          { lineHeight: "1.15", letterSpacing: "-0.022em", fontWeight: "700" },
        ],
        h2: [
          "1.4375rem",
          { lineHeight: "1.25", letterSpacing: "-0.017em", fontWeight: "600" },
        ],
        h3: [
          "1.0625rem",
          { lineHeight: "1.35", letterSpacing: "-0.01em", fontWeight: "600" },
        ],
      },
      colors: {
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
        brand: {
          /* Aligned with aiweon-ser palette (D:\aiweon-ser): #f5841f /
             #ffb878 / #c4641a. Slightly redder than the old yellow-orange
             so it reads CRISP against neutral cool-grays in dark mode
             instead of "muddy". */
          DEFAULT: "hsl(28 91% 54%)" /* #f5841f */,
          50: "hsl(28 100% 97%)",
          100: "hsl(28 100% 92%)",
          200: "hsl(28 100% 82%)" /* #ffb878 — brand-soft */,
          300: "hsl(28 95% 72%)",
          400: "hsl(28 92% 62%)",
          500: "hsl(28 91% 54%)" /* #f5841f — brand DEFAULT */,
          600: "hsl(22 88% 44%)" /* #c4641a — brand-deep */,
          700: "hsl(20 84% 38%)",
          800: "hsl(18 78% 30%)",
          900: "hsl(16 70% 24%)",
        },
      },
      borderRadius: {
        xs: "calc(var(--radius) - 6px)",
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },
      boxShadow: {
        // Layered — mirrors weon.co.il's shadow depth
        "elev-1": "0 2px 8px 0 hsl(33 10% 0% / 0.05)",
        "elev-2":
          "0 2px 20px 0 hsl(33 10% 0% / 0.08), 0 0 0 1px hsl(var(--border))",
        "elev-3":
          "0 4px 20px 0 hsl(33 10% 0% / 0.12), 0 0 0 1px hsl(var(--border))",
        "elev-lift":
          "0 10px 40px 0 hsl(33 10% 0% / 0.15), 0 0 0 1px hsl(var(--border))",
        "brand-glow": "0 8px 24px 0 hsl(33 93% 54% / 0.35)",
        "focus-brand": "0 0 0 3px hsl(33 93% 54% / 0.28)",
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
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
