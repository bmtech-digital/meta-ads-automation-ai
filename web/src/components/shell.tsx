import { Nav } from "@/components/nav";
import { UserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

type ShellProps = {
  active?: string;
  /** Optional page-specific actions; rendered alongside the always-present user menu. */
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Max content width. `default` is 6xl (dashboards); `narrow` is 3xl (detail pages) */
  width?: "default" | "narrow" | "wide";
};

export function Shell({
  active,
  right,
  children,
  className,
  width = "default",
}: ShellProps) {
  const widthCls =
    width === "narrow"
      ? "max-w-3xl"
      : width === "wide"
        ? "max-w-7xl"
        : "max-w-6xl";
  const headerRight = (
    <>
      {right}
      <UserMenu />
    </>
  );
  return (
    <>
      <Nav active={active} right={headerRight} />
      {/* Header is `fixed` (floating-pills pattern) — main content offsets the
          ~80px header + 24px breathing room with pt-28. */}
      <main
        className={cn(
          "mx-auto w-full px-4 sm:px-6 pt-28 pb-10 sm:pb-12 animate-fade-in",
          widthCls,
          className,
        )}
      >
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

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: PageHeaderProps) {
  return (
    // mb-12 gives the title room to breathe — every page reads "anchored"
    // around the heading instead of "tight stack of sections". Eyebrow wider
    // tracking + slightly larger gap; subtitle is its own row, not crammed.
    <div className="mb-12 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div
        className={cn(
          "flex flex-col gap-3",
          eyebrow ? "page-eyebrow-rule" : undefined,
        )}
      >
        {eyebrow ? (
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-brand-500 dark:text-brand-400">
            {eyebrow}
          </span>
        ) : null}
        <h1 className="text-display text-balance">{title}</h1>
        {subtitle ? (
          <p className="max-w-prose text-[15px] leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

type SectionHeaderProps = {
  title: React.ReactNode;
  description?: string;
  action?: React.ReactNode;
};

export function SectionHeader({
  title,
  description,
  action,
}: SectionHeaderProps) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2 leading-tight">{title}</h2>
        {description ? (
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
