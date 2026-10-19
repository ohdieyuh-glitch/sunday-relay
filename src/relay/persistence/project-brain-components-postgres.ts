import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import {
  PROJECT_BRAIN_EVENT_SCHEMA_V1,
  PROJECT_BRAIN_MUTATION_SCHEMA_V1,
  projectBrainCanonicalJson,
  projectBrainRefusal,
  projectBrainStreamId,
  type ProjectBrainActor,
  type ProjectBrainCapability,
  type ProjectBrainDeliverer,
  type ProjectBrainEventType,
  type ProjectBrainProvenance,
  type ProjectBrainRefusal,
} from '../mission/project-brain/project-brain';
import {
  PROJECT_BRAIN_CARD_DEFAULT_REF,
  PROJECT_BRAIN_DEFAULT_CARD,
  authorizeProjectBrainComponentMutation,
  parseProjectBrainComponentMutation,
  projectBrainCardRevision,
  projectBrainComponentEventType,
  projectBrainHandoffMove,
  type ProjectBrainCardContent,
  type ProjectBrainCardState,
  type ProjectBrainComponentCommand,
  type ProjectBrainComponentOperation,
  type ProjectBrainEvalResult,
  type ProjectBrainEvalStatus,
  type ProjectBrainHandoffState,
  type PbCardRow,
  type PbEvalRow,
  type ProjectBrainComponentRows,
} from '../mission/project-brain/project-brain-components';
import { ProjectBrainCorruptionError, ProjectBrainSchemaNewerError, checkout, projectBrainSchema, resolveProjectBrainRef } from './project-brain-pg-shared';

export { ProjectBrainCorruptionError };

/**
 * THE C.A.R.D., MISSION HANDOFF AND EVAL COMPONENTS, DURABLE (migration 034).
 *
 * The same discipline as the record store, on purpose (project-brain-postgres.ts `mutate`, left unchanged):
 *
 *   - ONE transaction per change, serialised per project by the same advisory lock, so the idempotency check, the
 *     version checks and the stream sequence are race-free;
 *   - ONE idempotency namespace per project: the component operations write the same mutation log, so a key used for a
 *     record cannot be reused for a card;
 *   - every change names the version it changes (a card's, the selection's, a handoff's, an eval's) and is refused if
 *     that is no longer current -- never a blind last write;
 *   - every reference must resolve IN THIS PROJECT, inside the transaction;
 *   - the change, its version row, its mutation row and the event announcing it commit together or not at all;
 *   - an error before COMMIT is `durable: false`, an error DURING COMMIT is `durable: 'unknown'` (retry the same key).
 *
 * NOTHING HERE WRITES ONE OF JULIUS'S ROWS. A handoff reads the run's state and leaves the run exactly as it was; a pin
 * records which card version a run started under beside the run, never in it.
 */

export interface ProjectBrainComponentResult {
  readonly schemaVersion: typeof PROJECT_BRAIN_MUTATION_SCHEMA_V1;
  readonly mutationId: string;
  readonly operation: ProjectBrainComponentOperation;
  readonly projectId: string;
  readonly runId: string | null;
  /** The component changed: a card (`pbcard:<uuid>`), the selection's card, a mission, an eval (`pbeval:<uuid>`). */
  readonly componentRef: string;
  readonly version: number | null;
  /** The component's state after the change: LIVE/DELETED, HANDED_OFF/RETURNED, CURRENT/INVALIDATED, or the pinned revision. */
  readonly state: string | null;
  readonly eventId: string;
  readonly eventType: ProjectBrainEventType;
  readonly streamId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly author: ProjectBrainActor;
  readonly deliverer: ProjectBrainDeliverer;
  /** What else the same transaction changed, by reference: a reset selection, a superseded eval. */
  readonly alsoChanged: readonly string[];
}

export type ProjectBrainComponentOutcome =
  | { readonly ok: true; readonly durable: true; readonly replayed: boolean; readonly result: ProjectBrainComponentResult }
  | (ProjectBrainRefusal & { readonly durable: false | 'unknown'; readonly details?: Readonly<Record<string, unknown>> });

type Row = Record<string, unknown>;
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const strOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const iso = (value: unknown): string => new Date(String(value)).toISOString();
const codeOf = (error: unknown): string | undefined =>
  error !== null && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined;

/** A card's content hash: the canonical JSON of what it says. The built-in default hashes like any other card. */
export const projectBrainCardContentHash = (card: ProjectBrainCardContent): string => sha256(projectBrainCanonicalJson(card));

function cardRowOf(row: Row): PbCardRow {
  const cardId = str(row.card_id);
  const raw = typeof row.content === 'string' ? (() => { try { return JSON.parse(row.content as string) as unknown; } catch { return null; } })() : row.content;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ProjectBrainCorruptionError('project_brain_cards', cardId, 'content is not a JSON object');
  const content = raw as ProjectBrainCardContent;
  if (projectBrainCardContentHash(content) !== str(row.content_hash)) {
    throw new ProjectBrainCorruptionError('project_brain_cards', cardId, 'content does not match its content_hash');
  }
  return {
    cardId, state: str(row.state) as ProjectBrainCardState, name: str(row.name), content, contentHash: str(row.content_hash),
    version: Number(row.version), author: { kind: str(row.author_kind) as ProjectBrainActor['kind'], id: str(row.author_id) },
    deliverer: { kind: str(row.deliverer_kind) as ProjectBrainDeliverer['kind'], id: str(row.deliverer_id) },
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function evalRowOf(row: Row): PbEvalRow {
  const evalId = str(row.eval_id);
  const refs = typeof row.evidence_refs === 'string' ? (() => { try { return JSON.parse(row.evidence_refs as string) as unknown; } catch { return null; } })() : row.evidence_refs;
  if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== 'string')) throw new ProjectBrainCorruptionError('project_brain_evals', evalId, 'evidence_refs is not a list of references');
  return {
    evalId, runId: strOrNull(row.run_id), subjectRef: str(row.subject_ref), subjectRevision: str(row.subject_revision), criterion: str(row.criterion),
    result: str(row.result) as ProjectBrainEvalResult, evidenceRefs: refs as string[], status: str(row.status) as ProjectBrainEvalStatus,
    supersededBy: strOrNull(row.superseded_by), version: Number(row.version),
    evaluator: { kind: str(row.evaluator_kind) as ProjectBrainActor['kind'], id: str(row.evaluator_id) },
    recordedAt: iso(row.recorded_at), updatedAt: iso(row.updated_at),
  };
}

export class ProjectBrainComponentStore {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly pool: Pool, options: { readonly now?: () => Date; readonly newId?: () => string } = {}) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
  }

  /* ----------------------------------------------------------------- reads */

  /** The components of one project, read inside the CALLER's snapshot (the record store's REPEATABLE READ transaction). */
  static async readWithin(client: PoolClient, projectId: string, runId: string | null): Promise<ProjectBrainComponentRows> {
    const cards = await client.query<Row>('SELECT * FROM relay_wonderland.project_brain_cards WHERE project_id=$1 ORDER BY created_at, card_id', [projectId]);
    const selection = await client.query<Row>('SELECT card_ref,version,updated_at FROM relay_wonderland.project_brain_card_selection WHERE project_id=$1', [projectId]);
    const runFilter = runId === null ? '' : ' AND run_id=$2';
    const values = runId === null ? [projectId] : [projectId, runId];
    const pins = await client.query<Row>(`SELECT run_id,card_ref,card_version,content_hash,pinned_at FROM relay_wonderland.project_brain_mission_cards WHERE project_id=$1${runFilter} ORDER BY pinned_at, run_id`, values);
    const handoffs = await client.query<Row>(`SELECT run_id,state,form,version,updated_at FROM relay_wonderland.project_brain_handoffs WHERE project_id=$1${runFilter} ORDER BY updated_at, run_id`, values);
    const evals = await client.query<Row>(`SELECT * FROM relay_wonderland.project_brain_evals WHERE project_id=$1${runId === null ? '' : ' AND (run_id IS NULL OR run_id=$2)'} ORDER BY recorded_at, eval_id`, values);
    const chosen = selection.rows[0];
    return {
      cards: cards.rows.map(cardRowOf),
      selection: chosen === undefined ? null : { cardRef: str(chosen.card_ref), version: Number(chosen.version), updatedAt: iso(chosen.updated_at) },
      missionCards: pins.rows.map((row) => ({ runId: str(row.run_id), cardRef: str(row.card_ref), cardVersion: Number(row.card_version), contentHash: str(row.content_hash), pinnedAt: iso(row.pinned_at) })),
      handoffs: handoffs.rows.map((row) => ({ runId: str(row.run_id), state: str(row.state) as ProjectBrainHandoffState, form: str(row.form), version: Number(row.version), updatedAt: iso(row.updated_at) })),
      evals: evals.rows.map(evalRowOf),
    };
  }

  /** The components of one project in their own REPEATABLE READ snapshot. */
  async read(projectId: string, runId: string | null = null): Promise<ProjectBrainComponentRows | null> {
    const { client, release } = await checkout(this.pool);
    let broken: Error | undefined;
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (!(await projectBrainSchema(client)).componentsInstalled) throw new Error('project_brain_components_not_installed');
      const exists = await client.query('SELECT 1 FROM relay_wonderland.projects WHERE project_id=$1', [projectId]);
      if (exists.rowCount === 0) { await client.query('ROLLBACK'); return null; }
      const rows = await ProjectBrainComponentStore.readWithin(client, projectId, runId);
      await client.query('COMMIT');
      return rows;
    } catch (error) {
      broken = error instanceof Error ? error : new Error(String(error));
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      release(broken);
    }
  }

  /**
   * THE CARD A RUN RAN UNDER, as it was then: its pin and the exact content of that version. Null when the run was never
   * pinned. A pinned card deleted later still resolves, because deletion is a version, never an erased row.
   */
  async pinnedCard(projectId: string, runId: string): Promise<{ readonly revision: string; readonly content: ProjectBrainCardContent; readonly contentHash: string } | null> {
    if (!(await projectBrainSchema(this.pool)).componentsInstalled) throw new Error('project_brain_components_not_installed');
    const pin = await this.pool.query<Row>('SELECT card_ref,card_version,content_hash FROM relay_wonderland.project_brain_mission_cards WHERE project_id=$1 AND run_id=$2', [projectId, runId]);
    const row = pin.rows[0];
    if (row === undefined) return null;
    const cardRef = str(row.card_ref);
    const version = Number(row.card_version);
    const content = cardRef === PROJECT_BRAIN_CARD_DEFAULT_REF ? PROJECT_BRAIN_DEFAULT_CARD
      : (await this.pool.query<Row>('SELECT content FROM relay_wonderland.project_brain_card_versions WHERE card_id=$1 AND project_id=$2 AND version=$3', [cardRef, projectId, version])).rows[0]?.content as ProjectBrainCardContent | undefined;
    if (content === undefined || projectBrainCardContentHash(content) !== str(row.content_hash)) {
      throw new ProjectBrainCorruptionError('project_brain_mission_cards', runId, 'the pinned card version does not resolve to the content its pin hashed');
    }
    return { revision: projectBrainCardRevision(cardRef, version), content, contentHash: str(row.content_hash) };
  }

  /* -------------------------------------------------------------- mutation */

  async mutateComponent(input: {
    readonly projectId: string;
    readonly provenance: ProjectBrainProvenance;
    readonly capabilities: readonly ProjectBrainCapability[];
    readonly command: ProjectBrainComponentCommand;
  }): Promise<ProjectBrainComponentOutcome> {
    const { projectId, provenance } = input;
    const refuse = (refusal: ProjectBrainRefusal, details?: Record<string, unknown>): ProjectBrainComponentOutcome =>
      ({ ...refusal, durable: false, ...(details === undefined ? {} : { details }) });
    // THE STORE VALIDATES WHAT IT STORES, whoever calls it. The doors parse first, but a caller inside the process (the
    // runtime) can hand over a command it built; every one is parsed again here, so a credential, an unknown field or a
    // malformed reference is refused before a connection is even taken -- never stored because a caller skipped a step.
    const reparsed = parseProjectBrainComponentMutation(input.command);
    if (!reparsed.ok) return refuse(reparsed);
    const command = reparsed.command;
    let client: PoolClient;
    let release: (error?: Error) => void;
    try {
      ({ client, release } = await checkout(this.pool));
    } catch {
      return refuse(projectBrainRefusal(503, 'project_brain_unavailable', 'The Project Brain database could not be reached. Nothing was saved.'));
    }
    let phase: 'open' | 'commit' | 'done' = 'open';
    let broken: Error | undefined;
    const abort = async (outcome: ProjectBrainComponentOutcome): Promise<ProjectBrainComponentOutcome> => {
      await client.query('ROLLBACK').catch(() => undefined);
      phase = 'done';
      return outcome;
    };
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`project_brain:${projectId}`]);
      const project = await client.query('SELECT 1 FROM relay_wonderland.projects WHERE project_id=$1', [projectId]);
      if (project.rowCount === 0) return abort(refuse(projectBrainRefusal(404, 'project_not_found', 'No such project.')));
      // A store without migration 034 has no components: say so by name, never as a generic failure. A store NEWER than
      // this build is refused before anything is read (project-brain-pg-shared.ts).
      if (!(await projectBrainSchema(client)).componentsInstalled) {
        return abort(refuse(projectBrainRefusal(503, 'project_brain_components_not_installed',
          'This Project Brain store has no C.A.R.D./handoff/eval components (migration 034 is not applied). Nothing was saved.')));
      }

      const requestHash = sha256(projectBrainCanonicalJson({ projectId, provenance, command }));
      const prior = await client.query<{ request_hash: string; result: unknown }>(
        'SELECT request_hash,result FROM relay_wonderland.project_brain_mutations WHERE project_id=$1 AND idempotency_key=$2', [projectId, command.idempotencyKey]);
      if (prior.rows[0] !== undefined) {
        if (prior.rows[0].request_hash !== requestHash) {
          return abort(refuse(projectBrainRefusal(409, 'idempotency_conflict',
            'That idempotency key was already used for a different change. Nothing was saved; use a new key for a new change.')));
        }
        // A replay answers with the STORED result: one that is not an object is corruption, refused by name (PB-F5).
        const stored = prior.rows[0].result;
        if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
          throw new ProjectBrainCorruptionError('project_brain_mutations', command.idempotencyKey, 'result is not an object');
        }
        await client.query('ROLLBACK');
        phase = 'done';
        return { ok: true, durable: true, replayed: true, result: stored as ProjectBrainComponentResult };
      }

      const occurredAt = this.now().toISOString();
      const mutationId = `pbm:${this.newId()}`;
      const eventId = `project-brain:${this.newId()}`;
      const streamId = projectBrainStreamId(projectId);
      const eventType = projectBrainComponentEventType(command.operation);
      const ctx: ApplyContext = { client, projectId, provenance, capabilities: input.capabilities, mutationId, occurredAt, newId: this.newId };
      const applied = await applyComponent(ctx, command);
      if (!applied.ok) return abort(refuse(applied.refusal, applied.details));

      const allocated = await client.query<{ sequence: string }>(
        `INSERT INTO relay_wonderland.stream_sequences(stream_id,next_sequence) VALUES($1,2)
         ON CONFLICT(stream_id) DO UPDATE SET next_sequence=relay_wonderland.stream_sequences.next_sequence+1 RETURNING next_sequence-1 AS sequence`, [streamId]);
      const sequence = Number(allocated.rows[0]?.sequence);
      const result: ProjectBrainComponentResult = {
        schemaVersion: PROJECT_BRAIN_MUTATION_SCHEMA_V1, mutationId, operation: command.operation, projectId, runId: applied.runId,
        componentRef: applied.componentRef, version: applied.version, state: applied.state, eventId, eventType, streamId, sequence, occurredAt,
        author: provenance.author, deliverer: provenance.deliverer, alsoChanged: applied.alsoChanged,
      };
      await client.query(
        `INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at) VALUES($1,$2,$3,$4,$5,'PROJECT',$6::jsonb,$7)`,
        [eventId, streamId, projectId, sequence, eventType, JSON.stringify({
          schemaVersion: PROJECT_BRAIN_EVENT_SCHEMA_V1, projectId, type: eventType, mutationId, runId: applied.runId,
          recordRef: applied.componentRef, version: applied.version, status: applied.state,
          author: provenance.author, deliverer: { kind: provenance.deliverer.kind }, occurredAt,
        }), occurredAt]);
      await client.query(
        `INSERT INTO relay_wonderland.project_brain_mutations(mutation_id,project_id,idempotency_key,request_hash,operation,record_id,resulting_version,run_id,
           author_kind,author_id,deliverer_kind,deliverer_id,event_id,result,occurred_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`,
        [mutationId, projectId, command.idempotencyKey, requestHash, command.operation, applied.componentRef, applied.version, applied.runId,
          provenance.author.kind, provenance.author.id, provenance.deliverer.kind, provenance.deliverer.id, eventId, JSON.stringify(result), occurredAt]);
      // Every component row named this mutation by a DEFERRED foreign key (migration 034): check them NOW, before COMMIT,
      // so a broken reference is 'nothing saved' and never an unknown commit.
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');

      phase = 'commit';
      await client.query('COMMIT');
      phase = 'done';
      return { ok: true, durable: true, replayed: false, result };
    } catch (error) {
      broken = error instanceof Error ? error : new Error(String(error));
      if (phase === 'commit') {
        return {
          ...projectBrainRefusal(503, 'project_brain_commit_unknown',
            'The database did not confirm the change. It may or may not be saved; retrying with the same idempotency key is safe.'),
          durable: 'unknown',
        };
      }
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof ProjectBrainCorruptionError) {
        // A stored row that does not hash to what it says is never changed further: fail closed and say which.
        return refuse(projectBrainRefusal(500, 'project_brain_corrupt', `${error.message}. Nothing was saved.`));
      }
      if (error instanceof ProjectBrainSchemaNewerError) {
        return refuse(projectBrainRefusal(503, 'project_brain_schema_newer', `${error.message}. This build cannot write it; nothing was saved.`));
      }
      if (codeOf(error) === '23505') {
        return refuse(projectBrainRefusal(409, 'idempotency_conflict', 'A concurrent change used the same key. Nothing was saved; read again and retry.'));
      }
      return refuse(projectBrainRefusal(503, 'project_brain_persistence_failed', 'The Project Brain could not save this change. Nothing was saved.'));
    } finally {
      release(broken);
    }
  }
}

/* ------------------------------------------------------------------ apply */

interface ApplyContext {
  readonly client: PoolClient;
  readonly projectId: string;
  readonly provenance: ProjectBrainProvenance;
  readonly capabilities: readonly ProjectBrainCapability[];
  readonly mutationId: string;
  readonly occurredAt: string;
  readonly newId: () => string;
}
type Applied =
  | { readonly ok: true; readonly componentRef: string; readonly version: number | null; readonly state: string | null; readonly runId: string | null; readonly alsoChanged: readonly string[] }
  | { readonly ok: false; readonly refusal: ProjectBrainRefusal; readonly details?: Record<string, unknown> };
const no = (refusal: ProjectBrainRefusal, details?: Record<string, unknown>): Applied => ({ ok: false, refusal, ...(details === undefined ? {} : { details }) });

async function authorize(ctx: ApplyContext, command: ProjectBrainComponentCommand, cardAuthor?: { kind: string; id: string } | null): Promise<ProjectBrainRefusal | null> {
  const verdict = authorizeProjectBrainComponentMutation({ provenance: ctx.provenance, capabilities: ctx.capabilities, command, cardAuthor });
  return verdict.ok ? null : verdict;
}

/** The run, in THIS project, or null. Read only: a component never writes a run. */
async function runIn(ctx: ApplyContext, runId: string): Promise<{ readonly state: string } | null> {
  const found = await ctx.client.query<Row>('SELECT state FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2', [runId, ctx.projectId]);
  return found.rows[0] === undefined ? null : { state: str(found.rows[0].state) };
}

/** One immutable card version: what the card said at that version, and who changed it. */
async function cardVersion(ctx: ApplyContext, cardId: string, version: number, state: ProjectBrainCardState, content: ProjectBrainCardContent, hash: string): Promise<void> {
  const { client, projectId, provenance, mutationId, occurredAt } = ctx;
  await client.query(
    `INSERT INTO relay_wonderland.project_brain_card_versions(card_id,project_id,version,mutation_id,state,name,content,content_hash,author_kind,author_id,deliverer_kind,deliverer_id,recorded_at)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13)`,
    [cardId, projectId, version, mutationId, state, content.name, JSON.stringify(content), hash,
      provenance.author.kind, provenance.author.id, provenance.deliverer.kind, provenance.deliverer.id, occurredAt]);
}

async function applyComponent(ctx: ApplyContext, command: ProjectBrainComponentCommand): Promise<Applied> {
  const { client, projectId, provenance, mutationId, occurredAt } = ctx;
  switch (command.operation) {
    case 'CARD_CREATE': {
      const refused = await authorize(ctx, command);
      if (refused !== null) return no(refused);
      const cardId = `pbcard:${ctx.newId()}`;
      const hash = projectBrainCardContentHash(command.card);
      await client.query(
        `INSERT INTO relay_wonderland.project_brain_cards(card_id,project_id,state,name,content,content_hash,version,author_kind,author_id,deliverer_kind,deliverer_id,created_at,updated_at,last_mutation_id)
         VALUES($1,$2,'LIVE',$3,$4::jsonb,$5,1,$6,$7,$8,$9,$10,$10,$11)`,
        [cardId, projectId, command.card.name, JSON.stringify(command.card), hash,
          provenance.author.kind, provenance.author.id, provenance.deliverer.kind, provenance.deliverer.id, occurredAt, mutationId]);
      await cardVersion(ctx, cardId, 1, 'LIVE', command.card, hash);
      return { ok: true, componentRef: cardId, version: 1, state: 'LIVE', runId: null, alsoChanged: [] };
    }
    case 'CARD_UPDATE':
    case 'CARD_DELETE': {
      const found = await client.query<Row>('SELECT * FROM relay_wonderland.project_brain_cards WHERE card_id=$1 AND project_id=$2 FOR UPDATE', [command.cardId, projectId]);
      const row = found.rows[0];
      const refusedFirst = await authorize(ctx, command, row === undefined ? null : { kind: str(row.author_kind), id: str(row.author_id) });
      if (row === undefined) return no(projectBrainRefusal(404, 'card_not_found', 'No such card in this project.'));
      const card = cardRowOf(row);
      if (card.state === 'DELETED') return no(projectBrainRefusal(409, 'card_deleted', 'That card was deleted; a deleted card does not change.'));
      if (card.version !== command.expectedVersion) {
        return no(projectBrainRefusal(409, 'version_conflict', `The card is at version ${card.version}, not ${command.expectedVersion}. Read it again and decide; nothing was overwritten.`),
          { currentVersion: card.version });
      }
      if (refusedFirst !== null) return no(refusedFirst);
      const next = card.version + 1;
      const content = command.operation === 'CARD_UPDATE' ? command.card : card.content;
      const hash = projectBrainCardContentHash(content);
      if (command.operation === 'CARD_UPDATE' && hash === card.contentHash) {
        return no(projectBrainRefusal(422, 'revision_empty', 'That change says what the card already says; nothing was saved.'));
      }
      const state: ProjectBrainCardState = command.operation === 'CARD_DELETE' ? 'DELETED' : 'LIVE';
      const updated = await client.query(
        `UPDATE relay_wonderland.project_brain_cards SET state=$3,name=$4,content=$5::jsonb,content_hash=$6,version=$7,deliverer_kind=$8,deliverer_id=$9,updated_at=$10,last_mutation_id=$11
          WHERE card_id=$1 AND project_id=$2 AND version=$12`,
        [card.cardId, projectId, state, content.name, JSON.stringify(content), hash, next, provenance.deliverer.kind, provenance.deliverer.id, occurredAt, mutationId, card.version]);
      if (updated.rowCount !== 1) return no(projectBrainRefusal(409, 'version_conflict', 'The card changed while this change was applied; nothing was overwritten.'));
      await cardVersion(ctx, card.cardId, next, state, content, hash);
      const alsoChanged: string[] = [];
      if (state === 'DELETED') {
        // Deleting the selected card makes the built-in default the next mission's card, in the same transaction.
        const selected = await client.query<Row>('SELECT version FROM relay_wonderland.project_brain_card_selection WHERE project_id=$1 AND card_ref=$2 FOR UPDATE', [projectId, card.cardId]);
        if (selected.rows[0] !== undefined) {
          await client.query('UPDATE relay_wonderland.project_brain_card_selection SET card_ref=$2,version=version+1,updated_at=$3,last_mutation_id=$4 WHERE project_id=$1',
            [projectId, PROJECT_BRAIN_CARD_DEFAULT_REF, occurredAt, mutationId]);
          alsoChanged.push(`selection:${PROJECT_BRAIN_CARD_DEFAULT_REF}`);
        }
      }
      return { ok: true, componentRef: card.cardId, version: next, state, runId: null, alsoChanged };
    }
    case 'CARD_SELECT': {
      const refused = await authorize(ctx, command);
      if (refused !== null) return no(refused);
      if (command.cardRef !== PROJECT_BRAIN_CARD_DEFAULT_REF) {
        const card = await client.query<Row>('SELECT state FROM relay_wonderland.project_brain_cards WHERE card_id=$1 AND project_id=$2', [command.cardRef, projectId]);
        if (card.rows[0] === undefined) return no(projectBrainRefusal(404, 'card_not_found', 'No such card in this project.'));
        if (str(card.rows[0].state) !== 'LIVE') return no(projectBrainRefusal(409, 'card_deleted', 'That card was deleted and cannot be selected.'));
      }
      const current = await client.query<Row>('SELECT card_ref,version FROM relay_wonderland.project_brain_card_selection WHERE project_id=$1 FOR UPDATE', [projectId]);
      const currentVersion = current.rows[0] === undefined ? 0 : Number(current.rows[0].version);
      if (currentVersion !== command.expectedSelectionVersion) {
        return no(projectBrainRefusal(409, 'version_conflict', `The selection is at version ${currentVersion}, not ${command.expectedSelectionVersion}. Read it again; nothing was overwritten.`),
          { currentVersion });
      }
      if (current.rows[0] === undefined) {
        await client.query('INSERT INTO relay_wonderland.project_brain_card_selection(project_id,card_ref,version,updated_at,last_mutation_id) VALUES($1,$2,1,$3,$4)',
          [projectId, command.cardRef, occurredAt, mutationId]);
      } else {
        await client.query('UPDATE relay_wonderland.project_brain_card_selection SET card_ref=$2,version=$3,updated_at=$4,last_mutation_id=$5 WHERE project_id=$1 AND version=$6',
          [projectId, command.cardRef, currentVersion + 1, occurredAt, mutationId, currentVersion]);
      }
      return { ok: true, componentRef: command.cardRef, version: currentVersion + 1, state: 'SELECTED', runId: null, alsoChanged: [] };
    }
    case 'MISSION_PIN_CARD': {
      const refused = await authorize(ctx, command);
      if (refused !== null) return no(refused);
      if ((await runIn(ctx, command.runId)) === null) return no(projectBrainRefusal(404, 'run_not_found', 'No such mission in this project.'));
      const existing = await client.query<Row>('SELECT card_ref,card_version FROM relay_wonderland.project_brain_mission_cards WHERE run_id=$1', [command.runId]);
      if (existing.rows[0] !== undefined) {
        const pinned = projectBrainCardRevision(str(existing.rows[0].card_ref), Number(existing.rows[0].card_version));
        return no(projectBrainRefusal(409, 'already_pinned', `The mission is already pinned to ${pinned}; a running mission's card never moves.`), { pinned });
      }
      const selection = await client.query<Row>('SELECT card_ref FROM relay_wonderland.project_brain_card_selection WHERE project_id=$1', [projectId]);
      const cardRef = selection.rows[0] === undefined ? PROJECT_BRAIN_CARD_DEFAULT_REF : str(selection.rows[0].card_ref);
      let version = 1;
      let hash = projectBrainCardContentHash(PROJECT_BRAIN_DEFAULT_CARD);
      if (cardRef !== PROJECT_BRAIN_CARD_DEFAULT_REF) {
        const card = await client.query<Row>('SELECT * FROM relay_wonderland.project_brain_cards WHERE card_id=$1 AND project_id=$2 FOR SHARE', [cardRef, projectId]);
        if (card.rows[0] === undefined) return no(projectBrainRefusal(409, 'selection_invalid', 'The selected card does not exist; select a card again.'));
        const row = cardRowOf(card.rows[0]);
        if (row.state !== 'LIVE') return no(projectBrainRefusal(409, 'selection_invalid', 'The selected card was deleted; select a card again.'));
        version = row.version;
        hash = row.contentHash;
      }
      await client.query('INSERT INTO relay_wonderland.project_brain_mission_cards(run_id,project_id,card_ref,card_version,content_hash,mutation_id,pinned_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [command.runId, projectId, cardRef, version, hash, mutationId, occurredAt]);
      return { ok: true, componentRef: `mission:${command.runId}`, version: null, state: projectBrainCardRevision(cardRef, version), runId: command.runId, alsoChanged: [] };
    }
    case 'HANDOFF_ENTER':
    case 'HANDOFF_EXIT': {
      const refused = await authorize(ctx, command);
      if (refused !== null) return no(refused);
      const run = await runIn(ctx, command.runId);
      if (run === null) return no(projectBrainRefusal(404, 'run_not_found', 'No such mission in this project.'));
      const current = await client.query<Row>('SELECT state,form,version FROM relay_wonderland.project_brain_handoffs WHERE run_id=$1 AND project_id=$2 FOR UPDATE', [command.runId, projectId]);
      const held = current.rows[0];
      const currentVersion = held === undefined ? 0 : Number(held.version);
      if (currentVersion !== command.expectedVersion) {
        return no(projectBrainRefusal(409, 'version_conflict', `The handoff is at version ${currentVersion}, not ${command.expectedVersion}. A stale /handoff changes nothing.`),
          { currentVersion });
      }
      const move = projectBrainHandoffMove({ operation: command.operation, current: held === undefined ? null : str(held.state) as ProjectBrainHandoffState, runState: run.state });
      if (!move.ok) return no(move);
      // The form is the one the mission's pinned card names; a mission never pinned hands off with the default's.
      const pin = await client.query<Row>(
        `SELECT p.card_ref, v.content->>'missionHandoff' AS form FROM relay_wonderland.project_brain_mission_cards p
           LEFT JOIN relay_wonderland.project_brain_card_versions v ON v.card_id=p.card_ref AND v.version=p.card_version
          WHERE p.run_id=$1`, [command.runId]);
      const form = held !== undefined ? str(held.form)
        : pin.rows[0] === undefined || str(pin.rows[0].card_ref) === PROJECT_BRAIN_CARD_DEFAULT_REF || pin.rows[0].form === null
          ? PROJECT_BRAIN_DEFAULT_CARD.missionHandoff : str(pin.rows[0].form);
      const next = currentVersion + 1;
      if (held === undefined) {
        await client.query('INSERT INTO relay_wonderland.project_brain_handoffs(run_id,project_id,state,form,version,updated_at,last_mutation_id) VALUES($1,$2,$3,$4,1,$5,$6)',
          [command.runId, projectId, move.next, form, occurredAt, mutationId]);
      } else {
        await client.query('UPDATE relay_wonderland.project_brain_handoffs SET state=$3,version=$4,updated_at=$5,last_mutation_id=$6 WHERE run_id=$1 AND project_id=$2 AND version=$7',
          [command.runId, projectId, move.next, next, occurredAt, mutationId, currentVersion]);
      }
      await client.query(
        `INSERT INTO relay_wonderland.project_brain_handoff_versions(run_id,project_id,version,mutation_id,state,form,author_kind,author_id,deliverer_kind,deliverer_id,recorded_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [command.runId, projectId, next, mutationId, move.next, form, provenance.author.kind, provenance.author.id, provenance.deliverer.kind, provenance.deliverer.id, occurredAt]);
      return { ok: true, componentRef: `mission:${command.runId}`, version: next, state: move.next, runId: command.runId, alsoChanged: [] };
    }
    case 'EVAL_RECORD': {
      const refused = await authorize(ctx, command);
      if (refused !== null) return no(refused);
      if (command.runId !== null && (await runIn(ctx, command.runId)) === null) return no(projectBrainRefusal(404, 'run_not_found', 'No such mission in this project.'));
      if (!(await resolveProjectBrainRef(client, projectId, command.subjectRef))) {
        return no(projectBrainRefusal(404, 'ref_not_found', `${command.subjectRef} does not name anything in this project.`));
      }
      for (const ref of command.evidenceRefs) {
        if (!(await resolveProjectBrainRef(client, projectId, ref))) return no(projectBrainRefusal(404, 'ref_not_found', `${ref} does not name anything in this project.`));
        if (command.runId !== null && !(await evidenceInRun(client, ref, command.runId))) {
          // An eval of one mission rests on that mission's evidence; another run's evidence cannot qualify it.
          return no(projectBrainRefusal(422, 'evidence_from_another_run', `${ref} is not evidence of ${command.runId}: it belongs to another mission, to the whole project, or to no mission.`));
        }
      }
      const evalId = `pbeval:${ctx.newId()}`;
      const alsoChanged: string[] = [];
      const current = await client.query<Row>(
        "SELECT eval_id,version FROM relay_wonderland.project_brain_evals WHERE project_id=$1 AND subject_ref=$2 AND criterion=$3 AND status='CURRENT' FOR UPDATE",
        [projectId, command.subjectRef, command.criterion]);
      for (const old of current.rows) {
        const oldVersion = Number(old.version);
        await client.query("UPDATE relay_wonderland.project_brain_evals SET status='SUPERSEDED',superseded_by=$2,version=$3,updated_at=$4,last_mutation_id=$5 WHERE eval_id=$1 AND version=$6",
          [str(old.eval_id), evalId, oldVersion + 1, occurredAt, mutationId, oldVersion]);
        await evalVersion(ctx, str(old.eval_id), oldVersion + 1, 'SUPERSEDED', evalId);
        alsoChanged.push(`superseded:${str(old.eval_id)}`);
      }
      await client.query(
        `INSERT INTO relay_wonderland.project_brain_evals(eval_id,project_id,run_id,subject_ref,subject_revision,criterion,result,evidence_refs,status,superseded_by,version,
           evaluator_kind,evaluator_id,deliverer_kind,deliverer_id,recorded_at,updated_at,last_mutation_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'CURRENT',NULL,1,$9,$10,$11,$12,$13,$13,$14)`,
        [evalId, projectId, command.runId, command.subjectRef, command.subjectRevision, command.criterion, command.result, JSON.stringify(command.evidenceRefs),
          provenance.author.kind, provenance.author.id, provenance.deliverer.kind, provenance.deliverer.id, occurredAt, mutationId]);
      await evalVersion(ctx, evalId, 1, 'CURRENT', null);
      return { ok: true, componentRef: evalId, version: 1, state: 'CURRENT', runId: command.runId, alsoChanged };
    }
    case 'EVAL_INVALIDATE': {
      const refused = await authorize(ctx, command);
      if (refused !== null) return no(refused);
      const found = await client.query<Row>('SELECT eval_id,status,version,run_id FROM relay_wonderland.project_brain_evals WHERE eval_id=$1 AND project_id=$2 FOR UPDATE', [command.evalId, projectId]);
      const row = found.rows[0];
      if (row === undefined) return no(projectBrainRefusal(404, 'eval_not_found', 'No such eval in this project.'));
      const version = Number(row.version);
      if (version !== command.expectedVersion) {
        return no(projectBrainRefusal(409, 'version_conflict', `The eval is at version ${version}, not ${command.expectedVersion}. Read it again; nothing was overwritten.`), { currentVersion: version });
      }
      if (str(row.status) !== 'CURRENT') return no(projectBrainRefusal(409, 'eval_not_current', `The eval is ${str(row.status)}; only a CURRENT eval is invalidated.`));
      await client.query("UPDATE relay_wonderland.project_brain_evals SET status='INVALIDATED',version=$2,updated_at=$3,last_mutation_id=$4 WHERE eval_id=$1 AND version=$5",
        [command.evalId, version + 1, occurredAt, mutationId, version]);
      await evalVersion(ctx, command.evalId, version + 1, 'INVALIDATED', null);
      return { ok: true, componentRef: command.evalId, version: version + 1, state: 'INVALIDATED', runId: strOrNull(row.run_id), alsoChanged: [] };
    }
    default:
      return no(projectBrainRefusal(422, 'operation_invalid', 'operation is not a Project Brain component operation.'));
  }
}

async function evalVersion(ctx: ApplyContext, evalId: string, version: number, status: ProjectBrainEvalStatus, supersededBy: string | null): Promise<void> {
  const { client, projectId, provenance, mutationId, occurredAt } = ctx;
  await client.query(
    `INSERT INTO relay_wonderland.project_brain_eval_versions(eval_id,project_id,version,mutation_id,status,superseded_by,author_kind,author_id,deliverer_kind,deliverer_id,recorded_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [evalId, projectId, version, mutationId, status, supersededBy, provenance.author.kind, provenance.author.id, provenance.deliverer.kind, provenance.deliverer.id, occurredAt]);
}

/** Whether a reference that belongs to a run belongs to THIS run. References with no run (records, artifacts' projects) pass. */
/** Every ref type an eval may cite, and where its run is held. The Project Brain's own rows keep the whole ref as their id. */
export const EVIDENCE_RUN: Readonly<Record<string, readonly [table: string, column: string, wholeRef: boolean]>> = {
  evidence: ['julius_evidence', 'evidence_id', false], finding: ['julius_reviewer_findings', 'finding_id', false],
  decision: ['julius_verification_decisions', 'decision_id', false], task: ['julius_tasks', 'task_id', false],
  artifact: ['julius_work_artifacts', 'artifact_id', false], repair: ['julius_repair_cycles', 'repair_id', false],
  transition: ['julius_transitions', 'transition_id', false], approval: ['julius_approvals', 'approval_id', false],
  trajectory: ['julius_trajectory_events', 'trajectory_event_id', false], entry: ['julius_brain_entries', 'entry_id', false],
  claim: ['julius_claim_standings', 'claim_id', false], pbr: ['project_brain_records', 'record_id', true], pbeval: ['project_brain_evals', 'eval_id', true],
};

/**
 * Whether a ref is evidence OF this mission. Fail closed: a ref whose type carries no run (an event, a card) cannot
 * show what this mission did, and a project-scoped record is not this mission's work, so neither qualifies a mission eval.
 */
async function evidenceInRun(client: PoolClient, ref: string, runId: string): Promise<boolean> {
  const colon = ref.indexOf(':');
  const type = ref.slice(0, colon);
  const id = ref.slice(colon + 1);
  if (type === 'mission') return id === runId;
  if (type === 'criterion') return id.startsWith(`${runId}/`);
  if (type === 'contract') {
    const at = id.lastIndexOf('@');
    const found = await client.query('SELECT 1 FROM relay_wonderland.julius_task_contracts WHERE contract_id=$1 AND contract_revision=$2 AND run_id=$3',
      [id.slice(0, at), Number(id.slice(at + 1)), runId]);
    return (found.rowCount ?? 0) > 0;
  }
  const target = EVIDENCE_RUN[type];
  if (target === undefined) return false;
  const found = await client.query(`SELECT 1 FROM relay_wonderland.${target[0]} WHERE ${target[1]}=$1 AND run_id=$2`, [target[2] ? ref : id, runId]);
  return (found.rowCount ?? 0) > 0;
}
