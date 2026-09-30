import type { NextClerkProviderProps } from '@clerk/nextjs/types';

/**
 * Makes Clerk's components (FR-WEB-2, D19) look like the rest of the app: our design tokens
 * (CSS variables, so the dark palette follows too), no Clerk card or header inside our own
 * auth card, and our own links between sign-in and sign-up.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: 'var(--primary)',
    colorForeground: 'var(--foreground)',
    colorMutedForeground: 'var(--muted-foreground)',
    colorBackground: 'var(--card)',
    colorInput: 'var(--card)',
    colorInputForeground: 'var(--foreground)',
    colorBorder: 'var(--input)',
    colorRing: 'var(--ring)',
    colorDanger: 'var(--destructive)',
    fontFamily: 'var(--font-onest), system-ui, sans-serif',
    fontSize: '0.9375rem',
    borderRadius: '0.625rem',
  },
  options: {
    logoPlacement: 'none',
    // Sit flat inside the (auth) layout's card instead of drawing a second card.
    elevation: 'flush',
    socialButtonsVariant: 'blockButton',
    termsPageUrl: '/terms',
    privacyPageUrl: '/privacy',
    helpPageUrl: '/help',
  },
  elements: {
    // Our pages have their own heading and "New here? / Already have an account?" links.
    header: { display: 'none' },
    footerAction: { display: 'none' },
    rootBox: { width: '100%' },
    cardBox: { width: '100%', maxWidth: '100%' },
    // 48px, like the design's large buttons (NFR-UX-2: 44px+ tap targets).
    socialButtonsBlockButton: { minHeight: '3rem', fontWeight: 600 },
    formButtonPrimary: { minHeight: '2.75rem' },
  },
} satisfies NextClerkProviderProps['appearance'];
