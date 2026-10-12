import type { DispatchAdapter, DispatchOutcome, DispatchSendInput } from './contracts.js';

/** Deterministic local rehearsal. No network client or provider credentials. */
export class LocalMockAdapter implements DispatchAdapter {
  readonly key = 'local-mock' as const;
  readonly version = 1 as const;
  async send(input: DispatchSendInput): Promise<DispatchOutcome> {
    switch (input.scenario) {
      case 'accepted': return { result: 'accepted', diagnosticCode: 'mock_accepted', simulated: true };
      case 'rejected': return { result: 'rejected', diagnosticCode: 'mock_rejected', simulated: true };
      case 'transient': return { result: 'transient_failure', diagnosticCode: 'mock_transient', simulated: true };
      case 'unknown': return { result: 'unknown', diagnosticCode: 'mock_unknown', simulated: true };
      default: throw new Error('Unknown local dispatch scenario.');
    }
  }
}
