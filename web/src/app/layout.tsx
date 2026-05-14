import type { Metadata, Viewport } from "next";
import { Assistant, Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Hebrew display + UI font. Replaces Heebo — slightly more contemporary letter
// shapes, tighter on the baseline at display sizes. Aiweon brand voice = AI
// premium, not generic-Heebo SaaS.
const assistant = Assistant({
  subsets: ["hebrew", "latin"],
  display: "swap",
  variable: "--font-assistant",
  weight: ["300", "400", "500", "600", "700", "800"],
});

// Latin sans for English copy. Used automatically by browsers when Assistant
// falls back. Designed for product UI — pairs visually with Assistant's grade.
const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
  weight: ["300", "400", "500", "600", "700"],
});

// Mono for Meta IDs, ad-account ids, and numeric data. Geist Mono's tabular
// figures pair with the body sans without looking like a code editor.
const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
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
  // Whole product is auth-gated — only /login overrides this to be indexable.
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
    { media: "(prefers-color-scheme: light)", color: "#fafaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
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
      className={`${assistant.variable} ${geist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
