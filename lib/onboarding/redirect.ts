/**
 * The one piece of business logic in Phase 3 (plan.md's "Onboarding Logic").
 * Pure, synchronous, no Supabase client, no I/O — every redirect *decision*
 * lives here so it's fully unit-testable (constitution Article VI). Callers
 * (middleware.ts) own gathering the real session/topic-count values and
 * acting on whatever this returns.
 */
export interface ResolveRedirectInput {
  isSignedIn: boolean;
  topicCount: number;
  /** The pathname being requested, e.g. `/onboarding` — no query string. */
  pathname: string;
}

const LOGIN_PATH = '/login';
const AUTH_CALLBACK_PATH = '/auth/callback';
const ONBOARDING_PATH = '/onboarding';
const SIGNED_IN_HOME_PATH = '/';

/** Paths a signed-out person may still reach without being bounced to /login. */
const SIGNED_OUT_ALLOWED_PATHS = new Set([LOGIN_PATH, AUTH_CALLBACK_PATH]);

/**
 * Resolves which of plan.md's three redirect rules (if any) applies.
 * Returns the path to redirect to, or `null` to let the request through
 * unchanged.
 */
export function resolveRedirect(input: ResolveRedirectInput): string | null {
  const { isSignedIn, topicCount, pathname } = input;

  if (!isSignedIn) {
    return SIGNED_OUT_ALLOWED_PATHS.has(pathname) ? null : LOGIN_PATH;
  }

  const hasChosenTopics = topicCount > 0;

  if (!hasChosenTopics) {
    const exempt = pathname === ONBOARDING_PATH || pathname === AUTH_CALLBACK_PATH;
    return exempt ? null : ONBOARDING_PATH;
  }

  if (pathname === ONBOARDING_PATH) {
    return SIGNED_IN_HOME_PATH;
  }

  return null;
}
