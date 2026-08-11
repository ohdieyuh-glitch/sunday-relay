import { buildProjectBriefDraft } from '../entry-home/project-brief';
import { bridgeSessionHeader, loadBridgeSession } from './bridge-session';
import type { ProjectBriefDraft } from '../entry-home/contracts';
import type { ProjectSettingsDraft } from '../project-settings/contracts';
import type {
  LiveMissionUpdate,
  ProjectBrain,
  RelayApplicationAdapter,
  RelayMission,
  RelayProject,
  StoredProjectSettings,
} from './contracts';

/**
 * LIVE RELAY APPLICATION ADAPTER (`kind: 'live'`).
 *
 * Implements the same boundary as the demo adapter, but a live mission is
 * driven by the real Relay bridge (a server that runs the real Sunday
 * Alcatraz architect and the real Claude Code coding agent). This module
 * holds NO provider credentials — only a non-secret bridge URL — and reaches
 * the backend exclusively over HTTP (never by importing the engine). The
 * browser is never the mission authority: `startMission`/`pollMission` return
 * the backend's authoritative view, which the store mirrors verbatim.
 *
 * `createProjectBrief` / `prepareProjectBrain` reuse the same deterministic,
 * offline builders the demo adapter uses — they only structure the founder's
 * request for the Brief/Brain panels before the mission runs; the REAL
 * architect runs server-side once the mission starts.
 */

export const RELAY_BRIDGE_API_BASE = '/relay-api';

class BridgeUnreachableError extends Error {
  constructor(message = 'The Relay backend is not reachable.') {
    super(message);
    this.name = 'BridgeUnreachableError';
  }
}

/**
 * THE SESSION IS READ PER CALL, not captured at construction: the founder
 * pairs AFTER the app loads, and an adapter that snapshotted "no session" at
 * startup would stay unauthenticated until a reload — which reads as a broken
 * product exactly when they just did the right thing.
 */
function sessionAuthHeaders(): Record<string, string> {
  const session = loadBridgeSession();
  return session === null ? {} : bridgeSessionHeader(session);
}

export function createLiveRelayApplicationAdapter(config: {
  bridgeBaseUrl?: string;
  fetchImpl?: typeof fetch;
  /**
   * Who this browser is, for the controlled beta.
   *
   * WITHOUT THIS, TURNING THE BETA ON DOES NOT RESTRICT IT — IT TURNS MISSION
   * START OFF. Review found the guard shipped with no client able to satisfy
   * it: every mission start from the website would have been refused 403 the
   * instant the flag was set, the founder's included. Absent is still absent,
   * and the bridge refuses it when the beta is on, which is the honest
   * behaviour for a browser that has not been told who it is.
   */
  participantId?: string;
} = {}): RelayApplicationAdapter {
  const base = (config.bridgeBaseUrl ?? RELAY_BRIDGE_API_BASE).replace(/\/$/, '');
  const doFetch: typeof fetch =
    config.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function call(path: string, init: RequestInit): Promise<LiveMissionUpdate> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        ...init,
        // The paired session rides on EVERY mission call. Without one the
        // header set is empty and the bridge answers 401, which is reported
        // as exactly that below — never as an unreachable backend.
        headers: { ...(init.headers as Record<string, string> | undefined), ...sessionAuthHeaders() },
      });
    } catch {
      throw new BridgeUnreachableError();
    }
    if (!res.ok) {
      /**
       * EACH REFUSAL IS ITS OWN FACT. This threw "not reachable" for every
       * non-OK status, so an unpaired browser was told the backend was down —
       * a false statement about a healthy server, hiding the one action
       * (pairing) that would have fixed it.
       */
      if (res.status === 401) {
        throw new BridgeUnreachableError(
          loadBridgeSession() === null
            ? 'This browser is not paired with the Relay Bridge. Pair it from the Reviewer panel to run live missions.'
            : 'The bridge no longer accepts this browser\u2019s session — it may have expired. Pair again.',
        );
      }
      if (res.status === 403) {
        throw new BridgeUnreachableError(
          'This browser\u2019s session is read-only. Starting a mission needs a CONTROL pairing from the operator CLI.',
        );
      }
      throw new BridgeUnreachableError(
        res.status === 404 ? 'The backend is no longer tracking this mission.' : 'The Relay backend returned an error.',
      );
    }
    let body: { view?: LiveMissionUpdate };
    try {
      body = (await res.json()) as { view?: LiveMissionUpdate };
    } catch {
      throw new BridgeUnreachableError('The Relay backend returned an unreadable response.');
    }
    if (!body.view) throw new BridgeUnreachableError('The Relay backend returned no mission view.');
    return body.view;
  }

  return {
    kind: 'live',

    createProjectBrief(request: string): ProjectBriefDraft {
      return buildProjectBriefDraft(request, null);
    },

    prepareProjectBrain({
      projectId,
      brief,
      settings,
    }: {
      projectId: string;
      brief: ProjectBriefDraft;
      settings: ProjectSettingsDraft | null;
    }): ProjectBrain {
      const now = new Date().toISOString();
      return {
        projectId,
        projectSummary: brief.desiredResult || brief.problem || brief.workingTitle,
        knownTechnologies: settings
          ? Object.values(settings.technology).filter((t): t is string => t !== null)
          : [],
        architectureNotes: [`Project type: ${brief.projectType}`, ...brief.coreFunctionality.slice(0, 3)],
        decisions: [],
        constraints: [...brief.constraints],
        assumptions: ['Draft prepared from your request — the live architect will expand it during the mission.'],
        researchNotes: [...brief.researchTopics.slice(0, 4)],
        recentHandoffs: [],
        lastUpdatedAt: now,
      };
    },

    // A live mission never advances through the manual demo step path — its
    // progression comes from the backend via pollMission.
    advanceMission() {
      return null;
    },

    startMission({ mission }: { mission: RelayMission; project: RelayProject; settings: StoredProjectSettings }) {
      return call('/mission/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          missionId: mission.id,
          objective: mission.objective,
          // Omitted entirely when unknown, rather than sent as an empty string
          // that would read as a participant nobody enrolled.
          ...(config.participantId === undefined ? {} : { participantId: config.participantId }),
        }),
      });
    },

    pollMission({ mission }: { mission: RelayMission }) {
      return call(`/mission/${encodeURIComponent(mission.id)}`, { method: 'GET' });
    },

    cancelMission({ mission }: { mission: RelayMission }) {
      return call(`/mission/${encodeURIComponent(mission.id)}/cancel`, { method: 'POST' });
    },

    retryMission({ mission }: { mission: RelayMission }) {
      // RETRY CARRIES THE PARTICIPANT TOO. It sent no body at all, so it could
      // never satisfy the guard even once a host supplied a value — and retry
      // re-drives the same paid pipeline, so it is guarded for the same reason
      // start is.
      return call(`/mission/${encodeURIComponent(mission.id)}/retry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          config.participantId === undefined ? {} : { participantId: config.participantId },
        ),
      });
    },
  };
}
