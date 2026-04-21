import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function signInAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const next = String(formData.get("next") ?? "/");
  const result = await getAuth().signIn(email);
  if (!result.ok) {
    redirect(`/login?error=${encodeURIComponent(result.error)}${next && next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
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
    <main className="min-h-screen grid place-items-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>כניסה ל-Campaigner</CardTitle>
          <CardDescription>
            {mode === "dev-cookie"
              ? "מצב פיתוח: הזן את כתובת האימייל שלך — ללא אימות."
              : "שלח קישור חד-פעמי לאימייל שלך."}
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
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit">{mode === "dev-cookie" ? "התחבר" : "שלח קישור"}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
