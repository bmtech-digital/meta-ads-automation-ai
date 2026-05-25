import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Shell, PageHeader } from "@/components/shell";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import {
  listAdsWithCreativeAndCampaign,
  listAdInsights,
  listVideoSources,
  listPagePosts,
  getInstagramAccountIdForPage,
  listInstagramMedia,
  type AdInsightsRow,
  type MetaAdWithCreative,
  type FacebookPagePost,
  type InstagramMedia,
} from "@/lib/meta";
import { tryGetTokenForBusiness } from "@/lib/meta-tokens";
import { GalleryClient, type CreativeUsage } from "./gallery-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "נכסי קריאייטיב" };

function buildCreativeUsage(ads: MetaAdWithCreative[]): CreativeUsage {
  const byCreative = new Map<string, MetaAdWithCreative[]>();
  for (const ad of ads) {
    if (!ad.creative_id) continue;
    const arr = byCreative.get(ad.creative_id) ?? [];
    arr.push(ad);
    byCreative.set(ad.creative_id, arr);
  }
  return Object.fromEntries(byCreative.entries());
}

export default async function GalleryPage() {
  const session = await getAuth().getSession();
  if (!session) redirect("/login?next=/gallery");

  const db = getDataClient();
  const business = await getActiveBusiness();

  if (!business) {
    return (
      <Shell active="/gallery">
        <PageHeader eyebrow="גלריה" title="נכסי קריאייטיב" />
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

  // Resolve token once for all Meta calls below. tryGetTokenForBusiness
  // returns null when there's no connection / token is expired — we surface
  // that as metaError so the page still renders the local gallery.
  const resolved = await tryGetTokenForBusiness(db, business);
  const userToken = resolved?.token ?? null;

  let creativeUsage: CreativeUsage = {};
  let adInsights: Record<string, AdInsightsRow> = {};
  let videoSources: Record<string, string> = {};
  let metaError: string | null = null;
  if (userToken && business.meta_ad_account_id) {
    try {
      const [ads, insights] = await Promise.all([
        listAdsWithCreativeAndCampaign(userToken, business.meta_ad_account_id),
        listAdInsights(userToken, business.meta_ad_account_id),
      ]);
      creativeUsage = buildCreativeUsage(ads);
      adInsights = insights;

      const uniqueVideoIds = new Set<string>();
      for (const ad of ads) {
        if (ad.creative_video_id) uniqueVideoIds.add(ad.creative_video_id);
      }
      if (uniqueVideoIds.size > 0 && business.meta_page_id) {
        videoSources = await listVideoSources(
          userToken,
          Array.from(uniqueVideoIds),
          business.meta_page_id,
        );
      }
    } catch (e) {
      metaError = e instanceof Error ? e.message : "meta_lookup_failed";
    }
  } else if (!userToken) {
    metaError = "no_active_connection";
  }

  let fbPosts: FacebookPagePost[] = [];
  let fbError: string | null = null;
  let igPosts: InstagramMedia[] = [];
  let igError: string | null = null;

  if (userToken && business.meta_page_id) {
    try {
      fbPosts = await listPagePosts(userToken, business.meta_page_id);
    } catch (e) {
      fbError = e instanceof Error ? e.message : "facebook_fetch_failed";
    }

    try {
      const igUserId = await getInstagramAccountIdForPage(
        userToken,
        business.meta_page_id,
      );
      if (igUserId) {
        igPosts = await listInstagramMedia(
          userToken,
          igUserId,
          50,
          business.meta_page_id,
        );
      } else {
        igError = "no_instagram_business_account_linked_to_page";
      }
    } catch (e) {
      igError = e instanceof Error ? e.message : "instagram_fetch_failed";
    }
  }

  return (
    <Shell active="/gallery" width="wide">
      <PageHeader
        eyebrow="קריאייטיב"
        title="נכסי קריאייטיב"
        subtitle="כל וריאציה שהסוכן ייצר או שהעלית. מטריקות חיות נמשכות מ-Meta — אסט שעדיין לא צבר 1,000 חשיפות מסומן כ-'אוסף נתונים'."
      />
      <GalleryClient
        assets={assets}
        creativeUsage={creativeUsage}
        adInsights={adInsights}
        videoSources={videoSources}
        metaError={metaError}
        fbPosts={fbPosts}
        fbError={fbError}
        igPosts={igPosts}
        igError={igError}
      />
    </Shell>
  );
}
