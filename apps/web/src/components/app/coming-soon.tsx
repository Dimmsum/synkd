import type { LucideIcon } from 'lucide-react';
import { Hourglass } from 'lucide-react';
import { EmptyState } from '@synkd/ui/components/misc';

/**
 * Stands in for a feature that isn't built yet (WF-134). Says so plainly instead of showing
 * placeholder people, results or a success that didn't happen.
 */
export function ComingSoon({
  title,
  children,
  icon = Hourglass,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <EmptyState icon={icon} title={title} className={className}>
      {children}
    </EmptyState>
  );
}
