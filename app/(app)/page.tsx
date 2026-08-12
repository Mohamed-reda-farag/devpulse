/**
 * Minimal placeholder for a signed-in, onboarded person — deliberately
 * thin, per plan.md's Module Breakdown. Phase 6 builds the real dashboard
 * that reads `content_items` for this person's chosen topics; this phase's
 * job ends at "you're set up".
 */
export default function AppHomePage() {
  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', textAlign: 'center' }}>
      <h1>You&apos;re all set</h1>
      <p>
        Your topics are saved. The dashboard that shows real content lands in
        a future update — nothing more to do here yet.
      </p>
    </main>
  );
}
