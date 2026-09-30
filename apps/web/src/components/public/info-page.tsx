import { SiteFooter, SiteHeader } from '@/components/public/site-chrome';

/** Shell for simple public text pages (privacy, terms, help). */
export function InfoPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold tracking-[-0.02em]">{title}</h1>
        {intro ? <p className="mt-2 text-body-foreground">{intro}</p> : null}
        <div className="mt-8 flex flex-col gap-6 text-body-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground">
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
