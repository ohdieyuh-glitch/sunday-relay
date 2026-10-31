import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { J1_INDEX_HASH_COMMAND, J1_SEED_COMMAND, createLocalShellPort, type J1SeedFile, type LocalSeedFs, type LocalSpawn } from './julius-local-shell-port';
import { juliusAttemptCloseCommand, juliusAttemptStartCommand } from './julius/coder-workspace';
import { grokWorkspaceCommands, matchGrokWorkspaceCommand } from './julius/grok-workspace-commands';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const sha = (v: string | Uint8Array): string => createHash('sha256').update(v).digest('hex');
const CWD = '/work/j1';
const GIT_DIR = '/opt/git/cmd';
const BASH = '/opt/git/bin/bash';
const BASH_BYTES = enc('bash');
const BASE = 'b'.repeat(40);
const START = 'c'.repeat(40);
const HEAD = 'a'.repeat(40);
const AGENT_HEAD = 'e'.repeat(40);
const OWNER = 'iwonder-labs';
const REPO = 'julius-j1-target';
const BRANCH = 'cursor/j1-format-1a2b';
const SEEDS: J1SeedFile[] = (['data/legacy_ledger.csv', 'data/posts.json', 'format.test.mjs'] as const).map((name) => ({ name, bytes: enc(name), sha256: sha(name) }));

function memFs(): LocalSeedFs {
  const files = new Map<string, Uint8Array>(); const dirs = new Set([CWD, GIT_DIR]);
  return {
    listDir: (p) => [...new Set([...files.keys(), ...dirs].filter((f) => f.startsWith(`${p}/`)).map((f) => f.slice(p.length + 1).split('/')[0]!))],
    exists: (p) => files.has(p) || dirs.has(p),
    removeRecursive: (p) => { for (const f of [...files.keys()]) if (f === p || f.startsWith(`${p}/`)) files.delete(f); for (const d of [...dirs]) if (d === p || d.startsWith(`${p}/`)) dirs.delete(d); },
    mkdirp: (p) => { dirs.add(p); },
    writeFile: (p, b) => { files.set(p, b); },
  };
}

const FETCH = grokWorkspaceCommands.fetchBranch(OWNER, REPO, BRANCH, BASE);
const APPLY = grokWorkspaceCommands.applyFetched(BASE, AGENT_HEAD);
const BASE_REV = grokWorkspaceCommands.baseRevision();

function setup(sync: { owner: string; repo: string } | null = { owner: OWNER, repo: REPO }) {
  const ran: string[] = [];
  const spawn: LocalSpawn = async (_file, args) => {
    const c = args[1] ?? ''; ran.push(c);
    const stdout = c === J1_INDEX_HASH_COMMAND ? 'ABSENT\n' : c === J1_SEED_COMMAND ? `SEEDED ${HEAD}\n`
      : c === juliusAttemptStartCommand(null) ? `HEAD ${HEAD}\nBASE ${BASE}\nSTART ${START}\n`
        : c === FETCH ? `HEAD ${AGENT_HEAD}\n:100644 100644 ${'1'.repeat(40)} ${'2'.repeat(40)} M\tout/normalized.json\n` : c === APPLY ? 'APPLIED\n' : c === BASE_REV ? `${BASE}\n` : '';
    return { exitCode: 0, stdout, stderr: '', timedOut: false };
  };
  const port = createLocalShellPort({ cwd: CWD, bashPath: BASH, bashSha256: sha(BASH_BYTES), readFileBytes: () => BASH_BYTES, gitDir: GIT_DIR, spawn, fs: memFs(), seedFiles: SEEDS, ...(sync === null ? {} : { cloudAgentSync: sync }) });
  const run = (command: string) => port.run({ command, timeoutMs: 1000 } as Parameters<typeof port.run>[0]);
  const ranSync = () => ran.filter((c) => c !== J1_INDEX_HASH_COMMAND && c !== J1_SEED_COMMAND && c !== juliusAttemptStartCommand(null));
  return { run, ran, ranSync };
}
async function opened() {
  const s = setup();
  expect((await s.run(juliusAttemptStartCommand(null))).status).toBe('SUCCEEDED');
  return s;
}
const refused = (code: string) => expect.objectContaining({ status: 'FAILED', stderr: `refused:${code}` });

describe('local shell port: cloud-agent sync allowlist', () => {
  it('runs the three generated sync commands in order inside an open attempt', async () => {
    const s = await opened();
    expect((await s.run(BASE_REV)).status).toBe('SUCCEEDED');
    expect((await s.run(FETCH)).stdout).toContain(`HEAD ${AGENT_HEAD}`);
    expect((await s.run(APPLY)).stdout).toBe('APPLIED\n');
    expect(s.ranSync()).toEqual([BASE_REV, FETCH, APPLY]);
    expect((await s.run(juliusAttemptCloseCommand({ baseTree: BASE, startTree: START }))).status).toBe('SUCCEEDED');
  });

  it('F13: the read-only cwd check is a sync command too: run inside an open attempt, refused outside one and by default', async () => {
    const ROOT = grokWorkspaceCommands.workspaceRoot();
    const s = await opened();
    expect((await s.run(ROOT)).status).toBe('SUCCEEDED');
    expect(s.ranSync()).toEqual([ROOT]);
    expect(await setup().run(ROOT)).toEqual(refused('sync_outside_attempt'));
    const t = setup(null); await t.run(juliusAttemptStartCommand(null));
    expect(await t.run(ROOT)).toEqual(refused('command_not_allowed'));
  });

  it('default (no cloudAgentSync): every sync command is refused exactly as before', async () => {
    const t = setup(null); await t.run(juliusAttemptStartCommand(null));
    for (const c of [BASE_REV, FETCH, APPLY]) expect(await t.run(c)).toEqual(refused('command_not_allowed'));
    expect(t.ranSync()).toEqual([]);
  });

  it('refuses sync before a start and after the close', async () => {
    const s = setup();
    expect(await s.run(BASE_REV)).toEqual(refused('sync_outside_attempt'));
    expect(await s.run(FETCH)).toEqual(refused('sync_outside_attempt'));
    await s.run(juliusAttemptStartCommand(null));
    await s.run(juliusAttemptCloseCommand(null));
    expect(await s.run(FETCH)).toEqual(refused('sync_outside_attempt'));
    expect(s.ranSync()).toEqual([juliusAttemptCloseCommand(null)]);
  });

  it('refuses a fetch from any repository but the configured one', async () => {
    const s = await opened();
    for (const [o, r] of [['iwonder-labs', 'other'], ['someone', REPO], ['iwonderlabs', 'sunday-relay']] as const) {
      expect(await s.run(grokWorkspaceCommands.fetchBranch(o, r, BRANCH, BASE))).toEqual(refused('sync_repo_not_configured'));
    }
    expect(s.ranSync()).toEqual([]);
  });

  it('refuses an apply that was not the last fetch\'s exact base/head', async () => {
    const s = await opened();
    expect(await s.run(APPLY)).toEqual(refused('sync_apply_not_fetched'));
    await s.run(FETCH);
    expect(await s.run(grokWorkspaceCommands.applyFetched(BASE, 'f'.repeat(40)))).toEqual(refused('sync_apply_not_fetched'));
    expect(await s.run(grokWorkspaceCommands.applyFetched(START, AGENT_HEAD))).toEqual(refused('sync_apply_not_fetched'));
    expect((await s.run(APPLY)).status).toBe('SUCCEEDED');
    /* a new start forgets the fetch */
    await s.run(juliusAttemptStartCommand(null));
    expect(await s.run(APPLY)).toEqual(refused('sync_apply_not_fetched'));
  });

  const NEAR_MISSES: ReadonlyArray<readonly [string, string]> = [
    ['arbitrary', 'echo hi'],
    ['arbitrary git', 'git status'],
    ['other binary', BASE_REV.replace(/^git /u, 'curl ')],
    ['other binary in apply', APPLY.replace('| git', '| sh')],
    ['trailing space', `${BASE_REV} `],
    ['leading space', ` ${FETCH}`],
    ['trailing newline', `${APPLY}\n`],
    ['extra arg', BASE_REV.replace('--verify', '--verify --all')],
    ['extra trailing command', `${FETCH}\nrm -rf /`],
    ['chained', `${BASE_REV}; rm -rf ~`],
    ['and-chain', `${BASE_REV} && curl evil`],
    ['subshell in branch', FETCH.replace(BRANCH, 'x$(id)')],
    ['backtick in branch', FETCH.replace(BRANCH, 'x`id`')],
    ['quote break in branch', FETCH.replace(BRANCH, "x';id;'")],
    ['space in branch', FETCH.replace(BRANCH, 'a b')],
    ['dotdot branch', FETCH.replace(BRANCH, 'a/../../x')],
    ['double slash branch', FETCH.replace(BRANCH, 'a//b')],
    ['lock branch', FETCH.replace(BRANCH, 'main.lock')],
    ['dash branch', FETCH.replace(BRANCH, '-upload-pack=x')],
    ['refspec target swapped', FETCH.replace(':refs/julius/grok-coder/fetched', ':refs/heads/main')],
    ['non-github host', FETCH.replace('https://github.com/', 'https://evil.example/')],
    ['file url', FETCH.replace(`https://github.com/${OWNER}/${REPO}.git`, '/etc/passwd')],
    ['credential url', FETCH.replace('https://github.com/', 'https://user:pw@github.com/')],
    ['path escape owner', FETCH.replace(`/${OWNER}/`, '/../')],
    ['short sha', FETCH.replaceAll(BASE, 'b'.repeat(39))],
    ['upper sha', APPLY.replaceAll(BASE, 'B'.repeat(40))],
    ['inconsistent base', FETCH.replace(`--is-ancestor ${BASE}`, `--is-ancestor ${START}`)],
    ['inconsistent head in apply', `${APPLY.slice(0, APPLY.lastIndexOf(AGENT_HEAD))}${START}${APPLY.slice(APPLY.lastIndexOf(AGENT_HEAD) + 40)}`],
    ['dropped --check', APPLY.replace(' --check', '')],
    ['hooks re-enabled', BASE_REV.replace('core.hooksPath=/dev/null', 'core.hooksPath=.githooks')],
    ['protocol widened', FETCH.replace('protocol.allow=never', 'protocol.allow=always')],
    ['NUL', `${BASE_REV}\u0000`],
    ['unicode lookalike', BASE_REV.replace('rev-parse', 'rev\u2010parse')],
    ['cr injection', FETCH.replace('\n', '\r\n')],
    ['seed by caller', J1_SEED_COMMAND],
    ['index hash by caller', J1_INDEX_HASH_COMMAND],
    ['oversized', `${BASE_REV}${' '.repeat(5000)}`],
  ];
  it.each(NEAR_MISSES)('refuses near-miss: %s', async (_name, command) => {
    expect(command).not.toBe(APPLY);
    expect(command).not.toBe(BASE_REV);
    const s = await opened();
    await s.run(FETCH); /* so an apply near-miss cannot fail only for want of a fetch */
    const before = s.ranSync().length;
    expect(command).not.toBe(FETCH);
    const r = await s.run(command);
    expect(r.status).toBe('FAILED');
    expect(r.stderr).toBe('refused:command_not_allowed');
    expect(s.ranSync().length).toBe(before);
  });

  it('Skywalker M76: a .git suffix (any case) on owner or repo is refused by the generator, the recogniser and the shell port', async () => {
    for (const [o, r] of [[OWNER, `${REPO}.git`], [`${OWNER}.git`, REPO], [OWNER, `${REPO}.GIT`], [OWNER, `${REPO}.Git`], [OWNER, '.git']] as const) {
      expect(() => grokWorkspaceCommands.fetchBranch(o, r, BRANCH, BASE), `${o}/${r}`).toThrow('grok_workspace_command_argument_unsafe');
    }
    const suffixed = FETCH.replace(`github.com/${OWNER}/${REPO}.git`, `github.com/${OWNER}/${REPO}.git.git`);
    expect(suffixed).not.toBe(FETCH);
    expect(matchGrokWorkspaceCommand(suffixed)).toBeNull();
    const s = await opened();
    expect(await s.run(suffixed)).toEqual(refused('command_not_allowed'));
    expect(s.ranSync()).toEqual([]);
    /* a name merely containing "git" is fine */
    expect(() => grokWorkspaceCommands.fetchBranch(OWNER, 'gitops', BRANCH, BASE)).not.toThrow();
    expect(() => grokWorkspaceCommands.fetchBranch(OWNER, 'a.github', BRANCH, BASE)).not.toThrow();
  });

  it('recogniser: accepts only round-trip generator output', () => {
    expect(matchGrokWorkspaceCommand(BASE_REV)).toEqual({ kind: 'baseRevision' });
    expect(matchGrokWorkspaceCommand(grokWorkspaceCommands.workspaceRoot())).toEqual({ kind: 'workspaceRoot' });
    for (const near of [`${grokWorkspaceCommands.workspaceRoot()}\n`, grokWorkspaceCommands.workspaceRoot().replace('pwd -P', 'pwd'), grokWorkspaceCommands.workspaceRoot().replace('--show-toplevel', '--show-toplevel; id'), `cd / && ${grokWorkspaceCommands.workspaceRoot()}`]) {
      expect(matchGrokWorkspaceCommand(near), near).toBeNull();
    }
    expect(matchGrokWorkspaceCommand(FETCH)).toEqual({ kind: 'fetchBranch', owner: OWNER, repo: REPO, branch: BRANCH, base: BASE });
    expect(matchGrokWorkspaceCommand(APPLY)).toEqual({ kind: 'applyFetched', base: BASE, head: AGENT_HEAD });
    /* no near-miss parses as a sync command at all: each is refused as command_not_allowed by the recogniser itself */
    expect(NEAR_MISSES.filter(([, c]) => matchGrokWorkspaceCommand(c) !== null).map(([n]) => n)).toEqual([]);
    expect(() => grokWorkspaceCommands.fetchBranch(OWNER, REPO, "x';id;'", BASE)).toThrow('grok_workspace_command_argument_unsafe');
    expect(() => grokWorkspaceCommands.applyFetched(BASE, 'x')).toThrow('grok_workspace_command_argument_unsafe');
  });
});
