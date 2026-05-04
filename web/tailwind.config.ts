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
        sans: ["var(--font-heebo)", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Tightened display sizes with negative tracking baked in
        display: ["2.25rem", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" }],
        h1: ["1.75rem", { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "700" }],
        h2: ["1.375rem", { lineHeight: "1.25", letterSpacing: "-0.015em", fontWeight: "600" }],
        h3: ["1rem", { lineHeight: "1.35", letterSpacing: "-0.01em", fontWeight: "600" }],
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
          DEFAULT: "hsl(33 93% 54%)",
          50: "hsl(33 100% 97%)",
          100: "hsl(33 100% 93%)",
          200: "hsl(33 95% 85%)",
          300: "hsl(33 93% 73%)",
          400: "hsl(33 92% 63%)",
          500: "hsl(33 93% 54%)",
          600: "hsl(33 88% 48%)",   /* #E8850F — the gradient end on weon.co.il */
          700: "hsl(28 85% 40%)",
          800: "hsl(25 78% 33%)",
          900: "hsl(22 70% 27%)",
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
