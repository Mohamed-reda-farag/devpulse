import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser-side Supabase client. Only ever imported from Client Components
 * (currently: the OAuth sign-in buttons on `/login`). Built from the two
 * `NEXT_PUBLIC_`-prefixed vars, which Next.js inlines into the client bundle
 * at build time — never the service role key (constitution Article III.2).
 */
export function getBrowserSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set (see .env.example).',
    );
  }
  return createBrowserClient(url, anonKey);
}
