import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';
import { resolveRedirect } from './lib/onboarding/redirect';

export async function middleware(request: NextRequest) {
  const { response, supabase, userId } = await updateSession(request);

  let topicCount = 0;
  if (userId) {
    const { count } = await supabase
      .from('user_topics')
      .select('topic_slug', { count: 'exact', head: true })
      .eq('user_id', userId);
    topicCount = count ?? 0;
  }

  const redirectPath = resolveRedirect({
    isSignedIn: userId !== null,
    topicCount,
    pathname: request.nextUrl.pathname,
  });

  if (redirectPath) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = redirectPath;
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on every request except static assets and Next's own internals —
    // those never need an auth/onboarding redirect decision.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
