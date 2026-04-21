import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { deleteAsset } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getAuth().getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = getDataClient();
  const business = process.env.BUSINESS_ID
    ? await db.getBusinessById(process.env.BUSINESS_ID)
    : await db.getFirstBusiness();
  if (!business) return NextResponse.json({ error: "business_not_found" }, { status: 404 });

  const existing = await db.getGalleryAssetById(id);
  if (!existing || existing.business_id !== business.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing.meta_creative_id) {
    return NextResponse.json(
      { error: "asset_live_in_meta", meta_creative_id: existing.meta_creative_id },
      { status: 409 },
    );
  }

  const { deleted } = await db.softDeleteGalleryAsset(id, business.id);
  if (!deleted) return NextResponse.json({ error: "already_deleted" }, { status: 410 });

  if (existing.storage_url) {
    try {
      await deleteAsset(existing.storage_url);
    } catch (err) {
      console.error("storage hard-delete failed (soft-delete succeeded):", err);
    }
  }
  return NextResponse.json({ ok: true });
}
