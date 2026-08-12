'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabaseClient } from '../../lib/supabase/client';

type Provider = 'google' | 'github';

const PROVIDER_LABEL: Record<Provider, string> = {
  google: 'Google',
  github: 'GitHub',
};

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Provider | null>(null);

  // The callback route redirects back here with ?error=auth_callback_failed
  // if exchanging the OAuth code for a session didn't work.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'auth_callback_failed') {
      setError('Sign-in did not complete. Please try again.');
    }
  }, []);

  async function signIn(provider: Provider) {
    setError(null);
    setPending(provider);
    const supabase = getBrowserSupabaseClient();
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (signInError) {
      setError(`Could not start sign-in with ${PROVIDER_LABEL[provider]}. Please try again.`);
      setPending(null);
    }
    // On success the browser navigates away to the provider — no further
    // client-side state change happens here.
  }

  return (
    <main style={{ maxWidth: 360, margin: '4rem auto', textAlign: 'center' }}>
      <h1>Sign in to DevPulse</h1>
      <p>Pick either provider — both work the same way.</p>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          marginTop: '1.5rem',
        }}
      >
        <button onClick={() => signIn('google')} disabled={pending !== null}>
          {pending === 'google' ? 'Redirecting…' : 'Sign in with Google'}
        </button>
        <button onClick={() => signIn('github')} disabled={pending !== null}>
          {pending === 'github' ? 'Redirecting…' : 'Sign in with GitHub'}
        </button>
      </div>
      {error && (
        <p role="alert" style={{ color: 'crimson', marginTop: '1rem' }}>
          {error}
        </p>
      )}
    </main>
  );
}
