import { NextResponse } from 'next/server';
import { getServerSupabaseClient } from '../../../lib/supabase/server';

/**
 * Exchanges the OAuth provider's auth code for a session and sets the
 * session cookie — no business logic beyond the exchange itself, per
 * plan.md's Auth Architecture. `middleware.ts`'s `resolveRedirect` takes it
 * from here on the very next request (this route always redirects onward,
 * which triggers exactly that next request).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await getServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
