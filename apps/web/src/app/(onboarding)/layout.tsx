// Onboarding (J1, WF-068): signed in, no app shell.
// TODO(WF-004): only reachable when signed in with a confirmed age (proxy.ts).
export const dynamic = 'force-dynamic';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
