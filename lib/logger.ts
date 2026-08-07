import type { SourceFailure } from './types.js';

/**
 * Builds a {@link SourceFailure} log entry. `kind` is required (not defaulted)
 * so callers can't accidentally fold a schema mismatch into a generic error —
 * per Article III.11, the two must never look identical in the logs.
 */
export function logSourceFailure(
  source: string,
  kind: SourceFailure['kind'],
  reason: string,
): SourceFailure {
  const failure: SourceFailure = {
    source,
    timestamp: new Date().toISOString(),
    kind,
    reason,
  };
  const label = kind === 'source_contract_changed' ? 'SOURCE CONTRACT CHANGED' : 'FETCH ERROR';
  // eslint-disable-next-line no-console
  console.error(`[${failure.timestamp}] ${label} (${source}): ${reason}`);
  return failure;
}
