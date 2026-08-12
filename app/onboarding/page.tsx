import { redirect } from 'next/navigation';
import { getServerSupabaseClient } from '../../lib/supabase/server';
import { submitTopics } from './actions';

interface OnboardingPageProps {
  // Next.js 15: searchParams is a Promise on page components.
  searchParams: Promise<{ error?: string }>;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const { error } = await searchParams;

  // Public read (Phase 2's anon grant on `topics`) — no auth needed here,
  // per plan.md's Module Breakdown.
  const supabase = await getServerSupabaseClient();
  const { data: topics } = await supabase
    .from('topics')
    .select('slug, label')
    .order('slug');

  async function handleSubmit(formData: FormData) {
    'use server';
    const selected = formData.getAll('topics').map(String);
    const result = await submitTopics(selected);
    if (!result.success) {
      const message = result.error ?? 'Something went wrong. Please try again.';
      redirect(`/onboarding?error=${encodeURIComponent(message)}`);
    }
    redirect('/');
  }

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto' }}>
      <h1>Pick what you care about</h1>
      <p>
        Choose at least one topic to get started. You won&apos;t be asked
        again — changing your choices later comes in a future update.
      </p>
      <form action={handleSubmit}>
        {(topics ?? []).map((topic) => (
          <label key={topic.slug} style={{ display: 'block', margin: '0.5rem 0' }}>
            <input type="checkbox" name="topics" value={topic.slug} /> {topic.label}
          </label>
        ))}
        {error && (
          <p role="alert" style={{ color: 'crimson' }}>
            {error}
          </p>
        )}
        <button type="submit" style={{ marginTop: '1rem' }}>
          Continue
        </button>
      </form>
    </main>
  );
}
