import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

export interface UpdateSessionResult {
  /** The response to return from middleware, carrying refreshed session cookies. */
  response: NextResponse;
  /** Same Supabase client used for the refresh, reusable for a follow-up query. */
  supabase: SupabaseClient;
  /** The signed-in person's id, or null if there is no session. */
  userId: string | null;
}

/**
 * Refreshes the Supabase session cookie for one request/response pair.
 * Owns cookie plumbing only — no redirect decisions. Those live in
 * `lib/onboarding/redirect.ts` and are applied by the caller (root
 * `middleware.ts`). Supabase's session tokens expire and need this proactive
 * refresh on every request, or sessions silently die.
 */
export async function updateSession(
  request: NextRequest,
): Promise<UpdateSessionResult> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set (see .env.example).',
    );
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Deliberately getUser(), not getSession(): getSession() only reads the
  // (possibly stale) cookie, while getUser() revalidates the token against
  // Supabase Auth itself — the correct check to run in middleware.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, supabase, userId: user?.id ?? null };
}
