// Onboarding (J1, WF-068): signed in, no app shell.
// proxy.ts lets users in only once they're signed in, 18+ confirmed and have accepted the
// current terms (lib/auth/gate.ts).
export const dynamic = 'force-dynamic';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
