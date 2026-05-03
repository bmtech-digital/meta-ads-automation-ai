import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

const base = (size: IconProps["size"]) =>
  ({
    xmlns: "http://www.w3.org/2000/svg",
    width: size ?? 18,
    height: size ?? 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  }) as const;

/** Signal wave — for the dashboard / diagnostics surface */
export function SignalIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M3 13.5c1.6 0 1.6-5 3.2-5s1.6 9 3.2 9 1.6-7 3.2-7 1.6 5 3.2 5 1.6-3 3.2-3" />
    </svg>
  );
}

/** Inbox stack — for approvals */
export function InboxIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
      <path d="M4 13l2-7a2 2 0 0 1 2-1.5h8a2 2 0 0 1 2 1.5l2 7" />
      <path d="M4 13h4l1.5 2h5L16 13h4" />
    </svg>
  );
}

/** Target / campaign */
export function TargetIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** History — clock with arrow */
export function HistoryIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M3.5 8.5A9 9 0 1 1 3 12" />
      <path d="M3 4v4.5h4.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}

/** Knowledge — open book with spark */
export function KnowledgeIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H4z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5H20z" />
    </svg>
  );
}

/** Spark — small attention/status accent (used on KPI cards, not in nav) */
export function SparkIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="M5.5 5.5l2.8 2.8" />
      <path d="M15.7 15.7l2.8 2.8" />
      <path d="M5.5 18.5l2.8-2.8" />
      <path d="M15.7 8.3l2.8-2.8" />
    </svg>
  );
}

/** Live status — filled ring that can be animated via className */
export function PulseDot({
  tone = "active",
  className,
}: {
  tone?: "active" | "idle" | "error" | "success";
  className?: string;
}) {
  const toneCls = {
    active: "bg-brand-500 shadow-[0_0_0_3px_hsl(33_93%_54%/0.18)]",
    idle: "bg-muted-foreground/60",
    error: "bg-destructive shadow-[0_0_0_3px_hsl(0_72%_51%/0.18)]",
    success: "bg-success shadow-[0_0_0_3px_hsl(150_60%_40%/0.18)]",
  }[tone];
  return (
    <span className={"inline-flex h-2 w-2 rounded-full " + toneCls + (className ? " " + className : "")} aria-hidden />
  );
}
