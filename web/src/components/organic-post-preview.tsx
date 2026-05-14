import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import type { Approval } from "@/lib/db/types";

/**
 * OrganicPostPreview — rendered on the approval detail page for any approval
 * whose task_type is `publish_fb_post`, `publish_ig_post`, `publish_ig_story`,
 * or `publish_ig_reel`. Shows the post as it will appear after publish, so the
 * operator's approve/reject decision is informed by a visual + the scheduled
 * time, not just a JSON payload.
 *
 * Intentionally read-only in v1. Edit-before-publish is Phase 4.
 */

type PublishTaskType =
  | "publish_fb_post"
  | "publish_ig_post"
  | "publish_ig_story"
  | "publish_ig_reel";

export function isPublishTaskType(taskType: string): taskType is PublishTaskType {
  return (
    taskType === "publish_fb_post" ||
    taskType === "publish_ig_post" ||
    taskType === "publish_ig_story" ||
    taskType === "publish_ig_reel"
  );
}

const NETWORK_LABEL: Record<PublishTaskType, string> = {
  publish_fb_post: "Facebook · פוסט",
  publish_ig_post: "Instagram · פוסט",
  publish_ig_story: "Instagram · סטורי",
  publish_ig_reel: "Instagram · Reel",
};

const NETWORK_TONE: Record<PublishTaskType, string> = {
  publish_fb_post: "bg-[#1877F2]/10 text-[#1877F2] ring-1 ring-[#1877F2]/30",
  publish_ig_post:
    "bg-gradient-to-r from-[#feda75]/15 via-[#fa7e1e]/15 to-[#d62976]/15 text-[#d62976] ring-1 ring-[#d62976]/30",
  publish_ig_story:
    "bg-gradient-to-r from-[#feda75]/15 via-[#fa7e1e]/15 to-[#d62976]/15 text-[#d62976] ring-1 ring-[#d62976]/30",
  publish_ig_reel:
    "bg-gradient-to-r from-[#feda75]/15 via-[#fa7e1e]/15 to-[#d62976]/15 text-[#d62976] ring-1 ring-[#d62976]/30",
};

interface PublishPayload {
  message?: string;
  caption?: string;
  image_url?: string;
  image_urls?: string[];
  video_url?: string;
  link_url?: string;
  hashtags?: string[];
  thumb_offset_ms?: number;
  share_to_feed?: boolean;
}

function relativeHe(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diffMs = then - Date.now();
  const future = diffMs > 0;
  const abs = Math.abs(diffMs);
  const min = Math.round(abs / 60000);
  if (min < 1) return future ? "תוך כדקה" : "לפני רגע";
  if (min < 60)
    return future ? `בעוד ${min} דק׳` : `לפני ${min} דק׳`;
  const hr = Math.round(min / 60);
  if (hr < 24)
    return future ? `בעוד ${hr} ש׳` : `לפני ${hr} ש׳`;
  const day = Math.round(hr / 24);
  return future ? `בעוד ${day} ימים` : `לפני ${day} ימים`;
}

function formatScheduledFor(scheduledFor: string | null): {
  absolute: string;
  relative: string;
} {
  if (!scheduledFor) {
    return { absolute: "פרסום מיידי", relative: "מיד עם אישור" };
  }
  const d = new Date(scheduledFor);
  return {
    absolute: d.toLocaleString("he-IL", {
      timeZone: "Asia/Jerusalem",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    relative: relativeHe(scheduledFor),
  };
}

export function OrganicPostPreview({
  approval,
}: {
  approval: Approval;
}) {
  if (!isPublishTaskType(approval.task_type)) return null;
  const payload = (approval.payload ?? {}) as PublishPayload;
  const networkLabel = NETWORK_LABEL[approval.task_type];
  const tone = NETWORK_TONE[approval.task_type];
  const isStory = approval.task_type === "publish_ig_story";
  const isReel = approval.task_type === "publish_ig_reel";
  const isVideoKind = isReel || (isStory && payload.video_url);
  const caption = payload.caption ?? payload.message ?? null;
  const sched = formatScheduledFor(approval.scheduled_for);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-4">
      <header className="flex items-center justify-between gap-3">
        <Badge className={tone}>{networkLabel}</Badge>
        <div className="text-[12px] text-muted-foreground">
          {/* `sched.relative` is Hebrew text like "בעוד שעתיים" — must NOT
              be wrapped in dir="ltr" or it gets visually reversed. */}
          תזמון: <span className="font-medium">{sched.absolute}</span>{" "}
          <span>({sched.relative})</span>
        </div>
      </header>

      <div
        className={
          "grid gap-4 " +
          (isStory || isReel ? "md:grid-cols-[200px_1fr]" : "md:grid-cols-2")
        }
      >
        <div
          className={
            "relative overflow-hidden rounded-lg bg-muted " +
            (isStory || isReel
              ? "aspect-[9/16]"
              : approval.task_type === "publish_ig_post"
                ? "aspect-square"
                : "aspect-[4/5]")
          }
        >
          {payload.image_url ? (
            <Image
              src={payload.image_url}
              alt="תצוגה מקדימה"
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
              unoptimized
            />
          ) : payload.image_urls && payload.image_urls.length > 0 ? (
            <Image
              src={payload.image_urls[0]}
              alt="תצוגה מקדימה - סלייד ראשון"
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
              unoptimized
            />
          ) : isVideoKind && payload.video_url ? (
            <video
              src={payload.video_url}
              className="h-full w-full object-cover"
              controls
              playsInline
              muted
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
              אין מדיה
            </div>
          )}
          {payload.image_urls && payload.image_urls.length > 1 ? (
            <div className="absolute end-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10.5px] font-medium text-white">
              קרוסלה {payload.image_urls.length}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          {isStory ? (
            <div className="rounded-md border border-dashed border-border bg-background p-3 text-[12.5px] text-muted-foreground">
              סטוריז לא מציגים טקסט שמועבר ל-API. הטקסט נכנס בעריכת המדיה לפני
              ההעלאה. ה-payload תועד אבל לא ישלח.
            </div>
          ) : caption ? (
            <div className="whitespace-pre-line rounded-md border border-border bg-background p-3 text-[13.5px] leading-relaxed">
              {caption}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-background p-3 text-[12px] text-muted-foreground">
              אין copy ב-payload
            </div>
          )}

          {payload.hashtags && payload.hashtags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {payload.hashtags.map((h) => (
                <span
                  key={h}
                  className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground"
                  dir="ltr"
                >
                  {h.startsWith("#") ? h : `#${h}`}
                </span>
              ))}
            </div>
          ) : null}

          {payload.link_url ? (
            <div className="text-[12px] text-muted-foreground">
              קישור: <span className="font-mono" dir="ltr">{payload.link_url}</span>
            </div>
          ) : null}

          {isReel && payload.share_to_feed === false ? (
            <div className="text-[11.5px] text-muted-foreground">
              לא יוצג בפיד הראשי — Reels בלבד.
            </div>
          ) : null}
        </div>
      </div>

      {approval.external_post_id ? (
        <footer className="border-t border-border pt-2 text-[11.5px] text-muted-foreground">
          פורסם · Meta id:{" "}
          <span className="font-mono" dir="ltr">
            {approval.external_post_id}
          </span>
          {approval.published_at ? (
            <>
              {" · "}
              <span dir="ltr">{approval.published_at}</span>
            </>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
