import { redirect } from "next/navigation";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shell, PageHeader } from "@/components/shell";
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
      <Shell active="/gallery">
        <PageHeader eyebrow="גלריה" title="גלריית נכסים" />
        <Card>
          <CardHeader>
            <CardTitle>אין עסק ב-DB</CardTitle>
            <CardDescription>הרץ migrations ו-seed קודם.</CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const assets = await db.listGalleryAssets(business.id);

  return (
    <Shell active="/gallery" width="wide">
      <PageHeader
        eyebrow="גלריה"
        title="גלריית נכסים"
        subtitle="תמונות וסרטונים שמהם הסוכן מושך קריאייטיב כשמוצע new_creative או new_campaign. תמונות: JPEG/PNG/WebP עד 30MB. וידאו: MP4/MOV עד 4GB, 1–241 שניות, aspect 1:1/4:5/9:16/16:9."
      />
      <GalleryClient assets={assets} />
    </Shell>
  );
}
