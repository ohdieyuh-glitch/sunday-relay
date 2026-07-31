import type {
  RelayCubsUsage,
  RelayMissionContractUsage,
  RelayUsageProvenance,
  RelayUsageSnapshot,
  RelayUsageWindow,
} from './usage-contracts';

/**
 * PURE PROJECTIONS from the canonical usage snapshot to the view models the
 * Usage Bar and usage detail panel render. One projection for every surface,
 * so the compact bar, the detail panel and the focused-panel indicator can
 * never disagree about the same snapshot.
 *
 * Formatting rules:
 *  - `null` NEVER becomes a number. It becomes the word UNAVAILABLE (or
 *    UPDATING when the section says so). Missing usage is not 0%.
 *  - Reset times are formatted from injected ISO strings in UTC — pure input
 *    to pure output, no clock reads, deterministic in every environment.
 */

/** Non-droppable disclosure line for a simulated snapshot. */
export const USAGE_SIMULATED_LABEL =
  'SIMULATED USAGE — DEMO SIMULATION — NOT LIVE CUSTOMER USAGE';

/** Non-droppable disclosure line for the offline product with no usage source. */
export const USAGE_OFFLINE_LABEL =
  'NO LIVE USAGE SOURCE CONNECTED — figures are unavailable, and unavailable is not zero';

const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function parseIso(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function formatClock(date: Date): string {
  const hours24 = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const meridiem = hours24 < 12 ? 'AM' : 'PM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const mm = String(minutes).padStart(2, '0');
  return `${hours12}:${mm} ${meridiem}`;
}

/**
 * Readable reset text from a reset ISO timestamp and the current ISO time.
 * Returns null when the reset time is unknown — the caller must not invent
 * one.
 */
export function formatReset(resetAt: string | null, nowIso: string): string | null {
  if (resetAt === null) return null;
  const reset = parseIso(resetAt);
  const now = parseIso(nowIso);
  if (reset === null || now === null) return null;
  const diff = reset - now;
  if (diff <= 0) return 'Reset due';
  if (diff < MINUTE_MS) return 'Resets in under a minute';
  if (diff < HOUR_MS) return `Resets in ${Math.floor(diff / MINUTE_MS)}m`;
  if (diff < DAY_MS) {
    const hours = Math.floor(diff / HOUR_MS);
    const minutes = Math.floor((diff % HOUR_MS) / MINUTE_MS);
    return `Resets in ${hours}h ${minutes}m`;
  }
  const date = new Date(reset);
  if (diff < 7 * DAY_MS) {
    return `Resets ${WEEKDAYS[date.getUTCDay()]} at ${formatClock(date)}`;
  }
  return `Resets ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/* ------------------------------------------------------------- bar view */

export interface RelayUsageBarView {
  /** Compact display text, e.g. `USAGE · 14 MISSIONS LEFT · 38% / 5H`. */
  readonly summary: string;
  /** Accessible name carrying the same summary in readable prose. */
  readonly ariaLabel: string;
  /** Highest warning level currently visible in the snapshot. */
  readonly tone: 'idle' | 'demo' | 'warning' | 'critical';
  readonly provenance: RelayUsageProvenance;
}

function windowTone(usageWindow: RelayUsageWindow): 'idle' | 'warning' | 'critical' {
  if (usageWindow.percentUsed === null) return 'idle';
  if (usageWindow.percentUsed >= 100) return 'critical';
  if (usageWindow.percentUsed >= 70) return 'warning';
  return 'idle';
}

function contractsTone(c: RelayMissionContractUsage): 'idle' | 'warning' | 'critical' {
  if (c.remaining === null) return 'idle';
  if (c.remaining <= 0) return 'critical';
  if (c.remaining <= 5) return 'warning';
  return 'idle';
}

/** One compact truthful line for the Usage Bar. */
export function projectUsageBar(snapshot: RelayUsageSnapshot): RelayUsageBarView {
  const parts: string[] = [];
  const spoken: string[] = [];

  const { missionContracts, fiveHour } = snapshot;
  if (missionContracts.remaining !== null) {
    parts.push(`${missionContracts.remaining} MISSIONS LEFT`);
    spoken.push(`${missionContracts.remaining} mission contracts remaining`);
  }
  if (fiveHour.percentUsed !== null) {
    parts.push(`${fiveHour.percentUsed}% / 5H`);
    spoken.push(`${fiveHour.percentUsed} percent of the five-hour allowance used`);
  }

  if (snapshot.provenance === 'simulated') {
    const summary = parts.length > 0 ? `USAGE · DEMO · ${parts.join(' · ')}` : 'USAGE · DEMO';
    const detail = spoken.length > 0 ? ` ${spoken.join(', ')}.` : '';
    return {
      summary,
      ariaLabel: `Usage — simulated demo figures.${detail} Opens usage details.`,
      tone: 'demo',
      provenance: snapshot.provenance,
    };
  }

  if (parts.length === 0) {
    const updating =
      missionContracts.status === 'updating' ||
      fiveHour.status === 'updating' ||
      snapshot.weekly.status === 'updating';
    const state = updating ? 'UPDATING' : 'UNAVAILABLE';
    return {
      summary: `USAGE · ${state}`,
      ariaLabel: `Usage — ${state.toLowerCase()}. Opens usage details.`,
      tone: 'idle',
      provenance: snapshot.provenance,
    };
  }

  const tones = [windowTone(fiveHour), windowTone(snapshot.weekly), contractsTone(missionContracts)];
  const tone = tones.includes('critical') ? 'critical' : tones.includes('warning') ? 'warning' : 'idle';
  return {
    summary: `USAGE · ${parts.join(' · ')}`,
    ariaLabel: `Usage — ${spoken.join(', ')}. Opens usage details.`,
    tone,
    provenance: snapshot.provenance,
  };
}

/* ----------------------------------------------------------- detail view */

export interface RelayUsageDetailRow {
  readonly label: string;
  readonly value: string;
}

export interface RelayUsageMeterView {
  /** Bounded 0–100 for the visual bar width. */
  readonly percent: number;
  /** Text stating the same fact — the meter is never color/shape alone. */
  readonly text: string;
}

export interface RelayUsageDetailSection {
  readonly key: 'mission_contracts' | 'five_hour' | 'weekly' | 'cubs';
  readonly title: string;
  readonly rows: readonly RelayUsageDetailRow[];
  readonly meter: RelayUsageMeterView | null;
  readonly note: string | null;
}

export interface RelayUsageDetailView {
  /** Disclosure banner. Null ONLY for genuine live data. */
  readonly provenanceLabel: string | null;
  readonly sections: readonly RelayUsageDetailSection[];
}

const STATUS_TEXT: Record<string, string> = {
  available: 'Available',
  limited: 'Limited',
  blocked: 'Blocked',
  updating: 'Updating',
  unavailable: 'Unavailable',
  not_enabled: 'Not enabled',
};

function windowSection(
  key: 'five_hour' | 'weekly',
  title: string,
  usageWindow: RelayUsageWindow,
  nowIso: string,
): RelayUsageDetailSection {
  const rows: RelayUsageDetailRow[] = [];
  let meter: RelayUsageMeterView | null = null;
  if (usageWindow.percentUsed === null) {
    rows.push({ label: 'Used', value: STATUS_TEXT[usageWindow.status] ?? 'Unavailable' });
  } else {
    const bounded = Math.max(0, Math.min(100, usageWindow.percentUsed));
    rows.push({ label: 'Used', value: `${usageWindow.percentUsed}% used` });
    rows.push({ label: 'Remaining', value: `${Math.max(0, 100 - usageWindow.percentUsed)}% remaining` });
    meter = { percent: bounded, text: `${usageWindow.percentUsed}% used` };
  }
  const reset = formatReset(usageWindow.resetAt, nowIso);
  if (reset !== null) rows.push({ label: 'Reset', value: reset });
  rows.push({ label: 'Status', value: STATUS_TEXT[usageWindow.status] ?? usageWindow.status });
  return { key, title, rows, meter, note: null };
}

export function projectUsageDetail(
  snapshot: RelayUsageSnapshot,
  nowIso: string,
): RelayUsageDetailView {
  const c = snapshot.missionContracts;
  const contractRows: RelayUsageDetailRow[] = [];
  let contractMeter: RelayUsageMeterView | null = null;
  if (c.remaining !== null && c.limit !== null) {
    contractRows.push({ label: 'Remaining', value: `${c.remaining} of ${c.limit} remaining` });
    if (c.used !== null) contractRows.push({ label: 'Used', value: `${c.used} used` });
    if (c.limit > 0) {
      const used = c.used ?? Math.max(0, c.limit - c.remaining);
      const percent = Math.max(0, Math.min(100, Math.round((used / c.limit) * 100)));
      contractMeter = { percent, text: `${c.remaining} of ${c.limit} remaining` };
    }
  } else {
    contractRows.push({ label: 'Allowance', value: STATUS_TEXT[c.status] ?? 'Unavailable' });
  }
  const contractReset = formatReset(c.resetAt, nowIso);
  if (contractReset !== null) contractRows.push({ label: 'Reset', value: contractReset });
  contractRows.push({
    label: 'New managed missions',
    value:
      c.status === 'available'
        ? 'Allowed'
        : c.status === 'blocked'
          ? 'Unavailable until the allowance resets'
          : STATUS_TEXT[c.status] ?? c.status,
  });

  const cubs = snapshot.cubs;
  const cubsRows: RelayUsageDetailRow[] = [];
  let cubsNote: string | null = null;
  if (cubs.status === 'not_enabled') {
    cubsNote = 'Relay Cubs are not enabled yet.';
    cubsRows.push({ label: 'Status', value: 'Not enabled' });
  } else if (cubs.active === null && cubs.weeklyUsed === null) {
    cubsRows.push({ label: 'Status', value: STATUS_TEXT[cubs.status] ?? cubs.status });
  } else {
    if (cubs.active !== null && cubs.concurrentLimit !== null) {
      cubsRows.push({ label: 'Active', value: `${cubs.active} of ${cubs.concurrentLimit} concurrent` });
    }
    if (cubs.weeklyUsed !== null && cubs.weeklyLimit !== null) {
      cubsRows.push({ label: 'This week', value: `${cubs.weeklyUsed} of ${cubs.weeklyLimit} runs` });
    }
    const cubsReset = formatReset(cubs.resetAt, nowIso);
    if (cubsReset !== null) cubsRows.push({ label: 'Reset', value: cubsReset });
    cubsRows.push({ label: 'Status', value: STATUS_TEXT[cubs.status] ?? cubs.status });
  }

  return {
    provenanceLabel:
      snapshot.provenance === 'simulated'
        ? USAGE_SIMULATED_LABEL
        : snapshot.provenance === 'offline'
          ? USAGE_OFFLINE_LABEL
          : null,
    sections: [
      {
        key: 'mission_contracts',
        title: 'Mission Contracts',
        rows: contractRows,
        meter: contractMeter,
        note: null,
      },
      windowSection('five_hour', 'Five-hour usage', snapshot.fiveHour, nowIso),
      windowSection('weekly', 'Weekly usage', snapshot.weekly, nowIso),
      { key: 'cubs', title: 'Relay Cubs', rows: cubsRows, meter: null, note: cubsNote },
    ],
  };
}

/** Export for tests and the panel: never let a cubs section imply live Cubs. */
export function cubsClaimsLive(cubs: RelayCubsUsage, provenance: RelayUsageProvenance): boolean {
  return provenance !== 'simulated' && cubs.status === 'available';
}
