import { bridgeSessionHeader, configuredBridgeUrl, loadBridgeSession } from './bridge-session';

/**
 * THE PSP CLIENT — a thin browser client over the SAME `/relay-api/psp` routes
 * the API already exposes. A PSP is CONFIGURATION (a named, validated
 * {@link RelayMissionConfig}), never a second Mission engine: this lists the
 * profiles a participant saved, loads one to fill the start form, and saves a
 * new one. Every call carries the signed-in participant's session; the browser
 * only ever manages PSPs as itself, because the bridge reads the owner from the
 * verified session and never from the body.
 *
 * It never coerces: a config the bridge refuses (a spend ceiling that is not a
 * real number, say) comes back as a refusal in the bridge's own words, not a
 * silently-repaired value.
 */

const BASE = '/relay-api';

function authHeaders(): Record<string, string> {
  const session = loadBridgeSession();
  return session === null ? {} : bridgeSessionHeader(session);
}

/** The list-row shape the bridge returns — enough to choose one, not the full
 *  config (that is loaded on demand so the form only ever carries one). */
export interface PspSummary {
  readonly pspId: string;
  readonly name: string;
  readonly updatedAt: string;
  /** The execution mode of the saved config, for a one-glance label. */
  readonly mode: string;
}

function toSummary(value: unknown): PspSummary | null {
  if (value === null || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (typeof o.pspId !== 'string' || typeof o.name !== 'string') return null;
  return {
    pspId: o.pspId,
    name: o.name,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
    mode: typeof o.mode === 'string' ? o.mode : 'unknown',
  };
}

export async function listPsps(input: {
  bridgeUrl?: string | null; fetchImpl?: typeof fetch;
} = {}): Promise<{ readonly ok: boolean; readonly psps: readonly PspSummary[]; readonly message: string | null }> {
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) return { ok: false, psps: [], message: 'No Relay Bridge is configured.' };
  if (loadBridgeSession() === null) return { ok: false, psps: [], message: 'Sign in to load saved profiles.' };
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${base}${BASE}/psp`, {
      method: 'GET', headers: authHeaders(), credentials: 'omit', cache: 'no-store',
    });
    if (!res.ok) return { ok: false, psps: [], message: 'Saved profiles could not be read.' };
    const payload = await res.json() as { data?: { psps?: unknown } };
    const raw = Array.isArray(payload.data?.psps) ? payload.data.psps : [];
    const psps = raw.map(toSummary).filter((p): p is PspSummary => p !== null);
    return { ok: true, psps, message: null };
  } catch {
    return { ok: false, psps: [], message: 'The Relay Bridge could not be reached.' };
  }
}

export async function loadPsp(input: {
  pspId: string; bridgeUrl?: string | null; fetchImpl?: typeof fetch;
}): Promise<{ readonly ok: boolean; readonly pspId: string | null; readonly name: string | null; readonly config: unknown; readonly message: string | null }> {
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) return { ok: false, pspId: null, name: null, config: null, message: 'No Relay Bridge is configured.' };
  if (loadBridgeSession() === null) return { ok: false, pspId: null, name: null, config: null, message: 'Sign in first.' };
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${base}${BASE}/psp/${encodeURIComponent(input.pspId)}`, {
      method: 'GET', headers: authHeaders(), credentials: 'omit', cache: 'no-store',
    });
    const payload = await res.json() as { data?: { pspId?: unknown; name?: unknown; config?: unknown }; error?: { message?: unknown } };
    if (!res.ok) {
      const message = typeof payload.error?.message === 'string' ? payload.error.message : 'That profile could not be loaded.';
      return { ok: false, pspId: null, name: null, config: null, message };
    }
    return {
      ok: true,
      pspId: typeof payload.data?.pspId === 'string' ? payload.data.pspId : input.pspId,
      name: typeof payload.data?.name === 'string' ? payload.data.name : null,
      config: payload.data?.config ?? null,
      message: null,
    };
  } catch {
    return { ok: false, pspId: null, name: null, config: null, message: 'The Relay Bridge could not be reached.' };
  }
}

export async function savePsp(input: {
  pspId: string; name: string; config: unknown; bridgeUrl?: string | null; fetchImpl?: typeof fetch;
}): Promise<{ readonly ok: boolean; readonly pspId: string | null; readonly message: string | null }> {
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) return { ok: false, pspId: null, message: 'No Relay Bridge is configured.' };
  if (loadBridgeSession() === null) return { ok: false, pspId: null, message: 'Sign in first.' };
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${base}${BASE}/psp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ pspId: input.pspId, name: input.name, config: input.config }),
      credentials: 'omit',
      cache: 'no-store',
    });
    const payload = await res.json() as { data?: { pspId?: unknown }; error?: { message?: unknown } };
    if (!res.ok) {
      const message = typeof payload.error?.message === 'string' ? payload.error.message : 'The profile could not be saved.';
      return { ok: false, pspId: null, message };
    }
    return { ok: true, pspId: typeof payload.data?.pspId === 'string' ? payload.data.pspId : input.pspId, message: null };
  } catch {
    return { ok: false, pspId: null, message: 'The Relay Bridge could not be reached.' };
  }
}

/** Derive a route-legal pspId from a human name. Returns null when nothing
 *  usable survives (a name of only punctuation), so the caller refuses rather
 *  than inventing an id. Mirrors the server's `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. */
export function pspIdFromName(name: string): string | null {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(slug) ? slug : null;
}
