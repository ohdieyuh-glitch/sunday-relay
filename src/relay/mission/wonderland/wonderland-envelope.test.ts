import { describe, expect, it } from 'vitest';

import { JULIUS_DEFAULT_ROLES } from '../julius/julius-runtime';
import {
  WONDERLAND_CODE_METADATA_KEYS,
  WONDERLAND_ENVELOPE_FIELDS,
  WONDERLAND_ENVELOPE_SCHEMA_V1,
  WONDERLAND_ENVELOPE_VOCABULARIES,
  WONDERLAND_METADATA_MAX_ENTRIES,
  WONDERLAND_METADATA_MAX_LENGTH,
  WONDERLAND_WORKER_ROLES,
  sanitizeWonderlandMetadata,
  wonderlandEnvelope,
  wonderlandWorkerRole,
} from './wonderland-envelope';
import { WONDERLAND_CARRIED_FACT_KEYS } from './wonderland-julius-normalizer';

/**
 * THE ENVELOPE'S OWN TESTS.
 *
 * The centre of gravity is the sanitiser. Everything else here is shape; the
 * sanitiser is the thing standing between a provider's payload and a renderer,
 * and it is tested with the payloads that actually show up rather than with
 * tidy examples invented to pass.
 */

const base = {
  eventId: 'evt-1',
  projectId: 'project-1',
  state: 'coding' as const,
  stateSource: 'julius_run_state' as const,
  sequence: 4,
  occurredAt: '2026-09-07T10:00:00.000Z',
};

describe('the envelope shape', () => {
  it('is frozen, versioned and exactly as declared', () => {
    const envelope = wonderlandEnvelope(base);
    expect(envelope.schemaVersion).toBe(WONDERLAND_ENVELOPE_SCHEMA_V1);
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.keys(envelope).sort()).toEqual([...WONDERLAND_ENVELOPE_FIELDS].sort());
  });

  it('carries six identifiers, every one known or explicitly null', () => {
    const bare = wonderlandEnvelope(base);
    expect(bare.projectId).toBe('project-1');
    for (const absent of [
      bare.worldSessionId,
      bare.juliusInstanceId,
      bare.missionId,
      bare.runId,
      bare.taskId,
      bare.workerRole,
    ]) {
      expect(absent).toBeNull();
    }
  });

  it('never derives one identifier from another', () => {
    // A world that guessed which mission it was drawing would be wrong silently.
    const envelope = wonderlandEnvelope({ ...base, runId: 'run-1' });
    expect(envelope.runId).toBe('run-1');
    expect(envelope.missionId).toBeNull();
    expect(envelope.taskId).toBeNull();
  });

  it('treats an absent revision as zero, the lowest', () => {
    // So an authority that does not version its reports can never outrank one
    // that does, merely by staying silent.
    expect(wonderlandEnvelope(base).revision).toBe(0);
    expect(wonderlandEnvelope({ ...base, revision: 7 }).revision).toBe(7);
  });

  it('publishes the vocabularies a receiver has to switch on', () => {
    expect(WONDERLAND_ENVELOPE_VOCABULARIES.workerRole).toEqual(WONDERLAND_WORKER_ROLES);
    expect(WONDERLAND_ENVELOPE_VOCABULARIES.state.length).toBe(11);
  });
});

describe('the worker role', () => {
  it('derives the three permanent slots from the kernel, never re-typing them', () => {
    for (const role of JULIUS_DEFAULT_ROLES) {
      expect(WONDERLAND_WORKER_ROLES).toContain(role);
      expect(wonderlandWorkerRole(role)).toBe(role);
    }
  });

  it('collapses a specialist to the bare token, dropping its name', () => {
    // Julius names specialists freely at run time. Letting the name through
    // would put arbitrary orchestrator-chosen strings on the wire into a
    // renderer and make a specialist's name a de-facto vocabulary.
    expect(wonderlandWorkerRole('SPECIALIST:sql-tuning')).toBe('SPECIALIST');
    expect(wonderlandWorkerRole('SPECIALIST:gpt-4o-migration-helper')).toBe('SPECIALIST');
    expect(wonderlandWorkerRole('SPECIALIST')).toBe('SPECIALIST');
    expect(WONDERLAND_WORKER_ROLES).not.toContain('SPECIALIST:sql-tuning' as never);
  });

  it('answers null for anything unrecognised rather than guessing', () => {
    // A role the world does not model is an absence of information. Inventing
    // SPECIALIST for it would report a specialist that never ran.
    for (const unknown of ['', 'CODING', 'coding_agent', 'ORCHESTRATOR', null, undefined]) {
      expect(wonderlandWorkerRole(unknown)).toBeNull();
    }
  });

  it('never lets a provider name become a role', () => {
    for (const provider of ['gpt-4o', 'claude-opus', 'grok', 'hermes', 'openai', 'anthropic']) {
      expect(wonderlandWorkerRole(provider)).toBeNull();
    }
  });
});

/* -------------------------------------------------------- the sanitiser */

describe('metadata sanitising', () => {
  it('lets primitives through unchanged', () => {
    const { metadata, dropped } = sanitizeWonderlandMetadata({
      attempt: 2,
      taskType: 'build',
      repaired: true,
      reviewer: null,
    });
    expect(metadata).toEqual({ attempt: 2, taskType: 'build', repaired: true, reviewer: null });
    expect(dropped).toBe(0);
  });

  it('drops every non-primitive, which is what a provider payload is made of', () => {
    const { metadata, dropped } = sanitizeWonderlandMetadata({
      messages: [{ role: 'system', content: 'You are a helpful assistant' }],
      usage: { prompt_tokens: 812, completion_tokens: 40 },
      callback: () => undefined,
      missing: undefined,
      kept: 1,
    });
    expect(Object.keys(metadata)).toEqual(['kept']);
    expect(dropped).toBe(4);
  });

  it('drops secret-shaped keys rather than redacting them', () => {
    // A redacted value still occupies a key a renderer might display, and a
    // credential-named key reading "[redacted]" tells a viewer a credential
    // exists — more than a world has any business saying.
    const { metadata, dropped } = sanitizeWonderlandMetadata({
      apiKey: 'sk-live-aaaaaaaaaaaaaaaaaaaa',
      access_token: 'ya29.abcdefgh',
      sessionId: 'sess_abcdefghijkl',
      Authorization: 'Bearer abcdefghijklmno',
      taskId: 'task-7',
    });
    expect(Object.keys(metadata)).toEqual(['taskId']);
    expect(dropped).toBe(4);
    // Key-SHAPED, not the bare prefix: `sk-` also matches inside `task-`, which
    // is a documented trap in this repository and which `taskId` would spring.
    expect(JSON.stringify(metadata)).not.toMatch(/\bsk-[A-Za-z0-9]{8,}/);
    expect(JSON.stringify(metadata)).not.toContain('ya29.');
  });

  it('drops a secret-shaped VALUE under an innocent key, and private reasoning or a stack trace (row 12, R4)', () => {
    // The key rule above cannot see these: a provider error code that echoed a key
    // into `reasonCode` is an innocent key holding a credential. Assembled at run
    // time so no credential-shaped literal sits in this file.
    const key = ['sk', 'ant', 'api03'].join('-') + '-' + 'Zq7x'.repeat(6);
    const connection = ['postgres', '://', 'world', ':', 'hunter2hunter2', '@', 'db.internal/julius'].join('');
    const { metadata, dropped } = sanitizeWonderlandMetadata({
      reasonCode: key,
      outcome: connection,
      severity: 'thinking process: try the key',
      detail: 'Error: boom\n    at run (x.ts:1:1)',
      attempt: 2,
      kept: 'BUILD_SUBMITTED',
    });
    expect(metadata).toEqual({ attempt: 2, kept: 'BUILD_SUBMITTED' });
    expect(dropped).toBe(4);
    expect(JSON.stringify(metadata)).not.toContain(key);
  });

  it('drops a HOST PATH under any key -- a drive, a UNC share, POSIX, macOS, a file URL -- the shapes /result trims (review M3, R4)', () => {
    const { metadata, dropped } = sanitizeWonderlandMetadata({
      windows: 'C:\\Users\\founder\\work\\deploy.env',
      windowsForward: 'D:/builds/founder/out.log',
      share: '\\\\fileserver\\share\\plan.md',
      posix: '/home/founder/project/notes.md',
      macos: '/Users/founder/Library/keys.txt',
      url: 'file:///tmp/founder/trace.json',
      relative: 'src/app.ts',
      kept: 'BUILD_SUBMITTED',
    });
    // A RELATIVE path is the project's own and stays, exactly as /result keeps it.
    expect(metadata).toEqual({ relative: 'src/app.ts', kept: 'BUILD_SUBMITTED' });
    expect(dropped).toBe(6);
    expect(JSON.stringify(metadata)).not.toContain('founder');
    // Asked again and again, the same answer: a global RegExp's `test` would move its lastIndex between calls.
    for (let round = 0; round < 3; round += 1) {
      expect(sanitizeWonderlandMetadata({ p: '/home/founder/a.md', q: '/home/founder/b.md' }).dropped, `round ${round}`).toBe(2);
    }
  });

  // THE HOST ROOTS THE FIRST LIST MISSED (internal verify m2), one test per shape, each under a key that is NOT a
  // code key, so only the host-path rule can drop it.
  for (const [shape, path] of [
    ['a container working directory (Railway/Nixpacks)', '/app/m2founder/m2dir-app/server.env'],
    ['a GitHub container job', '/github/workspace/m2founder/m2dir-github/out.log'],
    ['a GitHub runner work tree', '/__w/m2founder/m2dir-w/build.log'],
    ['the Nix store', '/nix/store/m2founder-m2dir-nix/bin/run.sh'],
    ['a GitLab runner build tree', '/builds/m2founder/m2dir-builds/job.log'],
    ['macOS /Library', '/Library/m2founder/m2dir-lib/prefs.plist'],
    ['macOS /System', '/System/m2founder/m2dir-sys/kext.txt'],
    ['macOS /Applications', '/Applications/m2founder/m2dir-apps/app.cfg'],
    ['a home-relative path', '~/m2founder/m2dir-home/notes.md'],
    ['a home-relative path, Windows separators', '~\\m2founder\\m2dir-homewin\\notes.md'],
    ['a home-relative path inside prose', 'wrote ~/m2founder/m2dir-prose/notes.md today'],
  ] as const) {
    it(`drops ${shape} under any key (verify m2)`, () => {
      expect(sanitizeWonderlandMetadata({ detail: path, kept: 'BUILD_SUBMITTED' }))
        .toEqual({ metadata: { kept: 'BUILD_SUBMITTED' }, dropped: 1 });
    });
  }

  it('CONTROL: text that only LOOKS near the roots verify m2 added still crosses', () => {
    // A route, a URL, a relative path under an `apps` or `app` directory of the project's own, a MIME type, an
    // approximation, a bare root with nothing under it.
    for (const text of [
      'the /api/users route', 'see https://example.com/app/page', 'apps/web/src/app.ts', 'src/app/main.ts',
      'application/json', '~5/10 checks', 'about ~ 3 files', 'deployed to /app', 'path.to/app/x', 'v1.2/app/x',
    ]) {
      expect(sanitizeWonderlandMetadata({ detail: text }), text).toEqual({ metadata: { detail: text }, dropped: 0 });
    }
  });

  // THE WINDOWS SHAPES A UNIX-STYLE SHELL WRITES (independent review JU-348-04): Git Bash / MSYS2 name a drive as a
  // one-letter root (`/c/Users/<name>/...`, `/d/dev/...`), Cygwin as `/cygdrive/c/...`. One test per shape, each
  // under a key that is NOT a code key, so only the host-path rule can drop it.
  for (const [shape, path] of [
    ['an MSYS / Git Bash drive path', '/c/Users/ju04founder/ju04dir-c/deploy.env'],
    ['an MSYS drive path outside Users', '/d/dev/ju04founder/ju04dir-d/build.log'],
    ['an MSYS drive path, upper-case drive letter', '/C/Users/ju04founder/ju04dir-upper/notes.md'],
    ['a Cygwin drive path', '/cygdrive/c/Users/ju04founder/ju04dir-cyg/run.sh'],
    ['an MSYS drive path inside an assignment', 'HOME=/c/Users/ju04founder/ju04dir-home'],
    ['an MSYS drive path inside prose', 'cd /c/Users/ju04founder/ju04dir-prose failed'],
  ] as const) {
    it(`drops ${shape} under any key (JU-348-04)`, () => {
      expect(sanitizeWonderlandMetadata({ detail: path, kept: 'BUILD_SUBMITTED' }))
        .toEqual({ metadata: { kept: 'BUILD_SUBMITTED' }, dropped: 1 });
    });
  }

  // PINNED, not new: the other Windows shapes JU-348-04 asked about were already caught -- WSL's mount of a drive
  // by the /mnt root, the Win32 extended-length and device prefixes and WSL's own shares by the UNC pattern.
  for (const [shape, path] of [
    ['a WSL mount of a Windows drive', '/mnt/c/Users/ju04founder/ju04dir-wsl/a.txt'],
    ['a Win32 extended-length path', '\\\\?\\C:\\Users\\ju04founder\\ju04dir-long\\c.txt'],
    ['a Win32 device path', '\\\\.\\C:\\Users\\ju04founder\\ju04dir-device\\h.txt'],
    ['an extended-length UNC path', '\\\\?\\UNC\\ju04server\\share\\ju04dir-unc\\d.txt'],
    ['a WSL distribution share', '\\\\wsl$\\Ubuntu\\home\\ju04founder\\ju04dir-wsls\\f.txt'],
    ['a WSL localhost share', '\\\\wsl.localhost\\Ubuntu\\home\\ju04founder\\ju04dir-wslh\\g.txt'],
  ] as const) {
    it(`still drops ${shape} under any key (JU-348-04, caught before it)`, () => {
      expect(sanitizeWonderlandMetadata({ detail: path, kept: 'BUILD_SUBMITTED' }))
        .toEqual({ metadata: { kept: 'BUILD_SUBMITTED' }, dropped: 1 });
    });
  }

  it('CONTROL: text that only LOOKS like a one-letter drive root still crosses (JU-348-04)', () => {
    // cmd.exe's own switches (`/c` with nothing under it), a one-letter segment inside a word, a ratio, a URL, a
    // protocol-relative URL, a sed expression, the project's own relative paths through a directory named `c`, and
    // the usual slashed abbreviations.
    for (const text of [
      'cmd /c build.bat', 'rmdir /S /Q build', 'the /cmd flag', 'a/c/b', 'ratio 1/c/2',
      'see https://example.com/c/Users/page', 'load //cdn.example.com/c/lib.js', 'sed s/a/b/g',
      './c/main.c', '../c/main.c', 'src/c/main.c', 'and/or', 'I/O', 'w/o', 'km/h',
    ]) {
      expect(sanitizeWonderlandMetadata({ detail: text }), text).toEqual({ metadata: { detail: text }, dropped: 0 });
    }
  });

  it('the CODE keys -- reasonCode, severity, outcome -- carry a code or nothing, and a drop is counted (review M3, R4)', () => {
    // A code: the human gate's shape, in either case (the kernel writes EVIDENCE_FAILED and checkpoint_identity_required).
    for (const code of ['PLAN_ACCEPTED', 'checkpoint_identity_required', 'HIGH', 'accepted', 'v1.2']) {
      for (const key of WONDERLAND_CODE_METADATA_KEYS) {
        expect(sanitizeWonderlandMetadata({ [key]: code }), `${key}=${code}`).toEqual({ metadata: { [key]: code }, dropped: 0 });
      }
    }
    // Not a code: prose, a path of any kind, a URL, punctuation first, empty, too long, or not a string at all.
    for (const notCode of ['build submitted', 'src/app.ts', 'a\\b', 'x:y', 'https://example.com', '-dash', '', 'X'.repeat(65), null, 7, true]) {
      for (const key of WONDERLAND_CODE_METADATA_KEYS) {
        expect(sanitizeWonderlandMetadata({ [key]: notCode }), `${key}=${String(notCode)}`).toEqual({ metadata: {}, dropped: 1 });
      }
    }
    // CONTROL: the same values under a key that is NOT a code still cross -- the rule is the key's, not the value's.
    expect(sanitizeWonderlandMetadata({ note: 'build submitted', ref: 'src/app.ts', n: 7, flag: true, none: null }).dropped).toBe(0);
  });

  it('the code keys are exactly the codes the Julius normalizer carries', () => {
    expect([...WONDERLAND_CODE_METADATA_KEYS].sort()).toEqual(['outcome', 'reasonCode', 'severity']);
    for (const key of WONDERLAND_CODE_METADATA_KEYS) expect(WONDERLAND_CARRIED_FACT_KEYS).toContain(key);
  });

  it('drops long strings, because prose is the payload this keeps out', () => {
    const prose = 'x'.repeat(WONDERLAND_METADATA_MAX_LENGTH + 1);
    const { metadata, dropped } = sanitizeWonderlandMetadata({ completion: prose, n: 1 });
    expect(Object.keys(metadata)).toEqual(['n']);
    expect(dropped).toBe(1);
    // And a string exactly at the limit survives, so the bound is a bound.
    const edge = sanitizeWonderlandMetadata({ s: 'y'.repeat(WONDERLAND_METADATA_MAX_LENGTH) });
    expect(edge.dropped).toBe(0);
  });

  it('drops values that are not finite numbers', () => {
    // NaN and Infinity survive JSON as `null`, which would read on a HUD as
    // "reported nothing" rather than "reported something unusable".
    const { metadata, dropped } = sanitizeWonderlandMetadata({
      a: Number.NaN,
      b: Number.POSITIVE_INFINITY,
      c: 0,
    });
    expect(metadata).toEqual({ c: 0 });
    expect(dropped).toBe(2);
  });

  it('caps how many entries may cross', () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < WONDERLAND_METADATA_MAX_ENTRIES + 5; i += 1) many[`k${i}`] = i;
    const { metadata, dropped } = sanitizeWonderlandMetadata(many);
    expect(Object.keys(metadata).length).toBe(WONDERLAND_METADATA_MAX_ENTRIES);
    expect(dropped).toBe(5);
  });

  it('answers with an empty map for anything that is not an object', () => {
    for (const raw of [null, undefined, 'text', 7, true, ['a']]) {
      expect(sanitizeWonderlandMetadata(raw).metadata).toEqual({});
    }
  });

  it('freezes what it returns', () => {
    expect(Object.isFrozen(sanitizeWonderlandMetadata({ a: 1 }).metadata)).toBe(true);
  });
});

describe('what actually reaches a world', () => {
  it('survives a realistic provider response with nothing but the safe scalars', () => {
    // Shaped like a real chat-completions body, which is the thing that must
    // never arrive at a renderer.
    const envelope = wonderlandEnvelope({
      ...base,
      workerRole: 'CODING_AGENT',
      metadata: {
        id: 'chatcmpl-9xyz',
        model: 'gpt-4o-2024-08-06',
        choices: [{ message: { role: 'assistant', content: 'Here is the patch...' } }],
        usage: { total_tokens: 1204 },
        system_fingerprint: 'fp_abc',
        api_key: 'sk-proj-secret',
        attempt: 1,
      },
    });
    const text = JSON.stringify(envelope);
    expect(text).not.toContain('Here is the patch');
    expect(text).not.toMatch(/\bsk-proj/);
    expect(text).not.toContain('assistant');
    expect(envelope.metadata.attempt).toBe(1);
    expect(envelope.metadataDropped).toBeGreaterThan(0);
  });

  it('counts what it removed without naming it', () => {
    const envelope = wonderlandEnvelope({
      ...base,
      metadata: { apiKey: 'sk-1', payload: { a: 1 } },
    });
    expect(envelope.metadataDropped).toBe(2);
    expect(Object.keys(envelope.metadata)).toEqual([]);
    expect(JSON.stringify(envelope)).not.toContain('apiKey');
  });

  it('keeps a model name out even when it arrives under an innocent key', () => {
    // `model` is a plain short string, so it survives the sanitiser by design —
    // this asserts the honest limit rather than pretending otherwise. What the
    // envelope guarantees is that no PAYLOAD crosses; a caller choosing to put
    // a model name in metadata is a caller decision, and the normalizer's own
    // allowlist is where that is refused.
    const envelope = wonderlandEnvelope({ ...base, metadata: { model: 'gpt-4o' } });
    expect(envelope.metadata.model).toBe('gpt-4o');
  });
});
