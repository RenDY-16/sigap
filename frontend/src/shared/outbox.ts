export const OUTBOX_MAX_FAILURES = 8;
export type OutboxQueueState = "dead_letter" | "pending";
export interface OutboxReviewItem {
  id: string;
  incidentId: string;
  event: string;
  attempts: number;
  totalFailures: string;
  occurredAt: string;
  nextAttemptAt: string;
  deadLetteredAt: string | null;
  lastErrorClass: string | null;
}
export interface OutboxReviewPage {
  items: OutboxReviewItem[];
  nextCursor: string | null;
  maxAttempts: number;
}
