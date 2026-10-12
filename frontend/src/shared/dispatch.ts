export const DISPATCH_SCENARIOS = ['accepted', 'rejected', 'transient', 'unknown'] as const;
export type DispatchScenario = typeof DISPATCH_SCENARIOS[number];
export const DISPATCH_STATUSES = ['queued', 'sending', 'accepted', 'rejected', 'retry_wait', 'unknown', 'manual_review', 'dead_letter', 'cancelled'] as const;
export type DispatchStatus = typeof DISPATCH_STATUSES[number];
export type DispatchResult = 'accepted' | 'rejected' | 'transient_failure' | 'unknown';

/** Staff metadata only. No citizen credentials, location or provider response. */
export interface DispatchIntent {
  id: string;
  incidentId: string;
  regionId: string;
  status: DispatchStatus;
  scenario: DispatchScenario;
  attemptCount: number;
  nextAttemptAt: string | null;
  replayOf: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  simulated: true;
}
export interface DispatchAttempt {
  attemptNumber: number;
  startedAt: string;
  finishedAt: string | null;
  result: DispatchResult | null;
  simulated: true;
}
export interface DispatchAcknowledgement {
  attemptNumber: number;
  acknowledgement: 'accepted' | 'rejected' | 'unknown';
  source: 'local-mock' | 'manual';
  recordedAt: string;
  simulated: true;
}
export interface DispatchDetail extends DispatchIntent {
  attempts: DispatchAttempt[];
  acknowledgements: DispatchAcknowledgement[];
}
export interface DispatchPage { items: DispatchIntent[]; nextCursor: string | null }
export interface PublicDispatchStatus {
  status: DispatchStatus;
  updatedAt: string;
  simulated: true;
}
