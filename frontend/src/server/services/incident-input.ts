import { createHash } from 'node:crypto';
import type { CreateIncidentInput, GeoPoint, IncidentFieldAnswers } from '../../shared/domain.js';
import type { IncidentCategoryConfiguration } from '../../shared/operations.js';
import { ApiError } from '../errors.js';

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
export function validatePoint(value: unknown): GeoPoint {
  if (!isPlainRecord(value) || typeof value.lat !== 'number' || !Number.isFinite(value.lat) ||
      value.lat < -90 || value.lat > 90 || typeof value.lng !== 'number' || !Number.isFinite(value.lng) ||
      value.lng < -180 || value.lng > 180) {
    throw new ApiError(400, 'invalid_location', 'Location must include valid latitude and longitude.');
  }
  return { lat: value.lat, lng: value.lng };
}
export function identifier(value: unknown, max = 64): value is string {
  return typeof value === 'string' && value.length <= max && /^[a-z0-9][a-z0-9_-]*$/.test(value);
}
export function reason(value: unknown, required = false): string | null {
  if (value === null || value === undefined) {
    if (required) throw new ApiError(400, 'reason_required', 'A reason is required for this action.');
    return null;
  }
  if (typeof value !== 'string' || value.trim().length > 500) throw new ApiError(400, 'invalid_reason', 'Reason must contain at most 500 characters.');
  const normalized = value.trim();
  if (!normalized && required) throw new ApiError(400, 'reason_required', 'A reason is required for this action.');
  return normalized || null;
}
export function validateCreateInput(value: unknown): CreateIncidentInput {
  if (!isPlainRecord(value)) throw new ApiError(400, 'invalid_body', 'Request body must be an object.');
  if (value.category !== 'security') throw new ApiError(400, 'invalid_category', 'The legacy storage category must be security.');
  const categoryId = value.categoryId === undefined ? 'security' : value.categoryId;
  if (!identifier(categoryId)) throw new ApiError(400, 'invalid_category', 'Choose a configured category.');
  if (value.configVersion !== undefined && (!Number.isSafeInteger(value.configVersion) ||
      (value.configVersion as number) < 1 || (value.configVersion as number) > 2147483647)) {
    throw new ApiError(400, 'invalid_config_version', 'Configuration version must be a positive integer.');
  }
  if (typeof value.description !== 'string' || !value.description.trim() || value.description.trim().length > 500) {
    throw new ApiError(400, 'invalid_description', 'Description must contain 1 to 500 characters.');
  }
  if (value.locationMode !== 'gps' && value.locationMode !== 'simulation') throw new ApiError(400, 'invalid_location_mode', 'Location mode must be gps or simulation.');
  if (value.locationMode === 'gps' && value.initialLocation !== null) throw new ApiError(400, 'invalid_location', 'GPS mode must start without a location fix.');
  const rawAnswers = value.fieldAnswers === undefined ? {} : value.fieldAnswers;
  if (!isPlainRecord(rawAnswers) || Object.keys(rawAnswers).length > 25) throw new ApiError(400, 'invalid_field_answers', 'Answers must be a bounded object.');
  const fieldAnswers: IncidentFieldAnswers = {};
  for (const key of Object.keys(rawAnswers).sort()) {
    const answer = rawAnswers[key];
    if (!identifier(key) || ['__proto__','constructor','prototype','description'].includes(key) ||
        (typeof answer !== 'boolean' && (typeof answer !== 'string' || answer.length > 500))) {
      throw new ApiError(400, 'invalid_field_answers', 'Unknown or invalid answer. Description uses the description field.');
    }
    fieldAnswers[key] = typeof answer === 'string' ? answer.trim() : answer;
  }
  if (Buffer.byteLength(JSON.stringify(fieldAnswers), 'utf8') > 12000) throw new ApiError(400, 'invalid_field_answers', 'Answers are too large.');
  return { category: 'security', categoryId, ...(value.configVersion === undefined ? {} : { configVersion: value.configVersion as number }),
    description: value.description.trim(), locationMode: value.locationMode,
    initialLocation: value.locationMode === 'gps' ? null : validatePoint(value.initialLocation), fieldAnswers };
}
export function validateCategoryAnswers(input: CreateIncidentInput, category: IncidentCategoryConfiguration): void {
  const answers = input.fieldAnswers ?? {};
  const fields = new Map(category.requiredFields.map(field => [field.key, field]));
  for (const key of Object.keys(answers)) {
    if (!fields.has(key)) throw new ApiError(400, 'invalid_field_answers', 'Answer is not defined by the selected category.');
  }
  for (const field of fields.values()) {
    const value = field.key === 'description' ? input.description : answers[field.key];
    if (field.key === 'description' && field.type !== 'text') throw new ApiError(409, 'invalid_category_config', 'Description must use the existing text field.');
    if (value === undefined) {
      if (field.required) throw new ApiError(400, 'required_field_missing', 'A configured required field is missing.');
      continue;
    }
    if (field.type === 'text' && value === '' && field.required) {
      throw new ApiError(400, 'required_field_missing', 'A configured required field is missing.');
    }
    if ((field.type === 'boolean' && typeof value !== 'boolean') ||
        (field.type !== 'boolean' && typeof value !== 'string') ||
        (field.type === 'select' && !field.options?.includes(value as string))) {
      throw new ApiError(400, 'invalid_field_answers', 'Answer does not match the configured field type or options.');
    }
  }
}
/** Uses the resolved snapshot, sorted answers and normalized payload, including on retries. */
export function hashCreatePayload(input: CreateIncidentInput, configVersion: number): string {
  return createHash('sha256').update(JSON.stringify({
    category: input.category, categoryId: input.categoryId ?? 'security', configVersion,
    fieldAnswers: Object.fromEntries(Object.entries(input.fieldAnswers ?? {}).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)),
    description: input.description, locationMode: input.locationMode,
    initialLocation: input.initialLocation ? { lat: input.initialLocation.lat, lng: input.initialLocation.lng } : null,
  })).digest('hex');
}

/** Only used for pre-0004 rows, gated to security/version 1/empty extra answers. */
export function hashLegacyCreatePayload(input: CreateIncidentInput): string {
  return createHash('sha256').update(JSON.stringify({
    category: input.category, description: input.description, locationMode: input.locationMode,
    initialLocation: input.initialLocation ? { lat: input.initialLocation.lat, lng: input.initialLocation.lng } : null,
  })).digest('hex');
}
