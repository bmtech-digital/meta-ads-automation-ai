import { redirect } from "next/navigation";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { UserMenuClient } from "./user-menu-client";

async function signOutAction() {
  "use server";
  await getAuth().signOut();
  redirect("/login");
}

/**
 * Server wrapper around the user-menu dropdown. Fetches the session user,
 * the active business, and the full business list — then hands them to the
 * client component that renders the dropdown.
 *
 * The dropdown is the single point where the operator switches between client
 * ad accounts (each = one business). Placing the switcher inside the user
 * menu (where the email used to sit) instead of next to the logo per the
 * operator's preference: "click in the place where the email appears today,
 * there will be an option to click a dropdown menu and choose an account".
 */
export async function UserMenu() {
  const session = await getAuth().getSession();
  if (!session) return null;

  const db = getDataClient();
  const [businesses, active] = await Promise.all([
    db.listBusinesses(),
    getActiveBusiness(),
  ]);

  return (
    <UserMenuClient
      email={session.email}
      activeBusinessId={active?.id ?? null}
      businesses={businesses.map((b) => ({
        id: b.id,
        name: b.name,
        meta_ad_account_id: b.meta_ad_account_id,
      }))}
      signOutAction={signOutAction}
    />
  );
}
