import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCronScheduleStore, type CronScheduleStore } from './cron-schedule-node';
import type { CronContractVersion } from '../mission/loop/cron/cron-versioning';

/**
 * THE SCHEDULE STORE, on real disk.
 *
 * What is tested is the property the whole design rests on: THE JOURNAL IS
 * THE AUTHORITY. A snapshot may be stale, absent or wrong, and a read must
 * still produce the truth — because the alternative is a schedule that
 * reports a version its own history never recorded.
 */

const v = (over: Partial<CronContractVersion> = {}): CronContractVersion => ({
  version: 1,
  cronExpression: '0 9 * * 1-5',
  timeZone: 'America/Los_Angeles',
  contractRef: 'contract-ref-1',
  contractBindingDigest: 'digest-1',
  projectId: 'prj_cron',
  workspaceId: null,
  loopId: 'lpe_cron',
  authoredBy: 'founder',
  authoredAt: '2026-08-01T10:00:00.000Z',
  ...over,
});

const edit = (over: Partial<Omit<CronContractVersion, 'version'>> = {}) => {
  const { version: _ignored, ...rest } = v();
  return { ...rest, cronExpression: '0 7 * * 1-5', authoredAt: '2026-08-06T12:00:00.000Z', ...over };
};

let root: string;
let store: CronScheduleStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'relay-cron-store-'));
  store = createCronScheduleStore({ root });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const journalPath = (id: string) => join(root, 'cron-schedules', id, 'versions.ndjson');
const snapshotPath = (id: string) => join(root, 'cron-schedules', id, 'snapshot.json');

describe('a schedule is created, read back and listed', () => {
  it('creates with its first version and reads it back from the journal', () => {
    const created = store.create('daily-triage', v());
    expect(created.ok).toBe(true);
    const record = store.read('daily-triage');
    expect(record?.history).toHaveLength(1);
    expect(record?.history[0]?.cronExpression).toBe('0 9 * * 1-5');
    expect(record?.paused).toBe(false);
  });

  it('refuses to create over an existing schedule', () => {
    store.create('daily-triage', v());
    const again = store.create('daily-triage', v({ cronExpression: '0 3 * * *' }));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.problem).toContain('already exists');
    // …and the original history is untouched.
    expect(store.read('daily-triage')?.history[0]?.cronExpression).toBe('0 9 * * 1-5');
  });

  it('lists schedules, sorted, and answers null for one that does not exist', () => {
    store.create('b-schedule', v());
    store.create('a-schedule', v());
    expect(store.list()).toEqual(['a-schedule', 'b-schedule']);
    expect(store.read('missing')).toBeNull();
  });

  it('refuses a path-shaped id rather than touching disk with it', () => {
    const created = store.create('../escape', v());
    expect(created.ok).toBe(false);
    // The old assertion here was vacuous: `../escape` targets root/escape,
    // which list() never reads. Check the filesystem instead.
    expect(existsSync(join(root, 'escape'))).toBe(false);
    expect(existsSync(join(root, 'cron-schedules', '..', 'escape'))).toBe(false);
  });

  it('refuses a SYMLINKED schedule directory — a regex on the id is not containment', () => {
    // Review wrote exactly this and watched a journal land outside the state
    // root. Mutation check: dropping the realpath containment check writes
    // versions.ndjson into `outside`.
    const outside = mkdtempSync(join(tmpdir(), 'relay-outside-'));
    try {
      mkdirSync(join(root, 'cron-schedules'), { recursive: true });
      symlinkSync(outside, join(root, 'cron-schedules', 'leak'));
      const created = store.create('leak', v());
      expect(created.ok).toBe(false);
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a first version that nobody authored, exactly as an edit is refused', () => {
    const created = store.create('s', v({ authoredBy: '  ' }));
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.problem).toContain('who authored it');
  });

  it('refuses a version with an empty contract or schedule field', () => {
    // The route used to require contractRef and contractBindingDigest; now
    // they come from here, so this is where they must be real. Review found a
    // version storable with an empty contractRef flowing into run bindings.
    for (const field of [
      'cronExpression', 'timeZone', 'contractRef', 'contractBindingDigest',
      // The BINDING keys the occurrence claim, so a blank one attributes a run
      // to nowhere while durably consuming the occurrence.
      'projectId', 'loopId',
    ] as const) {
      const created = store.create(`s-${field}`, v({ [field]: '  ' }));
      expect(created.ok, field).toBe(false);
      if (!created.ok) expect(created.problem).toContain(field);
    }
    // Absent is `null`; a blank string is not a way to say a schedule has no
    // workspace, and neither is leaving the field off.
    for (const workspaceId of ['  ', undefined as unknown as string]) {
      const created = store.create('s-workspace', v({ workspaceId }));
      expect(created.ok).toBe(false);
      if (!created.ok) expect(created.problem).toContain('workspaceId');
    }
    expect(store.create('s-null-workspace', v({ workspaceId: null })).ok).toBe(true);
  });

  it('refuses a version that cannot say when it was authored', () => {
    // `authoredAt` CLAMPS the tick window, so a version that cannot state it
    // cannot state which moments it owns — the same reason the binding and the
    // expression must be real here.
    for (const authoredAt of ['', '  ', 'not-a-time', '2026-08-01T10:00:00.000']) {
      const created = store.create(`s-at-${authoredAt.length}`, v({ authoredAt }));
      expect(created.ok, authoredAt).toBe(false);
      if (!created.ok) expect(created.problem).toContain('authoredAt');
    }
  });

  it('a version line that records no version object is CORRUPT, never a crash', () => {
    // `.version` was read off whatever the line carried, so a null threw out of
    // `inspect` — a crash where the store's own word is `corrupt`.
    mkdirSync(join(root, 'cron-schedules', 'sched-null'), { recursive: true });
    writeFileSync(
      join(root, 'cron-schedules', 'sched-null', 'versions.ndjson'),
      `${JSON.stringify({ kind: 'version', version: null })}\n`,
    );
    const inspected = store.inspect('sched-null');
    expect(inspected.kind).toBe('corrupt');
  });

  it('an EDIT is held to the same bar as a create', () => {
    // The bar lived on the create path only, so an edit could append what a
    // create refuses — and the head is what the tick reads. Review found the
    // identical split once before, for `contractRef`.
    expect(store.create('s-edit', v()).ok).toBe(true);
    const blanked = store.edit('s-edit', {
      ...edit(), loopId: '  ', authoredAt: '2026-08-02T10:00:00.000Z',
    }, []);
    expect(blanked.ok).toBe(false);
    if (!blanked.ok) expect(blanked.problem).toContain('loopId');
    // The history is untouched: a refused edit appends nothing.
    expect(store.read('s-edit')?.history).toHaveLength(1);
  });

  it('a schedule stored before a required field existed is CORRUPT, never run as-is', () => {
    // THE DEFECT THIS PINS. A journal written by the build that shipped the
    // create route has no binding, and the binding keys the occurrence claim.
    // Replayed as `found`, such a schedule ticked with undefined attribution:
    // it marked its occurrences handled durably, created no run, and answered
    // 200 — consuming the window irreversibly while reporting success.
    const { projectId: _p, workspaceId: _w, loopId: _l, ...legacy } = v();
    mkdirSync(join(root, 'cron-schedules', 'sched-legacy'), { recursive: true });
    writeFileSync(
      join(root, 'cron-schedules', 'sched-legacy', 'versions.ndjson'),
      `${JSON.stringify({ kind: 'version', version: legacy })}\n`,
    );
    const inspected = store.inspect('sched-legacy');
    expect(inspected.kind).toBe('corrupt');
    if (inspected.kind === 'corrupt') {
      expect(inspected.problem).toContain('projectId');
      expect(inspected.problem).toContain('removed from the state root by hand');
    }
  });

  it('a DUPLICATED version is corrupt — too ambiguous to edit is too ambiguous to read', () => {
    // planScheduleEdit calls a repeated version unambiguously fatal; a
    // schedule that cannot be edited must not be tickable either.
    store.create('dup', v());
    appendFileSync(
      journalPath('dup'),
      `${JSON.stringify({ kind: 'version', version: v({ cronExpression: '0 3 * * *' }) })}\n`,
    );
    const inspected = store.inspect('dup');
    expect(inspected.kind).toBe('corrupt');
    if (inspected.kind === 'corrupt') expect(inspected.problem).toContain('more than once');
  });

  it('refuses a first version whose number is not a version', () => {
    for (const version of [-1, 1.5, Number.NaN]) {
      expect(store.create(`s${Math.abs(Math.trunc(version)) || 0}x`, v({ version })).ok, String(version))
        .toBe(false);
    }
  });
});

describe('the journal is the authority; the snapshot is a cache', () => {
  it('reads the truth when the snapshot is DELETED', () => {
    store.create('s', v());
    store.edit('s', edit(), []);
    rmSync(snapshotPath('s'));
    // Mutation check: a read that trusts the snapshot returns null here.
    expect(store.read('s')?.history).toHaveLength(2);
  });

  it('reads the truth when the snapshot LIES', () => {
    store.create('s', v());
    writeFileSync(snapshotPath('s'), JSON.stringify({
      scheduleId: 's',
      history: [v({ version: 99, cronExpression: 'LIE' })],
      paused: true,
    }));
    const record = store.read('s');
    expect(record?.history).toHaveLength(1);
    expect(record?.history[0]?.version).toBe(1);
    expect(record?.paused).toBe(false);
  });

  it('a torn final line ends the replay without discrediting the versions before it', () => {
    store.create('s', v());
    store.edit('s', edit(), []);
    appendFileSync(journalPath('s'), '{"kind":"version","versi');
    const record = store.read('s');
    expect(record?.history).toHaveLength(2);
  });

  it('a malformed INTERIOR line is corruption, never a shorter history', () => {
    // THE DEFECT REVIEW FOUND. Truncating there returned history [1], and the
    // next edit then minted a SECOND version 2 — writing the very ambiguity
    // planScheduleEdit exists to refuse. Mutation check: `break`ing on any
    // line instead of only the last fails this and the next test.
    store.create('s', v());
    store.edit('s', edit(), []);
    store.edit('s', edit({ cronExpression: '0 6 * * *' }), []);
    const lines = readFileSync(journalPath('s'), 'utf8').split('\n').filter((l) => l !== '');
    lines[1] = '{"kind":"version","tor';
    writeFileSync(journalPath('s'), `${lines.join('\n')}\n`);

    const inspected = store.inspect('s');
    expect(inspected.kind).toBe('corrupt');
    if (inspected.kind === 'corrupt') expect(inspected.problem).toContain('interior line 2');
    expect(store.read('s')).toBeNull();
  });

  it('a corrupt history refuses an edit rather than minting a duplicate version', () => {
    store.create('s', v());
    store.edit('s', edit(), []);
    store.edit('s', edit({ cronExpression: '0 6 * * *' }), []);
    const lines = readFileSync(journalPath('s'), 'utf8').split('\n').filter((l) => l !== '');
    lines[1] = 'torn';
    writeFileSync(journalPath('s'), `${lines.join('\n')}\n`);

    const result = store.edit('s', edit({ cronExpression: '0 5 * * *' }), []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain('interior line');
    // …and a paused flag after the tear is not silently read as running.
    expect(store.inspect('s').kind).toBe('corrupt');
  });

  it('a journal with no version at all is CORRUPT, not missing', () => {
    // Reachable: the file is created before the first line is written, so a
    // crash between them leaves zero bytes. Review found that id stranded —
    // list() showed it, read() said absent, create() said it existed.
    mkdirSync(join(root, 'cron-schedules', 'ghost'), { recursive: true });
    writeFileSync(journalPath('ghost'), '');
    const inspected = store.inspect('ghost');
    expect(inspected.kind).toBe('corrupt');
    if (inspected.kind === 'corrupt') expect(inspected.problem).toContain('records no version');
  });

  it('the journal is appended BEFORE the snapshot is rewritten', () => {
    store.create('s', v());
    const before = readFileSync(journalPath('s'), 'utf8');
    store.edit('s', edit(), []);
    const after = readFileSync(journalPath('s'), 'utf8');
    // The journal only ever grows, and the snapshot follows it.
    expect(after.startsWith(before)).toBe(true);
    const snapshot = JSON.parse(readFileSync(snapshotPath('s'), 'utf8'));
    expect(snapshot.history).toHaveLength(2);
  });
});

describe('an edit goes through the ONE decision', () => {
  it('appends a version and preserves the previous one', () => {
    store.create('s', v());
    const result = store.edit('s', edit(), []);
    expect(result.ok).toBe(true);
    const record = store.read('s');
    expect(record?.history.map((h) => h.version)).toEqual([1, 2]);
    expect(record?.history[0]?.cronExpression).toBe('0 9 * * 1-5');
    expect(record?.history[1]?.cronExpression).toBe('0 7 * * 1-5');
  });

  it('refuses an edit the pure decision refuses, and writes NOTHING', () => {
    // Mutation check: persisting before consulting planScheduleEdit would
    // append a version the decision rejected — two implementations of one
    // authority rule, which is the divergence this store exists not to add.
    store.create('s', v());
    const before = readFileSync(journalPath('s'), 'utf8');
    const unattributed = store.edit('s', edit({ authoredBy: '' }), []);
    expect(unattributed.ok).toBe(false);
    if (!unattributed.ok) expect(unattributed.problem).toContain('unauthored_edit');
    expect(readFileSync(journalPath('s'), 'utf8')).toBe(before);
  });

  it('refuses an edit that would orphan a run', () => {
    store.create('s', v());
    const result = store.edit('s', edit(), [
      { runId: 'lpr_ghost', contractVersion: 7, active: false },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain('run_cites_unknown_version');
  });

  it('refuses to edit a schedule that does not exist', () => {
    expect(store.edit('missing', edit(), []).ok).toBe(false);
  });
});

describe('pausing is journalled like everything else', () => {
  it('pauses and resumes, and the state survives a re-read', () => {
    store.create('s', v());
    expect(store.setPaused('s', true, '2026-08-06T12:00:00.000Z').ok).toBe(true);
    expect(store.read('s')?.paused).toBe(true);
    store.setPaused('s', false, '2026-08-06T13:00:00.000Z');
    expect(store.read('s')?.paused).toBe(false);
  });

  it('pausing never disturbs the version history', () => {
    store.create('s', v());
    store.edit('s', edit(), []);
    store.setPaused('s', true, '2026-08-06T12:00:00.000Z');
    const record = store.read('s');
    expect(record?.history.map((h) => h.version)).toEqual([1, 2]);
    expect(record?.paused).toBe(true);
  });

  it('an edit after a pause keeps it paused — in the RETURN and the snapshot, not just the replay', () => {
    // Mutation check: rebuilding the record with `paused: false` survived an
    // earlier version of this test, because the test only checked `read()` —
    // which replays the journal and so masked a returned record and a
    // snapshot that both claimed the schedule had resumed.
    store.create('s', v());
    store.setPaused('s', true, '2026-08-06T12:00:00.000Z');
    const edited = store.edit('s', edit(), []);
    expect(edited.ok).toBe(true);
    if (edited.ok) expect(edited.value.paused).toBe(true);
    expect(JSON.parse(readFileSync(snapshotPath('s'), 'utf8')).paused).toBe(true);
    expect(store.read('s')?.paused).toBe(true);
  });

  it('refuses to pause a schedule that does not exist', () => {
    expect(store.setPaused('missing', true, '2026-08-06T12:00:00.000Z').ok).toBe(false);
  });
});
