import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Nav } from "@/components/nav";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";

export const dynamic = "force-dynamic";

async function signOutAction() {
  "use server";
  await getAuth().signOut();
  redirect("/login");
}

export default async function HomePage() {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login");

  const db = getDataClient();
  const business = process.env.BUSINESS_ID
    ? await db.getBusinessById(process.env.BUSINESS_ID)
    : await db.getFirstBusiness();

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <Nav active="/" />
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold">Campaigner</h1>
            <p className="text-sm text-muted-foreground">{session.email}</p>
          </div>
          <form action={signOutAction}>
            <Button type="submit" variant="outline">
              התנתק
            </Button>
          </form>
        </header>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">DB: {db.mode}</Badge>
          <Badge variant="secondary">Auth: {auth.mode}</Badge>
        </div>

        {business ? (
          <>
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>{business.name}</CardTitle>
                  <CardDescription>הקלט שהסוכן קורא לפני כל ריצה.</CardDescription>
                </div>
                <Link href="/settings">
                  <Button variant="outline" size="sm">
                    ערוך
                  </Button>
                </Link>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-md border p-4">
                    <div className="text-xs text-muted-foreground">תקציב פרסום חודשי</div>
                    <div className="mt-1 text-2xl font-bold">
                      {business.monthly_budget_ils ? `₪${business.monthly_budget_ils}` : "— לא הוגדר"}
                    </div>
                  </div>
                  <div className="rounded-md border p-4">
                    <div className="text-xs text-muted-foreground">תקציב יומי (מחושב)</div>
                    <div className="mt-1 text-2xl font-bold">
                      {business.monthly_budget_ils
                        ? `≈ ₪${Math.round(Number(business.monthly_budget_ils) / 30)}`
                        : "—"}
                    </div>
                  </div>
                  <div className="rounded-md border p-4">
                    <div className="text-xs text-muted-foreground">KPI (אוטומטי לפי vertical)</div>
                    <div className="mt-1 text-2xl font-bold uppercase">
                      {business.primary_kpi ?? "—"}
                    </div>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">חשבון Meta</dt>
                  <dd dir="ltr" className="font-mono text-xs">
                    {business.meta_ad_account_id}
                  </dd>
                  <dt className="text-muted-foreground">Page ID</dt>
                  <dd dir="ltr" className="font-mono text-xs">
                    {business.meta_page_id}
                  </dd>
                  <dt className="text-muted-foreground">מזהה עסק</dt>
                  <dd dir="ltr" className="font-mono text-xs">
                    {business.id}
                  </dd>
                </dl>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>אין עסק פעיל ב-DB</CardTitle>
              <CardDescription>
                הרץ <code className="font-mono">bash scripts/bootstrap_local_db.sh</code> כדי
                להריץ migrations ולטעון seed.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </main>
  );
}
