import { buildProjectBriefDraft } from '../entry-home/project-brief';
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

export function createLiveRelayApplicationAdapter(config: {
  bridgeBaseUrl?: string;
  fetchImpl?: typeof fetch;
} = {}): RelayApplicationAdapter {
  const base = (config.bridgeBaseUrl ?? RELAY_BRIDGE_API_BASE).replace(/\/$/, '');
  const doFetch: typeof fetch =
    config.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function call(path: string, init: RequestInit): Promise<LiveMissionUpdate> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, init);
    } catch {
      throw new BridgeUnreachableError();
    }
    if (!res.ok) {
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
        body: JSON.stringify({ missionId: mission.id, objective: mission.objective }),
      });
    },

    pollMission({ mission }: { mission: RelayMission }) {
      return call(`/mission/${encodeURIComponent(mission.id)}`, { method: 'GET' });
    },

    cancelMission({ mission }: { mission: RelayMission }) {
      return call(`/mission/${encodeURIComponent(mission.id)}/cancel`, { method: 'POST' });
    },

    retryMission({ mission }: { mission: RelayMission }) {
      return call(`/mission/${encodeURIComponent(mission.id)}/retry`, { method: 'POST' });
    },
  };
}
