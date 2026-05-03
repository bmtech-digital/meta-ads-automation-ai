import { Nav } from "@/components/nav";
import { cn } from "@/lib/utils";

type ShellProps = {
  active?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Max content width. `default` is 6xl (dashboards); `narrow` is 3xl (detail pages) */
  width?: "default" | "narrow" | "wide";
};

export function Shell({ active, right, children, className, width = "default" }: ShellProps) {
  const widthCls =
    width === "narrow" ? "max-w-3xl" : width === "wide" ? "max-w-7xl" : "max-w-6xl";
  return (
    <>
      <Nav active={active} right={right} />
      <main className={cn("mx-auto w-full px-4 sm:px-6 py-8 sm:py-10 animate-fade-in", widthCls, className)}>
        {children}
      </main>
    </>
  );
}

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
};

export function PageHeader({ title, subtitle, eyebrow, actions }: PageHeaderProps) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1.5">
        {eyebrow ? (
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-500 dark:text-brand-400">
            {eyebrow}
          </span>
        ) : null}
        <h1 className="text-h1 text-balance">{title}</h1>
        {subtitle ? (
          <p className="max-w-prose text-[14.5px] leading-relaxed text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

type SectionHeaderProps = {
  title: React.ReactNode;
  description?: string;
  action?: React.ReactNode;
};

export function SectionHeader({ title, description, action }: SectionHeaderProps) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2 leading-tight">{title}</h2>
        {description ? (
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
