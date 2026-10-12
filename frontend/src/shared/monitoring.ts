import type { IncidentStatus } from './domain';
export interface OperationalSignal {
  code: 'queue_overdue' | 'realtime_dead_letter' | 'realtime_due_delayed';
  severity: 'warning';
  count: string;
}
export interface OperationalSnapshot {
  sampledAt: string;
  regionIds: string[];
  thresholds: { queueAgeSeconds: number; realtimeDueDelaySeconds: number; stagingOnly: true };
  incidents: {
    active: string; unowned: string; overdue: string; oldestActiveSeconds: number | null;
    byStatus: Record<IncidentStatus, string>;
  };
  realtime: {
    pending: string; due: string; deadLetter: string; delayedDue: string;
    oldestDueDelaySeconds: number | null; publishedLast15Minutes: string; totalFailures: string;
  };
  signals: OperationalSignal[];
}
