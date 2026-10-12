import type { DispatchResult, DispatchScenario } from '../../shared/dispatch.js';

/** The adapter receives references and allowlisted metadata, never raw incident rows. */
export interface DispatchSendInput {
  intentId: string;
  correlationId: string;
  attemptNumber: number;
  scenario: DispatchScenario;
}
export type DispatchDiagnosticCode = 'mock_accepted' | 'mock_rejected' | 'mock_transient' | 'mock_unknown' | 'lease_expired' | 'adapter_exception';
export interface DispatchOutcome {
  result: DispatchResult;
  diagnosticCode: DispatchDiagnosticCode;
  simulated: true;
}
export interface DispatchAdapter {
  readonly key: 'local-mock';
  readonly version: 1;
  send(input: DispatchSendInput): Promise<DispatchOutcome>;
}
