import Link from 'next/link';
import type { Route } from 'next';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@whosfree/ui/lib/utils';

/** Title row used by every app screen: title + subtitle on the left, actions on the right. */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: Route; label: string };
  className?: string;
}) {
  return (
    <header className={cn('mb-5 flex flex-col gap-3', className)}>
      {back ? (
        <Link
          href={back.href}
          className="-ml-1 inline-flex min-h-11 w-fit items-center gap-1 rounded-md pr-2 text-[13px] font-semibold text-muted-foreground hover:text-foreground md:min-h-8"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-[-0.02em]">{title}</h1>
          {subtitle ? <div className="text-[13.5px] text-muted-foreground">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** A white card section with an optional title row, like the design's panels. */
export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cn('rounded-2xl border bg-card', className)}
    >
      {title ? (
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2 md:px-5">
          <h2 id={headingId} className="text-[15px] font-semibold">
            {title}
          </h2>
          {action}
        </div>
      ) : null}
      <div className={cn('px-4 pb-4 md:px-5', !title && 'pt-4', bodyClassName)}>{children}</div>
    </section>
  );
}
