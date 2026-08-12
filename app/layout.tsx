import type { ReactNode } from 'react';

export const metadata = {
  title: 'DevPulse',
  description: 'A personalized developer digest.',
};

/**
 * Required by Next.js App Router (every route needs a root layout) — not
 * itself one of tasks.md's numbered tasks, but structurally necessary for
 * `app/login`, `app/onboarding`, and `app/(app)` to render at all.
 * Deliberately unstyled beyond a readable default, matching this phase's
 * "deliberately thin" UI scope (plan.md, Module Breakdown).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
