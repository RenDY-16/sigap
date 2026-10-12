import type { IncidentCategoryId } from './domain.js';

/** All operational records remain synthetic until a separate operational sign-off. */
export interface ServiceHours {
  /** ISO weekday: Monday = 1, Sunday = 7. Windows are [opensAt, closesAt).
   * opensAt is 00:00–23:59; closesAt additionally permits 24:00 for day-end.
   * Overnight hours use two windows, ending at 24:00 and starting at 00:00. */
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  opensAt: string;
  closesAt: string;
}
export interface RequiredIncidentField {
  key: string;
  label: string;
  type: 'text' | 'boolean' | 'select';
  required: boolean;
  options?: string[];
}
export interface IncidentCategoryConfiguration {
  id: IncidentCategoryId;
  label: string;
  enabled: boolean;
  requiredFields: RequiredIncidentField[];
}
export interface SopRecord {
  id: string;
  version: number;
  categoryId: IncidentCategoryId;
  title: string;
  steps: string[];
  simulated: true;
}
export const RESPONDER_AVAILABILITIES = ['available', 'busy', 'offline'] as const;
export type ResponderAvailability = (typeof RESPONDER_AVAILABILITIES)[number];
export interface SimulatedResponder {
  id: string;
  label: string;
  enabled: boolean;
  simulated: true;
  availability: ResponderAvailability;
  /** Region IDs; staging persistence currently permits only the parent region. */
  coverageRegionIds: string[];
  categoryIds: IncidentCategoryId[];
}
export interface OperationsConfigurationInput {
  timezone: 'Asia/Makassar';
  serviceHours: ServiceHours[];
  publicFallback: { copy: string; contact: string | null };
  categories: IncidentCategoryConfiguration[];
  sops: SopRecord[];
  responders: SimulatedResponder[];
}
export interface OperationsConfiguration extends OperationsConfigurationInput {
  regionId: string;
  version: number;
  simulated: true;
  externalDispatchEnabled: false;
  createdAt: string;
}

/** Public intake data only. This projection intentionally excludes SOP and responder records. */
export interface PublicOperationsConfiguration {
  version: number;
  timezone: 'Asia/Makassar';
  serviceHours: ServiceHours[];
  publicFallback: { copy: string; contact: string | null };
  categories: Array<Pick<IncidentCategoryConfiguration, 'id' | 'label' | 'requiredFields'>>;
}

/** Work-only configuration for authorized operational roles; excludes public fallback and contact. */
export interface OperationsWorkConfiguration {
  version: number;
  categories: IncidentCategoryConfiguration[];
  sops: SopRecord[];
  responders: SimulatedResponder[];
  pinnedConfigVersion?: number;
  pinnedSops?: SopRecord[];
}
