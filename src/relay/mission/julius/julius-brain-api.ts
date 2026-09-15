import {
  JULIUS_BRAIN_KIND_SECTION,
  JULIUS_BRAIN_RECORD_KINDS,
  juliusBrainProvenance,
  type JuliusBrainBody,
  type JuliusBrainPrincipal,
  type JuliusBrainRecordKind,
  type JuliusBrainRetirementDisposition,
  type JuliusBrainSection,
} from './julius-brain-contracts';
import { exportJuliusBrain, renderJuliusBrainExportMarkdown } from './julius-brain-export';
import { JULIUS_BRAIN_KIND_POLICIES, juliusBrainEditableSurface, juliusBrainPrincipalClass } from './julius-brain-policy';
import type { JuliusBrainEntityState } from './julius-brain-projection';
import { compileJuliusBrainContext } from './julius-brain-query';
import type { JuliusProjectBrainService } from './julius-brain-service';
import type { JuliusBrainStore } from './julius-brain-store';
import type { JuliusWorkerRole } from './julius-runtime';

/**
 * THE PROJECT BRAIN API CONTRACT, TRANSPORT-AGNOSTIC.
 *
 * The shape a future Brain UI and the bridge mount without redesign: plain
 * request objects in, `{ status, body }` out, the principal supplied by the
 * transport that authenticated it. Nothing here opens a socket.
 *
 * WHAT THE BRAIN CONTAINS IS LARGER THAN WHAT A USER CAN EDIT. Every entity in
 * an overview carries `editable` and `revisableFields` computed for the caller
 * from the same policy the planner enforces; the UI renders what it is told,
 * and an edit it should not have offered is refused anyway (403), because the
 * API calls the governed handle, not a table.
 */

export type JuliusBrainApiRequest =
  | { readonly op: 'surface' }
  | { readonly op: 'overview'; readonly brainId: string; readonly projectId: string; readonly missionId?: string; readonly includeHistory?: boolean }
  | { readonly op: 'entity'; readonly brainId: string; readonly projectId: string; readonly entityId: string }
  | { readonly op: 'history'; readonly brainId: string; readonly projectId: string; readonly entityId?: string; readonly afterSequence?: number; readonly limit?: number }
  | { readonly op: 'provenance'; readonly brainId: string; readonly projectId: string; readonly entityId: string }
  | { readonly op: 'context'; readonly brainId: string; readonly projectId: string; readonly missionId: string; readonly taskId: string | null; readonly role: JuliusWorkerRole | 'JULIUS'; readonly budgetCharacters: number; readonly asOf: string; readonly focusEntityIds?: readonly string[] }
  | { readonly op: 'create'; readonly brainId: string; readonly projectId: string; readonly kind: JuliusBrainRecordKind; readonly body: JuliusBrainBody; readonly missionId: string | null; readonly idempotencyKey: string }
  | { readonly op: 'revise'; readonly brainId: string; readonly projectId: string; readonly entityId: string; readonly expectedVersion: number; readonly body: JuliusBrainBody; readonly idempotencyKey: string }
  | { readonly op: 'retire'; readonly brainId: string; readonly projectId: string; readonly entityId: string; readonly expectedVersion: number; readonly reason: string; readonly disposition: JuliusBrainRetirementDisposition; readonly idempotencyKey: string }
  | { readonly op: 'export'; readonly brainId: string; readonly projectId: string; readonly format: 'json' | 'markdown' };

export interface JuliusBrainApiResponse {
  readonly status: 200 | 201 | 400 | 403 | 404 | 409;
  readonly body: unknown;
}

export interface JuliusBrainApiEntity {
  readonly entityId: string;
  readonly kind: JuliusBrainRecordKind;
  readonly section: JuliusBrainSection;
  readonly version: number;
  readonly lifecycle: JuliusBrainEntityState['lifecycle'];
  readonly body: JuliusBrainBody;
  readonly scope: JuliusBrainEntityState['scope'];
  readonly confidence: number | null;
  readonly createdBy: JuliusBrainPrincipal;
  readonly updatedBy: JuliusBrainPrincipal;
  /** null: Unknown. */
  readonly updatedAt: string | null;
  readonly supersededBy: string | null;
  readonly contradictedBy: readonly string[];
  readonly editable: boolean;
  /** `'*'`, a field list, or `[]` when the caller may not revise it. */
  readonly revisableFields: '*' | readonly string[];
}

const STATUS_FOR: Readonly<Record<string, JuliusBrainApiResponse['status']>> = {
  entity_not_found: 404, brain_not_found: 404,
  version_conflict: 409, idempotency_key_conflict: 409, entity_already_exists: 409, supersession_target_not_active: 409, entity_not_active: 409,
  invalid_draft: 400, credential_shaped_content: 400, scope_is_immutable: 400, link_target_not_found: 400, self_link: 400,
};
const statusFor = (reasonCode: string): JuliusBrainApiResponse['status'] => STATUS_FOR[reasonCode] ?? 403;

function apiEntity(state: JuliusBrainEntityState, principal: JuliusBrainPrincipal): JuliusBrainApiEntity {
  const policy = JULIUS_BRAIN_KIND_POLICIES[state.kind];
  const actor = juliusBrainPrincipalClass(principal);
  const own = policy.ownerRevise && state.createdBy.kind === principal.kind && state.createdBy.id === principal.id;
  const granted = policy.revise[actor];
  const userBlocked = actor === 'USER' && policy.editability !== 'USER_EDITABLE';
  const fields: '*' | readonly string[] = userBlocked || state.lifecycle !== 'ACTIVE' ? [] : own ? '*' : granted ?? [];
  return {
    entityId: state.entityId, kind: state.kind, section: JULIUS_BRAIN_KIND_SECTION[state.kind], version: state.version, lifecycle: state.lifecycle,
    body: state.body, scope: state.scope, confidence: state.confidence, createdBy: state.createdBy, updatedBy: state.updatedBy, updatedAt: state.updatedAt,
    supersededBy: state.supersededBy,
    contradictedBy: state.inbound.filter((edge) => edge.relation === 'CONTRADICTS').map((edge) => edge.source),
    editable: fields === '*' || fields.length > 0,
    revisableFields: fields,
  };
}

export async function handleJuliusBrainApi(
  deps: { readonly service: JuliusProjectBrainService; readonly store: JuliusBrainStore; readonly clock: { now(): string } },
  principal: JuliusBrainPrincipal,
  request: JuliusBrainApiRequest,
): Promise<JuliusBrainApiResponse> {
  if (request.op === 'surface') return { status: 200, body: juliusBrainEditableSurface() };
  const handle = await deps.service.open({ brainId: request.brainId, projectId: request.projectId, principal });
  if (handle === null) return { status: 404, body: { reasonCode: 'brain_not_found' } };

  switch (request.op) {
    case 'overview': {
      const entities = await handle.entities(request.includeHistory ? {} : { lifecycles: ['ACTIVE'] });
      const scoped = request.missionId === undefined ? entities : entities.filter((state) => state.scope.missionId === null || state.scope.missionId === request.missionId);
      const sections: Partial<Record<JuliusBrainSection, JuliusBrainApiEntity[]>> = {};
      for (const kind of JULIUS_BRAIN_RECORD_KINDS) {
        for (const state of scoped.filter((candidate) => candidate.kind === kind).sort((a, b) => a.createdSequence - b.createdSequence)) {
          (sections[JULIUS_BRAIN_KIND_SECTION[kind]] ??= []).push(apiEntity(state, principal));
        }
      }
      return { status: 200, body: { brain: handle.brain, head: await deps.store.head(request.brainId, request.projectId), sections } };
    }
    case 'entity': {
      const state = await handle.entity(request.entityId);
      return state === null ? { status: 404, body: { reasonCode: 'entity_not_found' } } : { status: 200, body: apiEntity(state, principal) };
    }
    case 'history':
      return { status: 200, body: await handle.history({ entityId: request.entityId, afterSequence: request.afterSequence, limit: request.limit }) };
    case 'provenance': {
      const view = await handle.provenance(request.entityId);
      return view === null ? { status: 404, body: { reasonCode: 'entity_not_found' } } : { status: 200, body: view };
    }
    case 'context':
      return {
        status: 200,
        body: compileJuliusBrainContext(await handle.entities(), {
          missionId: request.missionId, taskId: request.taskId, role: request.role, grant: handle.readGrant,
          budgetCharacters: request.budgetCharacters, asOf: request.asOf, focusEntityIds: request.focusEntityIds,
        }),
      };
    case 'create': {
      const provenance = juliusBrainProvenance(principal.kind === 'USER' ? 'user_stated' : 'run_observed');
      const result = await handle.create(request.kind, request.body, { key: request.idempotencyKey, scope: { missionId: request.missionId }, provenance });
      if (result.outcome === 'REFUSED') return { status: statusFor(result.reasonCode), body: result };
      const state = await handle.entity(result.receipts[0]!.entityId);
      return { status: result.receipts[0]!.outcome === 'APPENDED' ? 201 : 200, body: { receipt: result.receipts[0], entity: state === null ? null : apiEntity(state, principal) } };
    }
    case 'revise': {
      const result = await handle.revise(request.entityId, request.body, { key: request.idempotencyKey, expectedVersion: request.expectedVersion });
      if (result.outcome === 'REFUSED') return { status: statusFor(result.reasonCode), body: result };
      const state = await handle.entity(request.entityId);
      return { status: 200, body: { receipt: result.receipts[0], entity: state === null ? null : apiEntity(state, principal) } };
    }
    case 'retire': {
      const result = await handle.retire(request.entityId, { reason: request.reason, disposition: request.disposition, expectedVersion: request.expectedVersion, key: request.idempotencyKey });
      if (result.outcome === 'REFUSED') return { status: statusFor(result.reasonCode), body: result };
      return { status: 200, body: { receipt: result.receipts[0] } };
    }
    case 'export': {
      if (principal.kind !== 'JULIUS' && principal.kind !== 'USER') return { status: 403, body: { reasonCode: 'export_requires_authority' } };
      const bundle = await exportJuliusBrain({ store: deps.store, brainId: request.brainId, projectId: request.projectId, exportedBy: principal, exportedAt: deps.clock.now() });
      if (bundle === null) return { status: 404, body: { reasonCode: 'brain_not_found' } };
      return { status: 200, body: request.format === 'markdown' ? renderJuliusBrainExportMarkdown(bundle) : bundle };
    }
  }
}
