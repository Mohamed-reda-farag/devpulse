'use server';

import { z } from 'zod';
import { getServerSupabaseClient } from '../../lib/supabase/server';

/**
 * The five fixed topics from constitution Article I / Article V's
 * `ContentItem['topic']` enum — kept in sync with that type by hand, since
 * this is the one place outside `lib/types.ts` that needs the same list as
 * a runtime Zod schema rather than a compile-time type.
 */
const KNOWN_TOPIC_SLUGS = [
  'claude_code',
  'codex',
  'dev_tools',
  'open_models',
  'hackathons',
] as const;

const topicSelectionSchema = z
  .array(z.enum(KNOWN_TOPIC_SLUGS))
  .min(1, 'Select at least one topic before continuing.');

export interface SubmitTopicsResult {
  success: boolean;
  error?: string;
}

/**
 * Validates the submitted topic slugs (Article III.5) and inserts them into
 * `user_topics` as the signed-in person, via RLS — no service role involved
 * (constitution Article III.2). Never throws; failures are returned so the
 * caller can decide how to show them.
 */
export async function submitTopics(
  selectedSlugs: string[],
): Promise<SubmitTopicsResult> {
  const parsed = topicSelectionSchema.safeParse(selectedSlugs);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid topic selection.',
    };
  }

  const supabase = await getServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { success: false, error: 'You must be signed in to continue.' };
  }

  const rows = parsed.data.map((topic_slug) => ({
    user_id: user.id,
    topic_slug,
  }));

  const { error: insertError } = await supabase.from('user_topics').insert(rows);

  if (insertError) {
    console.error('submitTopics: insert into user_topics failed:', insertError);
    return {
      success: false,
      error: 'Could not save your topics. Please try again.',
    };
  }

  return { success: true };
}
