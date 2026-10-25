export const JULIUS_TRACE_WLJ_RUN_ID: string;
export const JULIUS_TRACE_LABEL: string;
export const JULIUS_SPAN_LABEL: string;
export const JULIUS_TRACE_ROLES: readonly ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'];
export const JULIUS_TRACE_STAGES: readonly ['plan', 'build', 'repair:plan', 'repair:build'];

export function juliusMissionTraceWindow(digestHex: unknown, width: 16 | 32): string | null;

export function juliusMissionHexIdFromDigests(firstDigest: string, secondDigest: string, width: 16 | 32): string;

export function juliusMissionTraceId(wljRunId: unknown): string | null;

export function juliusMissionSpanId(wljRunId: unknown, role: unknown, stage: unknown, attempt: unknown): string | null;

export function juliusMissionTraceparent(traceId: unknown, spanId: unknown): string | null;
