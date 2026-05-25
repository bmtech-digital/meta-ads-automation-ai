import type { Metadata, Viewport } from "next";
import {
  Outfit,
  Rubik,
  Heebo,
  Frank_Ruhl_Libre,
  JetBrains_Mono,
} from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Five-family stack from the "Warm Industrial Editorial" design system
// (docs/design/aiweon-handoff/project/design-system.html, §02 Typography).
//
// - Outfit            — Latin display (geometric, condensed at large sizes)
// - Rubik             — Latin + Hebrew body (humane, excellent legibility)
// - Heebo             — Hebrew display (pairs visually with Outfit)
// - Frank Ruhl Libre  — Hebrew editorial / long-form
// - JetBrains Mono    — code, IDs, numeric labels (tabular figures)
//
// globals.css composes these into --font-display / --font-body / --font-mono /
// --font-display-he / --font-editorial-he, and swaps to the Hebrew stack
// automatically for any element with lang="he" or dir="rtl".

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
  weight: ["300", "400", "500", "600", "700", "800"],
});

const rubik = Rubik({
  subsets: ["latin", "hebrew"],
  display: "swap",
  variable: "--font-rubik",
  weight: ["300", "400", "500", "600", "700", "800"],
});

const heebo = Heebo({
  subsets: ["latin", "hebrew"],
  display: "swap",
  variable: "--font-heebo",
  weight: ["300", "400", "500", "600", "700", "800"],
});

const frankRuhl = Frank_Ruhl_Libre({
  subsets: ["hebrew", "latin"],
  display: "swap",
  variable: "--font-frank-ruhl",
  weight: ["400", "500", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
  weight: ["400", "500", "600"],
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://campaigner.aiweon.co.il";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Campaigner · Aiweon",
    template: "%s · Campaigner",
  },
  description:
    "החזון שלך | הידע שלנו | הכוח של AI — פלטפורמת אופטימיזציה של קמפיינים במטא, בלב של Aiweon.",
  applicationName: "Aiweon Campaigner",
  authors: [{ name: "Aiweon", url: "https://weon.co.il" }],
  creator: "Aiweon",
  publisher: "Aiweon",
  icons: {
    icon: [
      { url: "/brand/aiweon-mark.png", sizes: "any", type: "image/png" },
    ],
    apple: "/brand/aiweon-mark.png",
  },
  robots: { index: false, follow: false, nocache: true },
  openGraph: {
    type: "website",
    siteName: "Aiweon Campaigner",
    locale: "he_IL",
    title: "Campaigner · Aiweon",
    description:
      "פלטפורמת אופטימיזציה של קמפיינים במטא — הסוכן מציע, אתה מאשר.",
    images: [{ url: "/brand/aiweon-mark.png", width: 512, height: 512 }],
  },
  twitter: {
    card: "summary",
    title: "Campaigner · Aiweon",
    description:
      "פלטפורמת אופטימיזציה של קמפיינים במטא — הסוכן מציע, אתה מאשר.",
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF8F5" },
    { media: "(prefers-color-scheme: dark)", color: "#101013" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${outfit.variable} ${rubik.variable} ${heebo.variable} ${frankRuhl.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
