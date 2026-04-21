import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Nav } from "@/components/nav";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { businessSettingsFormSchema } from "@/lib/schemas/business-settings";

export const dynamic = "force-dynamic";

async function saveSettingsAction(formData: FormData) {
  "use server";
  const session = await getAuth().getSession();
  if (!session) redirect("/login?next=/settings");

  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/settings?error=missing_id");

  const parsed = businessSettingsFormSchema.safeParse({
    name: formData.get("name") ?? "",
    meta_ad_account_id: formData.get("meta_ad_account_id") ?? "",
    meta_page_id: formData.get("meta_page_id") ?? "",
    monthly_budget_ils: formData.get("monthly_budget_ils") ?? "",
  });

  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    redirect(`/settings?error=${encodeURIComponent(msg)}`);
  }

  await getDataClient().updateBusinessSettings(id, parsed.data);
  redirect("/settings?saved=1");
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/settings");

  const { error, saved } = await searchParams;
  const db = getDataClient();
  const business = process.env.BUSINESS_ID
    ? await db.getBusinessById(process.env.BUSINESS_ID)
    : await db.getFirstBusiness();

  if (!business) {
    return (
      <main className="min-h-screen p-6">
        <div className="mx-auto max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>אין עסק ב-DB</CardTitle>
              <CardDescription>
                הרץ את ה-migrations ו-seed_local.py לפני עריכת הגדרות.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <Nav active="/settings" />
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold">הגדרות עסק</h1>
            <p className="text-sm text-muted-foreground">
              הקלט המינימלי שהסוכן קורא לפני כל ריצה.
            </p>
          </div>
          <Link href="/">
            <Button variant="outline">חזרה לדשבורד</Button>
          </Link>
        </header>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">DB: {db.mode}</Badge>
          {saved ? <Badge>נשמר</Badge> : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{business.name}</CardTitle>
            <CardDescription dir="ltr" className="font-mono text-xs">
              {business.id}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveSettingsAction} className="flex flex-col gap-4">
              <input type="hidden" name="id" value={business.id} />

              <div className="flex flex-col gap-2">
                <Label htmlFor="name">שם עסק</Label>
                <Input id="name" name="name" defaultValue={business.name} required />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="meta_ad_account_id">Meta Ad Account ID</Label>
                  <Input
                    id="meta_ad_account_id"
                    name="meta_ad_account_id"
                    defaultValue={business.meta_ad_account_id}
                    dir="ltr"
                    className="text-left font-mono text-sm"
                    placeholder="act_1234567890"
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="meta_page_id">Meta Page ID</Label>
                  <Input
                    id="meta_page_id"
                    name="meta_page_id"
                    defaultValue={business.meta_page_id}
                    dir="ltr"
                    className="text-left font-mono text-sm"
                    required
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="monthly_budget_ils">תקציב פרסום חודשי (₪)</Label>
                <Input
                  id="monthly_budget_ils"
                  name="monthly_budget_ils"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={business.monthly_budget_ils ?? ""}
                  placeholder="לדוגמה 1500"
                />
                <p className="text-xs text-muted-foreground">
                  התקציב היומי נגזר אוטומטית מהסכום החודשי (חודשי ÷ 30). הסוכן משתמש בזה כתקרת הוצאה חודשית.
                </p>
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              <div className="flex gap-2">
                <Button type="submit">שמור</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
