import { Construction } from 'lucide-react';
import { EmptyState } from '@whosfree/ui/components/misc';
import { PageHeader } from './page-header';

/** Placeholder for routes from PRD §8.3 that aren't built yet (WF-014). */
export function Placeholder({ title, issue }: { title: string; issue: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon={Construction} title="Coming soon">
        This screen is planned in {issue}.
      </EmptyState>
    </>
  );
}
