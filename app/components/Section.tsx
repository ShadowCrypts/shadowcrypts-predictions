import type { ReactNode } from 'react';

export function Section({
  title,
  subtitle,
  action,
  id,
  children,
  className = '',
  bare = false
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  id?: string;
  children: ReactNode;
  className?: string;
  /** No card chrome: for sections whose children are already cards. */
  bare?: boolean;
}) {
  return (
    <section id={id} className={`scroll-mt-24 ${bare ? '' : 'card p-4 sm:p-6'} ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight text-ink sm:text-xl">{title}</h2>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-2">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function StatTile({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card relative overflow-hidden p-4">
      {/* A soft brand glow in the corner, so a row of tiles reads as one set. */}
      <span className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-accent/15 blur-2xl" aria-hidden />
      <div className="relative flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-3">{label}</p>
        {icon && <span className="rounded-lg bg-accent/10 p-1.5 text-accent-strong ring-1 ring-accent/20">{icon}</span>}
      </div>
      <p className="relative mt-2 font-display text-2xl font-bold tracking-tight text-ink tabular sm:text-[2rem] sm:leading-none">{value}</p>
      {sub && <p className="relative mt-1.5 text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-3">{children}</p>;
}

export function PageHeader({ eyebrow, title, children, aside }: { eyebrow: ReactNode; title: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl animate-fade-up">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-[2.6rem] sm:leading-[1.1]">{title}</h1>
        {children && <div className="mt-3 text-ink-2">{children}</div>}
      </div>
      {aside}
    </header>
  );
}
