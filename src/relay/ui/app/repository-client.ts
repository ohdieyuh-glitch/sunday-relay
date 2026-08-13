import { bridgeSessionHeader, configuredBridgeUrl, loadBridgeSession } from './bridge-session';

/**
 * THE REPOSITORY CLIENT — a thin browser client over the SAME
 * `/relay-api/repository/list` route the API already exposes, so a RETURNING
 * beta participant can SELECT a repository they already connected (criterion 2
 * "select") instead of re-installing the app. Every call carries the signed-in
 * participant's session, and the bridge scopes the list to the caller from that
 * verified session — never from the body — so a browser only ever lists its own
 * registrations.
 *
 * It never invents: a bridge that refuses the read comes back as a refusal in
 * the bridge's own words, and an empty list comes back as an empty array — never
 * an error, never a fabricated repository.
 *
 * NOTE ON CREDENTIALS. The bridge summary carries a credential env var NAME (not
 * its value); this client deliberately DROPS it. The picker chooses a repository
 * by its identity, not by a credential handle, and a name the UI never needs is
 * a name the UI never renders.
 */

const BASE = '/relay-api';

function authHeaders(): Record<string, string> {
  const session = loadBridgeSession();
  return session === null ? {} : bridgeSessionHeader(session);
}

/** One already-connected repository, enough to recognise and choose it — the
 *  canonical key a Mission runs against, its identity, and whether it is still
 *  live. The credential env var name the bridge also returns is intentionally
 *  not modelled here. */
export interface ConnectedRepository {
  /** The canonical key a Mission runs against — the SAME string a fresh connect
   *  would hand back, so selecting one is indistinguishable from connecting it. */
  readonly key: string;
  readonly provider: string;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  /** The permissions this registration was granted, for a one-glance label. */
  readonly grants: readonly string[];
  /** True when the registration has been revoked — such a row must not be
   *  offered for selection; the bridge would fail it closed anyway. */
  readonly revoked: boolean;
  readonly registeredAt: string;
}

function toRepository(value: unknown): ConnectedRepository | null {
  if (value === null || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (typeof o.key !== 'string' || typeof o.owner !== 'string' || typeof o.name !== 'string') return null;
  return {
    key: o.key,
    provider: typeof o.provider === 'string' ? o.provider : 'github',
    owner: o.owner,
    name: o.name,
    defaultBranch: typeof o.defaultBranch === 'string' ? o.defaultBranch : 'main',
    grants: Array.isArray(o.grants) ? o.grants.filter((g): g is string => typeof g === 'string') : [],
    revoked: o.revoked === true,
    registeredAt: typeof o.registeredAt === 'string' ? o.registeredAt : '',
  };
}

/**
 * THE PARTICIPANT'S CONNECTED REPOSITORIES — the registrations this bridge holds
 * for the signed-in participant. The server scopes it to the session, so a
 * browser only ever lists its own. A refusal is surfaced in the bridge's own
 * words; an empty list is an empty array, never an error.
 */
export async function listConnectedRepositories(input: {
  bridgeUrl?: string | null; fetchImpl?: typeof fetch;
} = {}): Promise<{ readonly ok: boolean; readonly repositories: readonly ConnectedRepository[]; readonly message: string | null }> {
  const base = input.bridgeUrl ?? configuredBridgeUrl();
  if (base === null) return { ok: false, repositories: [], message: 'No Relay Bridge is configured.' };
  if (loadBridgeSession() === null) return { ok: false, repositories: [], message: 'Sign in to see your connected repositories.' };
  const doFetch = input.fetchImpl ?? ((u: RequestInfo | URL, i?: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${base}${BASE}/repository/list`, {
      method: 'GET', headers: authHeaders(), credentials: 'omit', cache: 'no-store',
    });
    const payload = await res.json() as { data?: { registrations?: unknown }; error?: { message?: unknown } };
    if (!res.ok) {
      // Surface the bridge's refusal verbatim; never coerce it into a success.
      const message = typeof payload.error?.message === 'string'
        ? payload.error.message
        : 'Your connected repositories could not be read.';
      return { ok: false, repositories: [], message };
    }
    const raw = Array.isArray(payload.data?.registrations) ? payload.data.registrations : [];
    const repositories = raw.map(toRepository).filter((r): r is ConnectedRepository => r !== null);
    return { ok: true, repositories, message: null };
  } catch {
    return { ok: false, repositories: [], message: 'The Relay Bridge could not be reached.' };
  }
}
