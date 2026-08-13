import { bridgeSessionHeader, configuredBridgeUrl, loadBridgeSession } from './bridge-session';
import type { LiveMissionUpdate } from './contracts';

/**
 * THE BETA MISSION CLIENT — a thin browser client over the SAME `/mission`
 * routes the API already exposes. It is NOT a second Mission engine: it starts a
 * mission on the connected repository under the chosen config, polls the one
 * authoritative view the bridge returns, and ships a verified one. Every call
 * carries the signed-in participant's session; the browser is never the mission
 * authority — the state it renders is the bridge's, unchanged.
 */

const BASE = '/relay-api';

function authHeaders(): Record<string, string> {
  const session = loadBridgeSession();
  return session === null ? {} : bridgeSessionHeader(session);
}

/** A client-generated mission id — opaque, unique, not derived from anything. */
function newMissionId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `m-${rand}`;
}

export interface StartBetaMissionInput {
  readonly objective: string;
  readonly repositoryKey: string;
  readonly workingBranch: string;
  readonly permissions?: readonly string[];
  readonly config?: unknown;
  readonly bridgeUrl?: string | null;
  readonly fetchImpl?: typeof fetch;
  readonly missionId?: string;
}

export interface BetaMissionResult {
  readonly ok: boolean;
  readonly missionId: string | null;
  readonly view: LiveMissionUpdate | null;
  readonly message: string | null;
}

export async function startBetaMission(input: StartBetaMissionInput): Promise<BetaMissionResult> {
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) return { ok: false, missionId: null, view: null, message: 'No Relay Bridge is configured.' };
  if (loadBridgeSession() === null) return { ok: false, missionId: null, view: null, message: 'Sign in first.' };
  const missionId = input.missionId ?? newMissionId();
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${base}${BASE}/mission/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        missionId,
        objective: input.objective,
        repositoryKey: input.repositoryKey,
        workingBranch: input.workingBranch,
        ...(input.permissions === undefined ? {} : { permissions: input.permissions }),
        ...(input.config === undefined ? {} : { config: input.config }),
      }),
      credentials: 'omit',
      cache: 'no-store',
    });
    const payload = await res.json() as { view?: LiveMissionUpdate; error?: { message?: unknown } };
    if (!res.ok) {
      const message = typeof payload.error?.message === 'string' ? payload.error.message : 'The Mission could not be started.';
      return { ok: false, missionId: null, view: null, message };
    }
    return { ok: true, missionId, view: payload.view ?? null, message: null };
  } catch {
    return { ok: false, missionId: null, view: null, message: 'The Relay Bridge could not be reached.' };
  }
}

export async function pollBetaMission(input: {
  missionId: string; bridgeUrl?: string | null; fetchImpl?: typeof fetch;
}): Promise<BetaMissionResult> {
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) return { ok: false, missionId: null, view: null, message: 'No Relay Bridge is configured.' };
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${base}${BASE}/mission/${encodeURIComponent(input.missionId)}`, {
      method: 'GET', headers: authHeaders(), credentials: 'omit', cache: 'no-store',
    });
    if (!res.ok) return { ok: false, missionId: input.missionId, view: null, message: 'The Mission could not be read.' };
    const payload = await res.json() as { view?: LiveMissionUpdate };
    return { ok: true, missionId: input.missionId, view: payload.view ?? null, message: null };
  } catch {
    return { ok: false, missionId: input.missionId, view: null, message: 'The Relay Bridge could not be reached.' };
  }
}

/** Parse a POST-action response ({ view } on success; a string OR a
 *  {message} object under `error` on failure). The two mission-action routes
 *  answer 404 with a bare-string error and a beta refusal with an object one. */
function actionResult(missionId: string, ok: boolean, payload: { view?: LiveMissionUpdate; error?: unknown }, fallback: string): BetaMissionResult {
  if (ok) return { ok: true, missionId, view: payload.view ?? null, message: null };
  const e = payload.error;
  const message = typeof e === 'string'
    ? e
    : (e !== null && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
      ? (e as { message: string }).message
      : fallback);
  return { ok: false, missionId: null, view: null, message };
}

/** RE-DRIVE a failed Mission. Bounded server-side; a non-retryable one is a
 *  no-op there. Spends money again, so it is auth-guarded exactly like start. */
export async function retryBetaMission(input: {
  missionId: string; bridgeUrl?: string | null; fetchImpl?: typeof fetch;
}): Promise<BetaMissionResult> {
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) return { ok: false, missionId: null, view: null, message: 'No Relay Bridge is configured.' };
  if (loadBridgeSession() === null) return { ok: false, missionId: null, view: null, message: 'Sign in first.' };
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${base}${BASE}/mission/${encodeURIComponent(input.missionId)}/retry`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({}), credentials: 'omit', cache: 'no-store',
    });
    const payload = await res.json() as { view?: LiveMissionUpdate; error?: unknown };
    return actionResult(input.missionId, res.ok, payload, 'The Mission could not be retried.');
  } catch {
    return { ok: false, missionId: null, view: null, message: 'The Relay Bridge could not be reached.' };
  }
}

/** STOP an in-flight Mission. Authoritative — the browser holds no spend, so a
 *  cancel is the user's lever on it. */
export async function cancelBetaMission(input: {
  missionId: string; bridgeUrl?: string | null; fetchImpl?: typeof fetch;
}): Promise<BetaMissionResult> {
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) return { ok: false, missionId: null, view: null, message: 'No Relay Bridge is configured.' };
  if (loadBridgeSession() === null) return { ok: false, missionId: null, view: null, message: 'Sign in first.' };
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${base}${BASE}/mission/${encodeURIComponent(input.missionId)}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({}), credentials: 'omit', cache: 'no-store',
    });
    const payload = await res.json() as { view?: LiveMissionUpdate; error?: unknown };
    return actionResult(input.missionId, res.ok, payload, 'The Mission could not be cancelled.');
  } catch {
    return { ok: false, missionId: null, view: null, message: 'The Relay Bridge could not be reached.' };
  }
}

export async function shipBetaMission(input: {
  missionId: string; bridgeUrl?: string | null; fetchImpl?: typeof fetch;
}): Promise<{ readonly ok: boolean; readonly stage: string | null; readonly shipped: boolean; readonly message: string | null }> {
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) return { ok: false, stage: null, shipped: false, message: 'No Relay Bridge is configured.' };
  if (loadBridgeSession() === null) return { ok: false, stage: null, shipped: false, message: 'Sign in first.' };
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${base}${BASE}/mission/${encodeURIComponent(input.missionId)}/ship`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({}), credentials: 'omit', cache: 'no-store',
    });
    const payload = await res.json() as { data?: { stage?: unknown; shipped?: unknown }; error?: { message?: unknown } };
    if (!res.ok) {
      const message = typeof payload.error?.message === 'string' ? payload.error.message : 'The ship was refused.';
      return { ok: false, stage: null, shipped: false, message };
    }
    return {
      ok: true,
      stage: typeof payload.data?.stage === 'string' ? payload.data.stage : null,
      shipped: payload.data?.shipped === true,
      message: null,
    };
  } catch {
    return { ok: false, stage: null, shipped: false, message: 'The Relay Bridge could not be reached.' };
  }
}
