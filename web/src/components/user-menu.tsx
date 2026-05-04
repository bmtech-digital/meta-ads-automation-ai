import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getAuth } from "@/lib/auth";

async function signOutAction() {
  "use server";
  await getAuth().signOut();
  redirect("/login");
}

export async function UserMenu() {
  const session = await getAuth().getSession();
  if (!session) return null;

  return (
    <div className="flex items-center gap-2">
      <span
        className="hidden text-xs text-muted-foreground sm:inline"
        dir="ltr"
        title={session.email}
      >
        {session.email}
      </span>
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="sm" className="h-9 px-2.5 text-xs">
          התנתק
        </Button>
      </form>
    </div>
  );
}
