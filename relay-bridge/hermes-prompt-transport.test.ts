import { describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HERMES_PROMPT_FILE_FLAG, HERMES_PROMPT_FILE_NAME, HERMES_PROMPT_TRANSPORT_EXIT_CODE, HERMES_PROMPT_TRANSPORT_MARKER,
  buildReviewPrompt, hermesPreflight, hermesPromptTransportFrom, hermesReviewArgs, isArgumentListTooLong,
  loadHermesConfig, runHermesReview, type HermesConfig, type ReviewPacket,
} from './hermes-reviewer';

/**
 * THE REVIEW PACKET TRAVELS IN A FILE WHEN ARGV CANNOT CARRY IT.
 *
 * `hermes -z` takes its prompt only as an argument, and Linux refuses any single
 * argument of 131,072 bytes or more before a process exists. These cases hold
 * the file transport to the argv transport's contract, byte for byte, over a
 * real spawned process and a 300 KB packet; hold the refusals to their names
 * instead of `launch_failed`; and hold the launcher the paid wrapper runs.
 */

// The bridge tsconfig forbids `import.meta`; vitest runs from the repository root.
const ROOT = process.cwd();
const LAUNCHER = join(ROOT, '.github/julius-live-hermes-launcher.py');

const packetOf = (diffBytes: number): ReviewPacket => ({
  missionId: 'msn-transport',
  originalRequest: 'Carry the whole packet.',
  handoffJson: JSON.stringify({ objective: 'Carry the whole packet.' }),
  acceptanceCriteria: ['Nothing is cut.'],
  baseRevision: 'abc1234',
  artifactDigest: 'sha256:transport',
  changedFiles: ['src/large.ts'],
  // Multi-byte characters on purpose: bytes and characters must not be confused.
  unifiedDiff: `diff --git a/src/large.ts b/src/large.ts\n${'+export const line = "é";\n'.repeat(Math.ceil(diffBytes / 27))}`,
  changedFileContents: 'export const line = "é";',
  testCommand: 'npm test',
  testOutput: 'ok',
  relayEvidence: ['relay verified the diff applies'],
});
const SMALL = packetOf(2_000);
const LARGE = packetOf(300_000);
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/**
 * A FAKE REVIEWER EXECUTABLE THAT BEHAVES LIKE THE PAID WRAPPER AND HERMES.
 *
 * It accepts either transport, writes Hermes's usage report where
 * `--usage-file` names, prints a valid review, and records what it received
 * beside itself: which transport, how many bytes, their SHA-256, the prompt
 * file's mode and path, and the arguments after the prompt.
 */
function fakeReviewer(): { dir: string; spawnImpl: typeof spawn; observed: () => Record<string, unknown> | null } {
  const dir = mkdtempSync(join(tmpdir(), 'relay-fake-reviewer-'));
  const script = join(dir, 'fake-reviewer.mjs');
  writeFileSync(script, [
    "import { createHash } from 'node:crypto';",
    "import { readFileSync, statSync, writeFileSync } from 'node:fs';",
    "import { dirname, join } from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    'const args = process.argv.slice(2);',
    'let prompt; let transport; let mode = null; let promptPath = null;',
    `if (args[0] === ${JSON.stringify(HERMES_PROMPT_FILE_FLAG)}) {`,
    '  promptPath = args[1]; transport = "file";',
    '  mode = process.platform === "win32" ? null : (statSync(promptPath).mode & 0o777).toString(8);',
    '  prompt = readFileSync(promptPath);',
    '} else { transport = "argv"; prompt = Buffer.from(args[1], "utf8"); }',
    'const rest = args.slice(2);',
    'const usage = rest[rest.indexOf("--usage-file") + 1];',
    'writeFileSync(usage, JSON.stringify({ model: "grok-build-0.1-served", input_tokens: 10, output_tokens: 5 }));',
    'writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "observed.json"), JSON.stringify({',
    '  transport, bytes: prompt.length, sha256: createHash("sha256").update(prompt).digest("hex"),',
    '  mode, promptPath, cwd: process.cwd(), rest: rest.map((a) => (a === usage ? "<usage>" : a)),',
    '}));',
    'process.stdout.write(JSON.stringify({ verdict: "approved", summary: "Reviewed.", findings: [], requirementsChecked: [] }));',
  ].join('\n'));
  const spawnImpl = ((_exe: string, args: string[], options: Parameters<typeof spawn>[2]) =>
    spawn(process.execPath, [script, ...args], options)) as unknown as typeof spawn;
  const observed = () => (existsSync(join(dir, 'observed.json'))
    ? JSON.parse(readFileSync(join(dir, 'observed.json'), 'utf8')) as Record<string, unknown>
    : null);
  return { dir, spawnImpl, observed };
}

const CONFIG = (transport: HermesConfig['promptTransport']): HermesConfig => ({
  executable: 'hermes-wrapper', model: 'grok-build-0.1', provider: 'xai',
  timeoutMs: 20_000, maxOutputBytes: 64_000, promptTransport: transport,
});

describe('the setting and the arguments', () => {
  it('reads RELAY_HERMES_PROMPT_TRANSPORT as argv, file, or unrecognised, never a guess', () => {
    expect(hermesPromptTransportFrom(undefined)).toBe('argv');
    expect(hermesPromptTransportFrom('')).toBe('argv');
    expect(hermesPromptTransportFrom('argv')).toBe('argv');
    expect(hermesPromptTransportFrom('file')).toBe('file');
    for (const unknown of ['FILE', 'stdin', 'files', ' file']) expect(hermesPromptTransportFrom(unknown), unknown).toBe('unrecognised');
    expect(loadHermesConfig({ RELAY_HERMES_PROMPT_TRANSPORT: 'file' } as never).promptTransport).toBe('file');
    expect(loadHermesConfig({} as never).promptTransport).toBe('argv');
  });

  it('differ between the transports in exactly the prompt slot', () => {
    const common = { prompt: 'the packet', usageFilePath: '/s/relay-hermes-usage.json', model: 'grok-build-0.1', provider: 'xai' };
    const argv = hermesReviewArgs({ ...common, transport: 'argv', promptFilePath: null });
    const file = hermesReviewArgs({ ...common, transport: 'file', promptFilePath: `/s/${HERMES_PROMPT_FILE_NAME}` });
    expect(argv).toEqual(['-z', 'the packet', '--safe-mode', '--usage-file', '/s/relay-hermes-usage.json', '-m', 'grok-build-0.1', '--provider', 'xai']);
    expect(file.slice(0, 2)).toEqual([HERMES_PROMPT_FILE_FLAG, `/s/${HERMES_PROMPT_FILE_NAME}`]);
    expect(file.slice(2)).toEqual(argv.slice(2));
    expect(() => hermesReviewArgs({ ...common, transport: 'file', promptFilePath: null })).toThrow('hermes_prompt_file_path_required');
  });

  it('names no file Hermes would read as project context', () => {
    expect(['.hermes.md', 'HERMES.md', 'AGENTS.md', 'agents.md', 'CLAUDE.md', 'claude.md', '.cursorrules']).not.toContain(HERMES_PROMPT_FILE_NAME);
  });

  it('counts only the too-long errors that mean the arguments were too long on that platform', () => {
    expect(isArgumentListTooLong({ code: 'E2BIG' }, 'linux')).toBe(true);
    expect(isArgumentListTooLong({ code: 'E2BIG' }, 'win32')).toBe(true);
    expect(isArgumentListTooLong({ code: 'ENAMETOOLONG' }, 'win32')).toBe(true);
    expect(isArgumentListTooLong({ code: 'ENAMETOOLONG' }, 'linux')).toBe(false);
    for (const other of [{ code: 'ENOENT' }, null, undefined, new Error('x')]) expect(isArgumentListTooLong(other, 'linux')).toBe(false);
  });
});

describe('the file transport carries what argv cannot, and changes nothing else', () => {
  it('a 300 KB packet cannot be spawned as an argument, and is named for that, never launch_failed', async () => {
    const fake = fakeReviewer();
    const outcome = await runHermesReview({ packet: LARGE, config: CONFIG('argv'), spawnImpl: fake.spawnImpl });
    expect(outcome.kind).toBe('review_incomplete');
    if (outcome.kind !== 'review_incomplete') throw new Error(outcome.kind);
    expect(outcome.shape).toBe('review_packet_too_large');
    expect(outcome.diagnostics.packetBytes).toBe(Buffer.byteLength(buildReviewPrompt(LARGE), 'utf8'));
    expect(outcome.diagnostics.packetBytes!).toBeGreaterThan(300_000);
    expect(outcome.diagnostics.processStarted).toBe(false);
    expect(outcome.diagnostics.providerRequestStarted).toBe(false);
    expect(fake.observed(), 'the reviewer never ran').toBeNull();
  }, 30_000);

  it('the same packet spawns on the file transport and arrives whole, byte for byte, in a 0600 file', async () => {
    const fake = fakeReviewer();
    const outcome = await runHermesReview({ packet: LARGE, config: CONFIG('file'), spawnImpl: fake.spawnImpl });
    expect(outcome.kind, JSON.stringify(outcome)).toBe('reviewed');
    if (outcome.kind !== 'reviewed') throw new Error(outcome.kind);
    const prompt = buildReviewPrompt(LARGE);
    const seen = fake.observed()!;
    expect(seen.transport).toBe('file');
    expect(seen.bytes).toBe(Buffer.byteLength(prompt, 'utf8'));
    expect(seen.sha256).toBe(sha256(prompt));
    expect(seen.mode).toBe(process.platform === 'win32' ? null : '600');
    expect(String(seen.promptPath)).toBe(join(String(seen.cwd), HERMES_PROMPT_FILE_NAME));
    expect(seen.rest).toEqual(['--safe-mode', '--usage-file', '<usage>', '-m', 'grok-build-0.1', '--provider', 'xai']);
    expect(outcome.diagnostics.packetBytes).toBe(seen.bytes);
    // Removed with the scratch directory, as the usage file always was.
    expect(existsSync(String(seen.promptPath))).toBe(false);
    expect(existsSync(String(seen.cwd))).toBe(false);
  }, 30_000);

  it('a packet both transports can carry reaches the reviewer identically, with the same served model and the same record', async () => {
    const viaArgv = fakeReviewer();
    const viaFile = fakeReviewer();
    const now = () => '2026-09-13T00:00:00.000Z';
    const argv = await runHermesReview({ packet: SMALL, config: CONFIG('argv'), spawnImpl: viaArgv.spawnImpl, now });
    const file = await runHermesReview({ packet: SMALL, config: CONFIG('file'), spawnImpl: viaFile.spawnImpl, now });
    expect(argv.kind).toBe('reviewed');
    expect(file.kind).toBe('reviewed');
    const [a, f] = [viaArgv.observed()!, viaFile.observed()!];
    expect(f.sha256).toBe(a.sha256);
    expect(f.bytes).toBe(a.bytes);
    expect(f.rest).toEqual(a.rest);
    if (argv.kind !== 'reviewed' || file.kind !== 'reviewed') throw new Error('unreachable');
    expect(file.servedModel).toBe('grok-build-0.1-served');
    expect(file.servedModel).toBe(argv.servedModel);
    expect(file.usage).toEqual(argv.usage);
    expect(file.result).toEqual(argv.result);
    const comparable = (d: typeof file.diagnostics) => ({ ...d, firstOutputAfterMs: null, elapsedMs: null, processPidObserved: null });
    expect(comparable(file.diagnostics)).toEqual(comparable(argv.diagnostics));
  }, 30_000);

  it('keeps the output ceiling on the file transport', async () => {
    const fake = fakeReviewer();
    const outcome = await runHermesReview({ packet: SMALL, config: { ...CONFIG('file'), maxOutputBytes: 16 }, spawnImpl: fake.spawnImpl });
    expect(outcome.kind).toBe('review_incomplete');
    if (outcome.kind !== 'review_incomplete') throw new Error(outcome.kind);
    expect(outcome.shape).toBe('review_output_too_large');
    expect(outcome.diagnostics.outputTruncated).toBe(true);
  }, 30_000);
});

describe('a transport that cannot carry the review is named, never launch_failed', () => {
  it('a missing wrapper on the file transport is the transport unavailable; on argv it stays a launch failure', async () => {
    const missing = join(tmpdir(), 'relay-no-such-wrapper', 'hermes');
    const spawnMissing = ((_exe: string, args: string[], options: Parameters<typeof spawn>[2]) =>
      spawn(missing, args, options)) as unknown as typeof spawn;
    const file = await runHermesReview({ packet: SMALL, config: CONFIG('file'), spawnImpl: spawnMissing });
    expect(file.kind).toBe('review_incomplete');
    if (file.kind !== 'review_incomplete') throw new Error(file.kind);
    expect(file.shape).toBe('review_transport_unavailable');
    expect(file.diagnostics.processStarted).toBe(false);
    expect(file.diagnostics.packetBytes).toBe(Buffer.byteLength(buildReviewPrompt(SMALL), 'utf8'));
    const argv = await runHermesReview({ packet: SMALL, config: CONFIG('argv'), spawnImpl: spawnMissing });
    expect(argv.kind).toBe('launch_failed');
  }, 30_000);

  it('the launcher refusing the prompt file is the transport unavailable, and only with its marker', async () => {
    const exiting = (stderr: string) => ((_exe: string, _args: string[], options: Parameters<typeof spawn>[2]) =>
      spawn(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(stderr)}); process.exit(${HERMES_PROMPT_TRANSPORT_EXIT_CODE})`], options)) as unknown as typeof spawn;
    const refused = await runHermesReview({ packet: SMALL, config: CONFIG('file'), spawnImpl: exiting(`${HERMES_PROMPT_TRANSPORT_MARKER}:prompt_file_readable_by_others\n`) });
    expect(refused.kind).toBe('review_incomplete');
    if (refused.kind !== 'review_incomplete') throw new Error(refused.kind);
    expect(refused.shape).toBe('review_transport_unavailable');
    expect(refused.diagnostics.processExitCode).toBe(HERMES_PROMPT_TRANSPORT_EXIT_CODE);
    // A Hermes that happened to exit 97 said nothing about the transport.
    const unrelated = await runHermesReview({ packet: SMALL, config: CONFIG('file'), spawnImpl: exiting('some other failure\n') });
    expect(unrelated.kind === 'review_incomplete' && unrelated.shape).toBe('review_process_exit');
    // And the marker means nothing on the argv transport, which has no launcher.
    const argv = await runHermesReview({ packet: SMALL, config: CONFIG('argv'), spawnImpl: exiting(`${HERMES_PROMPT_TRANSPORT_MARKER}:x\n`) });
    expect(argv.kind === 'review_incomplete' && argv.shape).toBe('review_process_exit');
  }, 30_000);

  it('a transport setting this build does not recognise refuses the review without starting anything', async () => {
    const spawnImpl = vi.fn();
    const outcome = await runHermesReview({ packet: SMALL, config: CONFIG('unrecognised'), spawnImpl: spawnImpl as never });
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(outcome.kind === 'review_incomplete' && outcome.shape).toBe('review_transport_unavailable');
  });

  it('an argument list the runtime refuses asynchronously is still the packet, not a launch', async () => {
    const asyncE2big = ((_exe: string, _args: string[], options: Parameters<typeof spawn>[2]) => {
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], options);
      setImmediate(() => { child.kill(); child.emit('error', Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG' })); });
      return child;
    }) as unknown as typeof spawn;
    const outcome = await runHermesReview({ packet: SMALL, config: CONFIG('argv'), spawnImpl: asyncE2big });
    expect(outcome.kind === 'review_incomplete' && outcome.shape).toBe('review_packet_too_large');
  }, 30_000);
});

describe('the liveness probe takes the transport the review will take', () => {
  const HELP = 'usage: hermes [-h] [-z PROMPT] [--safe-mode] [--provider PROVIDER] [--usage-file PATH]';
  const STATUS = '◆ Environment\n  Model:        grok-build-0.1\n  Provider:     xAI';

  it('writes the probe prompt to a 0600 file, passes the flag, and removes the file afterwards', () => {
    const seen: { args: string[]; prompt: string | null; mode: string | null } = { args: [], prompt: null, mode: null };
    const result = hermesPreflight(CONFIG('file'), {
      probe: (_exe, args) => {
        if (args[0] === '--help') return { ok: true, text: HELP };
        if (args[0] === 'status') return { ok: true, text: STATUS };
        seen.args = args;
        seen.prompt = readFileSync(args[1]!, 'utf8');
        seen.mode = process.platform === 'win32' ? null : (statSync(args[1]!).mode & 0o777).toString(8);
        return { ok: true, text: 'OK' };
      },
    });
    expect(result.ready).toBe(true);
    expect(seen.args[0]).toBe(HERMES_PROMPT_FILE_FLAG);
    expect(seen.args).toContain('--safe-mode');
    expect(seen.args).not.toContain('-z');
    expect(seen.prompt).toBe('Reply with the single word: OK');
    expect(seen.mode).toBe(process.platform === 'win32' ? null : '600');
    expect(existsSync(seen.args[1]!)).toBe(false);
  });

  it('names the transport when the wrapper refuses it, and refuses an unrecognised setting before probing', () => {
    const refusing = hermesPreflight(CONFIG('file'), {
      probe: (_exe, args) => (args[0] === '--help' ? { ok: true, text: HELP }
        : args[0] === 'status' ? { ok: true, text: STATUS }
          : { ok: false, text: `${HERMES_PROMPT_TRANSPORT_MARKER}:prompt_file_unreadable` }),
    });
    expect(refusing.ready).toBe(false);
    expect(refusing.missing).toContain(`hermes prompt-file transport (the reviewer executable refused ${HERMES_PROMPT_FILE_FLAG})`);

    const probed: string[][] = [];
    const unknown = hermesPreflight(CONFIG('unrecognised'), {
      probe: (_exe, args) => { probed.push(args); return args[0] === '--help' ? { ok: true, text: HELP } : { ok: true, text: STATUS }; },
    });
    expect(unknown.ready).toBe(false);
    expect(unknown.missing).toContain('hermes prompt transport (RELAY_HERMES_PROMPT_TRANSPORT must be argv or file)');
    expect(probed.some((args) => args[0] === HERMES_PROMPT_FILE_FLAG || args[0] === '-z'), 'no generation is asked for').toBe(false);
  });
});

/**
 * THE LAUNCHER THE PAID WRAPPER RUNS, AGAINST A HERMES SMALL ENOUGH TO READ.
 *
 * The stand-in `hermes_cli.main.main` writes down the `sys.argv` it was called
 * with. The launcher must hand it exactly the argument list the argv transport
 * would have, refuse a prompt file it cannot trust with its own exit status and
 * marker, and pass everything through untouched without the flag.
 */
describe('the prompt-file launcher', () => {
  const python = ['python3', 'python'].find((candidate) => spawnSync(candidate, ['-c', 'import sys; assert sys.version_info >= (3, 11)']).status === 0);
  const posix = process.platform !== 'win32';

  const fakeHermesCli = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-fake-hermes-cli-'));
    mkdirSync(join(dir, 'hermes_cli'));
    writeFileSync(join(dir, 'hermes_cli', '__init__.py'), '');
    writeFileSync(join(dir, 'hermes_cli', 'main.py'), [
      'import hashlib, json, os, sys',
      'def main():',
      '    argv = list(sys.argv)',
      '    prompt = argv[2] if len(argv) > 2 and argv[1] == "-z" else None',
      '    record = {"argv0": argv[0], "flag": argv[1] if len(argv) > 1 else None, "rest": argv[3:] if prompt is not None else argv[1:],',
      '              "bytes": None if prompt is None else len(prompt.encode("utf-8")),',
      '              "sha256": None if prompt is None else hashlib.sha256(prompt.encode("utf-8")).hexdigest()}',
      '    with open(os.environ["FAKE_HERMES_RECORD"], "w", encoding="utf-8") as handle:',
      '        json.dump(record, handle)',
      '    return 0',
    ].join('\n'));
    return dir;
  };

  const launch = (args: string[]) => {
    const cli = fakeHermesCli();
    const record = join(cli, 'record.json');
    const result = spawnSync(python!, ['-P', LAUNCHER, '/opt/hermes-venv/bin/hermes', ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '', PYTHONPATH: cli, FAKE_HERMES_RECORD: record, PYTHONDONTWRITEBYTECODE: '1' },
    });
    return { result, record: existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) as Record<string, unknown> : null };
  };

  const promptFile = (content: string | Buffer, mode = 0o600): string => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-prompt-'));
    const path = join(dir, HERMES_PROMPT_FILE_NAME);
    writeFileSync(path, content, { mode });
    chmodSync(path, mode);
    return path;
  };

  const refusedWith = (outcome: ReturnType<typeof launch>, reason: string) => {
    expect(outcome.result.status, outcome.result.stderr).toBe(HERMES_PROMPT_TRANSPORT_EXIT_CODE);
    expect(outcome.result.stderr.trim()).toBe(`${HERMES_PROMPT_TRANSPORT_MARKER}:${reason}`);
    expect(outcome.record, 'Hermes must never have been called').toBeNull();
  };

  it('has a Python to run under', () => {
    expect(python, 'the launcher is Python; these cases need python3 or python on PATH').toBeDefined();
  });

  it('hands Hermes the argv transport argument list, with a 300 KB prompt intact', () => {
    const prompt = buildReviewPrompt(LARGE);
    const path = promptFile(prompt);
    const { result, record } = launch([HERMES_PROMPT_FILE_FLAG, path, '--safe-mode', '--usage-file', '/s/u.json', '-m', 'grok-build-0.1', '--provider', 'xai']);
    expect(result.status, result.stderr).toBe(0);
    expect(record).toEqual({
      argv0: '/opt/hermes-venv/bin/hermes', flag: '-z',
      rest: ['--safe-mode', '--usage-file', '/s/u.json', '-m', 'grok-build-0.1', '--provider', 'xai'],
      bytes: Buffer.byteLength(prompt, 'utf8'), sha256: sha256(prompt),
    });
  }, 30_000);

  it('passes every argument through untouched without the flag', () => {
    const { result, record } = launch(['-z', 'short prompt', '--safe-mode']);
    expect(result.status, result.stderr).toBe(0);
    expect(record).toMatchObject({ argv0: '/opt/hermes-venv/bin/hermes', flag: '-z', rest: ['--safe-mode'], bytes: 12 });
    expect(launch(['--version']).record).toMatchObject({ flag: '--version', rest: ['--version'], bytes: null });
  }, 30_000);

  it('refuses a prompt file it cannot trust, naming why and nothing from the file', () => {
    refusedWith(launch([HERMES_PROMPT_FILE_FLAG, join(tmpdir(), 'relay-absent', 'prompt.txt')]), 'prompt_file_unreadable');
    refusedWith(launch([HERMES_PROMPT_FILE_FLAG, promptFile('')]), 'prompt_file_empty');
    refusedWith(launch([HERMES_PROMPT_FILE_FLAG, promptFile(Buffer.from([0xff, 0xfe, 0x00]))]), 'prompt_file_not_utf8');
    refusedWith(launch([HERMES_PROMPT_FILE_FLAG]), 'prompt_file_not_named');
    refusedWith(launch(['--safe-mode', HERMES_PROMPT_FILE_FLAG, promptFile('x')]), 'prompt_file_flag_not_first');
    refusedWith(launch([HERMES_PROMPT_FILE_FLAG, mkdtempSync(join(tmpdir(), 'relay-prompt-dir-'))]),
      posix ? 'prompt_file_not_regular' : 'prompt_file_unreadable');
  }, 60_000);

  it('on POSIX, refuses a prompt file others can read or one reached through a symlink', () => {
    const readable = launch([HERMES_PROMPT_FILE_FLAG, promptFile('secret packet', 0o644)]);
    const target = promptFile('packet');
    const link = join(mkdtempSync(join(tmpdir(), 'relay-prompt-link-')), HERMES_PROMPT_FILE_NAME);
    let linked: ReturnType<typeof launch> | null = null;
    try { symlinkSync(target, link); linked = launch([HERMES_PROMPT_FILE_FLAG, link]); } catch { linked = null; }
    if (posix) {
      refusedWith(readable, 'prompt_file_readable_by_others');
      expect(linked, 'POSIX can always make the link').not.toBeNull();
      refusedWith(linked!, 'prompt_file_unreadable');
    } else {
      // Windows has no POSIX mode bits to refuse on; the launcher runs on Linux.
      expect(readable.result.status).toBe(0);
    }
  }, 30_000);
});
