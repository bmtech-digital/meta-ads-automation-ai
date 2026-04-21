import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Nav } from "@/components/nav";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { GalleryClient } from "./gallery-client";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const session = await getAuth().getSession();
  if (!session) redirect("/login?next=/gallery");

  const db = getDataClient();
  const business = process.env.BUSINESS_ID
    ? await db.getBusinessById(process.env.BUSINESS_ID)
    : await db.getFirstBusiness();

  if (!business) {
    return (
      <main className="min-h-screen p-6">
        <div className="mx-auto max-w-4xl">
          <Nav active="/gallery" />
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>אין עסק ב-DB</CardTitle>
              <CardDescription>הרץ migrations ו-seed קודם.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </main>
    );
  }

  const assets = await db.listGalleryAssets(business.id);

  return (
    <main className="min-h-screen p-6">
      <Nav active="/gallery" />
      <div className="mx-auto mt-6 flex max-w-6xl flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">גלריית נכסים</h1>
          <p className="text-sm text-muted-foreground">
            תמונות וסרטונים שמהם הסוכן מושך קריאייטיב כשמוצע <code>new_creative</code> או{" "}
            <code>new_campaign</code>. תמונות: JPEG/PNG/WebP עד 30MB. וידאו: MP4/MOV עד 4GB,
            1-241 שניות, aspect 1:1/4:5/9:16/16:9.
          </p>
        </header>
        <GalleryClient assets={assets} />
      </div>
    </main>
  );
}
