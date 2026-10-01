import { Client, type Pool } from 'pg';

import type { BrowserSessionStore } from '../browser-session/grants';
import { composeJuliusStateApi } from '../julius-state-routes';
import type { NativeWonderlandSessionVerifier, ProjectBrainRoutePorts } from '../project-brain-routes';
import { createProjectBrainWakeups, type ProjectBrainListenClient } from './brain-wakeups';
import type { PbSlotRow } from '../../src/relay/mission/project-brain/project-brain-document';
import { ProjectBrainPostgresStore } from '../../src/relay/persistence/project-brain-postgres';

/**
 * THE PROJECT BRAIN'S PRODUCTION COMPOSITION, on the bridge's ONE Julius pool.
 *
 * The store reads and writes the same database Julius's mission job writes; the
 * wake-ups hold one LISTEN connection to it; the model topology comes from
 * `JuliusRuntimeApi.inspectSlots`, Julius's own answer, never re-derived here.
 * No database: the store is null and both doors answer 503 with the variables
 * named. There is nothing to fall back to.
 */
export function composeProjectBrainPorts(input: {
  readonly pool: Pool | null;
  readonly connectionString: string | null;
  readonly missingConfig: readonly string[];
  readonly sessions: BrowserSessionStore;
  readonly verifyNativeSession?: NativeWonderlandSessionVerifier;
  readonly log?: (line: string) => void;
}): ProjectBrainRoutePorts {
  if (input.pool === null || input.connectionString === null) {
    return { store: null, wakeups: null, missingConfig: input.missingConfig, sessions: input.sessions };
  }
  const pool = input.pool;
  const connectionString = input.connectionString;
  const api = composeJuliusStateApi(pool);
  const slots = async (projectId: string, tenantId: string, runIds: readonly string[]): Promise<readonly PbSlotRow[]> => {
    const rows: PbSlotRow[] = [];
    for (const runId of runIds) {
      const answer = await api.inspectSlots({ tenantId, projectId, actorId: tenantId, scopes: ['run:read'] }, runId);
      if (!answer.ok) continue;
      for (const slot of answer.value) {
        rows.push({ runId, role: slot.role, providerId: slot.providerId, requestedModel: slot.requestedModel, servedModel: slot.servedModel, state: slot.state });
      }
    }
    return rows;
  };
  return {
    store: new ProjectBrainPostgresStore(pool),
    wakeups: createProjectBrainWakeups({
      connect: () => new Client({ connectionString }) as unknown as ProjectBrainListenClient,
      ...(input.log === undefined ? {} : { log: input.log }),
    }),
    missingConfig: [],
    sessions: input.sessions,
    ...(input.verifyNativeSession === undefined ? {} : { verifyNativeSession: input.verifyNativeSession }),
    slots,
  };
}
