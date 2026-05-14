import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AiweonLogo } from "@/components/brand/logo";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// The only publicly indexable surface — overrides the layout's noindex default.
export const metadata: Metadata = {
  title: "כניסה",
  description:
    "כניסה ל-Aiweon Campaigner — פלטפורמת אופטימיזציה של קמפיינים במטא בעברית, עם אישור אנושי לכל פעולה.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/login" },
  openGraph: {
    type: "website",
    title: "כניסה ל-Aiweon Campaigner",
    description:
      "פלטפורמת אופטימיזציה של קמפיינים במטא — הסוכן מציע, אתה מאשר.",
    url: "/login",
    locale: "he_IL",
    images: [{ url: "/brand/aiweon-mark.png", width: 512, height: 512 }],
  },
};

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Aiweon",
  alternateName: "Aiweon Campaigner",
  url: "https://weon.co.il",
  logo: "https://weon.co.il/aiweon-logo.png",
  description:
    "סוכנות שיווק דיגיטלי מבוססת בינה מלאכותית ופלטפורמת SaaS לאופטימיזציה של קמפיינים במטא.",
  sameAs: ["https://weon.co.il"],
  contactPoint: {
    "@type": "ContactPoint",
    email: "admin@aiweon.co.il",
    contactType: "customer support",
    availableLanguage: ["Hebrew", "English"],
  },
};

async function signInAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const next = String(formData.get("next") ?? "/");
  const result = await getAuth().signIn(email);
  if (!result.ok) {
    redirect(
      `/login?error=${encodeURIComponent(result.error)}${next && next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`,
    );
  }
  redirect(next || "/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const mode = process.env.WEB_AUTH_MODE ?? "dev-cookie";

  return (
    <main className="min-h-screen grid place-items-center px-4 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(ORGANIZATION_JSON_LD),
        }}
      />
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <AiweonLogo size={36} subtitle="Campaigner" />
        <Card className="w-full glass-panel border-0 shadow-none">
          <CardHeader className="space-y-2">
            <CardTitle className="text-h2">ברוכים הבאים</CardTitle>
            <CardDescription>
              {mode === "dev-cookie"
                ? "מצב פיתוח — הזן את כתובת האימייל שלך כדי להיכנס."
                : "שלח קישור חד־פעמי לאימייל שלך כדי להיכנס."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={signInAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">אימייל</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  dir="ltr"
                  className="text-left"
                  placeholder="admin@aiweon.co.il"
                />
              </div>
              {next ? <input type="hidden" name="next" value={next} /> : null}
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <Button type="submit" className="bg-brand-gradient bg-brand-gradient-hover">
                {mode === "dev-cookie" ? "התחבר" : "שלח קישור"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-[12px] leading-relaxed text-muted-foreground">
          החזון שלך | הידע שלנו | הכוח של AI
        </p>
      </div>
    </main>
  );
}
