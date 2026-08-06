/**
 * SUNDAY RELAY — CRON EXPRESSION SEMANTICS.
 *
 * The command parser reads SHAPE (`looksLikeCronField`) and refuses to
 * interpret meaning — its header says semantics belong to the schedule stage.
 * This is that stage: five fields become validated value sets, or the
 * expression is refused with the field and the reason named.
 *
 * WHAT IS ACCEPTED is standard five-field cron, deliberately without the
 * extensions that make schedules unreviewable: no `@yearly` macros, no `L`,
 * no `W`, no `?`. A founder reading a confirmation dialog must be able to
 * see what will run and when from the five fields alone.
 *
 * DOM/DOW follow standard cron OR-semantics: when BOTH day-of-month and
 * day-of-week are restricted, a day matching EITHER runs. Surprising, but
 * sixty years of cron mean every other choice is the surprise.
 */

export interface CronField {
  /** Allowed values, expanded. Always non-empty for a valid field. */
  readonly values: ReadonlySet<number>;
  /** False when the field was a star, with or without a step of one — every
   *  value allowed. The DOM/DOW OR-rule needs restricted-ness, not the set. */
  readonly restricted: boolean;
}

export interface CronSchedule {
  readonly minute: CronField;
  readonly hour: CronField;
  readonly dayOfMonth: CronField;
  readonly month: CronField;
  readonly dayOfWeek: CronField;
  /** The expression these fields came from, verbatim, for display. */
  readonly expression: string;
}

export type CronParseResult =
  | { readonly ok: true; readonly schedule: CronSchedule }
  | { readonly ok: false; readonly problem: string };

interface FieldSpec {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  /** Accepted name tokens, mapped to values (months, weekdays). */
  readonly names?: Readonly<Record<string, number>>;
  /** Values folded onto others AFTER range checks — cron's `7` Sunday. */
  readonly aliases?: Readonly<Record<number, number>>;
}

const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const WEEKDAY_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

const FIELD_SPECS: readonly FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTH_NAMES },
  { name: 'day-of-week', min: 0, max: 7, names: WEEKDAY_NAMES, aliases: { 7: 0 } },
];

const refuse = (problem: string): CronParseResult => ({ ok: false, problem });

/**
 * Parse one expression into validated value sets.
 *
 * Total: every refusal names the field and the token that caused it, because
 * "invalid cron expression" is a message that teaches nothing.
 */
export function parseCronExpression(expression: string): CronParseResult {
  const tokens = expression.trim().split(/\s+/);
  if (tokens.length !== FIELD_SPECS.length || tokens[0] === '') {
    return refuse(
      `A cron expression needs exactly ${FIELD_SPECS.length} fields `
      + `(minute hour day-of-month month day-of-week); received ${tokens[0] === '' ? 0 : tokens.length}.`,
    );
  }

  const fields: CronField[] = [];
  for (const [index, token] of tokens.entries()) {
    const spec = FIELD_SPECS[index] as FieldSpec;
    const parsed = parseField(token, spec);
    if (typeof parsed === 'string') return refuse(parsed);
    fields.push(parsed);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] =
    fields as [CronField, CronField, CronField, CronField, CronField];
  return {
    ok: true,
    schedule: { minute, hour, dayOfMonth, month, dayOfWeek, expression: expression.trim() },
  };
}

/** One field, or the refusal sentence. */
function parseField(token: string, spec: FieldSpec): CronField | string {
  const values = new Set<number>();
  let restricted = false;

  for (const part of token.split(',')) {
    if (part === '') {
      return `The ${spec.name} field "${token}" has an empty list entry.`;
    }
    const [rangeText, stepText, extra] = part.split('/');
    if (extra !== undefined) {
      return `The ${spec.name} entry "${part}" has more than one "/".`;
    }

    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number.parseInt(stepText, 10) < 1) {
        return `The ${spec.name} entry "${part}" has step "${stepText}"; a step must be a positive integer.`;
      }
      step = Number.parseInt(stepText, 10);
    }

    let low: number;
    let high: number;
    if (rangeText === '*') {
      low = spec.min;
      high = spec.max;
      if (stepText !== undefined && step > 1) restricted = true;
    } else {
      restricted = true;
      const [lowText, highText, extraRange] = (rangeText ?? '').split('-');
      if (extraRange !== undefined) {
        return `The ${spec.name} entry "${part}" has more than one "-".`;
      }
      const lowValue = valueOf(lowText ?? '', spec);
      if (lowValue === null) {
        return `"${lowText ?? ''}" is not a ${spec.name} value.`;
      }
      low = lowValue;
      if (highText === undefined) {
        if (stepText !== undefined) {
          // `5/10` means "from 5 by 10 to the end" in some crons and nothing
          // in others. Ambiguity in a paid schedule is refused, not guessed.
          return `The ${spec.name} entry "${part}" applies a step to a single value; write a range (e.g. "${low}-${spec.max}/${step}").`;
        }
        high = low;
      } else {
        const highValue = valueOf(highText, spec);
        if (highValue === null) {
          return `"${highText}" is not a ${spec.name} value.`;
        }
        high = highValue;
        if (high < low) {
          return `The ${spec.name} range "${part}" runs backwards (${low} to ${high}); wrapping ranges are refused, not guessed.`;
        }
      }
    }

    for (let value = low; value <= high; value += step) {
      values.add(spec.aliases?.[value] ?? value);
    }
  }

  if (values.size === 0) {
    return `The ${spec.name} field "${token}" allows no values at all.`;
  }
  return { values, restricted };
}

/** A numeric or named value inside the field's range, or null. */
function valueOf(text: string, spec: FieldSpec): number | null {
  const named = spec.names?.[text.toUpperCase()];
  if (named !== undefined) return named;
  if (!/^\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  if (value < spec.min || value > spec.max) return null;
  return value;
}

/**
 * Does a local calendar minute match?
 *
 * Standard cron OR-rule: with BOTH day fields restricted, either may admit
 * the day; with one restricted, it alone decides; with neither, every day.
 */
export function cronMatches(
  schedule: CronSchedule,
  local: {
    readonly minute: number;
    readonly hour: number;
    readonly dayOfMonth: number;
    readonly month: number;
    /** 0 = Sunday, matching the field's vocabulary. */
    readonly dayOfWeek: number;
  },
): boolean {
  if (!schedule.minute.values.has(local.minute)) return false;
  if (!schedule.hour.values.has(local.hour)) return false;
  if (!schedule.month.values.has(local.month)) return false;

  const domMatch = schedule.dayOfMonth.values.has(local.dayOfMonth);
  const dowMatch = schedule.dayOfWeek.values.has(local.dayOfWeek);
  if (schedule.dayOfMonth.restricted && schedule.dayOfWeek.restricted) {
    return domMatch || dowMatch;
  }
  if (schedule.dayOfMonth.restricted) return domMatch;
  if (schedule.dayOfWeek.restricted) return dowMatch;
  return true;
}
