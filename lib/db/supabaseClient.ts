import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Single server-side Supabase client, built from SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY. This key bypasses Row Level Security
 * (constitution Article III.2) — this module must only ever be imported
 * from server-side code (`scripts/*.ts`). Nothing under a future `/app`
 * client boundary may import it.
 */
function createServerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'database_unreachable: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set (see .env.example).',
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const supabase: SupabaseClient = createServerClient();
