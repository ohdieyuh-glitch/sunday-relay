import { WONDERLAND_EVENT_TYPES, WONDERLAND_SCHEMA_VERSION, type WonderlandEvent } from './types';

const forbidden = /(?:chain[-_ ]?of[-_ ]?thought|system[_ ]?prompt|api[_-]?key|authorization|password|secret|credential|private[_ ]?brain)/iu;
const token = /(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+|gh[opusr]_[A-Za-z0-9]{10,})/gu;

export function redactTelemetry(input: Readonly<Record<string, unknown>>, visibility: 'OWNER' | 'PARTICIPANTS' | 'PUBLIC'): Readonly<Record<string, unknown>> {
  const clean = (value: unknown, key = ''): unknown => {
    if (forbidden.test(key)) return '[REDACTED]';
    if (typeof value === 'string') return value.replace(token, '[REDACTED]').slice(0, visibility === 'OWNER' ? 4_000 : 500);
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => clean(item));
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v, k)]));
    return value;
  };
  const result = clean(input);
  return (result !== null && typeof result === 'object' ? result : {}) as Readonly<Record<string, unknown>>;
}

export function validateWonderlandEvent(value: WonderlandEvent): string[] {
  const errors: string[] = [];
  if (value.schemaVersion !== WONDERLAND_SCHEMA_VERSION) errors.push('unsupported schemaVersion');
  if (!value.eventId || !value.correlationId || !value.projectId) errors.push('missing identity');
  if (!WONDERLAND_EVENT_TYPES.includes(value.eventType)) errors.push('unsupported eventType');
  if (!Number.isInteger(value.sequence) || value.sequence < 1) errors.push('invalid sequence');
  if (Number.isNaN(Date.parse(value.occurredAt))) errors.push('invalid timestamp');
  if (JSON.stringify(value.payload).match(forbidden)) errors.push('unsafe payload');
  return errors;
}

export function canonicalSnapshot(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item !== null && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)])) : item;
  return JSON.stringify(sort(value));
}
