import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  display: "swap",
  variable: "--font-heebo",
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Campaigner · Aiweon",
  description:
    "החזון שלך | הידע שלנו | הכוח של AI — פלטפורמת אופטימיזציה של קמפיינים במטא, בלב של Aiweon.",
  icons: {
    icon: [
      { url: "/brand/aiweon-mark.png", sizes: "any", type: "image/png" },
    ],
    apple: "/brand/aiweon-mark.png",
  },
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffaf4" },
    { media: "(prefers-color-scheme: dark)", color: "#13100e" },
  ],
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
      className={heebo.variable}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
