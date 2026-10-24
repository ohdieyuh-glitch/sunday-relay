import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { closureOf, readsProviderKeyEnv, type ScanIo } from './julius-dispatch-source-scan';

const ROOT = join(__dirname, '..');
const io: ScanIo = {
  read: (path) => readFileSync(path, 'utf8'),
  exists: (path) => existsSync(path),
};

function readersFrom(start: string): string[] {
  const closure = closureOf([join(ROOT, start)], io);
  return closure.files
    .filter((file) => readsProviderKeyEnv(io.read(file)))
    .map((file) => relative(ROOT, file).split('\\').join('/'))
    .sort();
}

/**
 * Pre-existing readers on the server closure. The J1 route is not one of them.
 * Each line is exact: a prefix, suffix, case change, child or glob is not this line.
 */
const SERVER_KEY_READERS = [
  'relay-bridge/hosted-coding-agent/hosted-envelope.ts',
  'relay-bridge/julius/live-composition.ts',
  'relay-bridge/openai-architect.ts',
  'src/relay/connectors/claude-code/capability-probe.ts',
  'src/relay/connectors/gpt-architect/config.ts',
] as const;

describe('readsProviderKeyEnv', () => {
  it.each([
    'process.env.ANTHROPIC_API_KEY',
    "process['env'].OPENAI_API_KEY",
    'process["env"].XAI_API_KEY',
    'env.ANTHROPIC_AUTH_TOKEN',
    'options.env.OPENAI_API_KEY',
    'env.ANTHROPIC_API_KEY = input.apiKey',
  ])('catches %s', (line) => {
    expect(readsProviderKeyEnv(line)).toBe(true);
  });
  it('a comment, or the name with no env read, is not a read', () => {
    expect(readsProviderKeyEnv('// process.env.OPENAI_API_KEY')).toBe(false);
    expect(readsProviderKeyEnv('const name = "ANTHROPIC_API_KEY";')).toBe(false);
  });
});

describe('the relay-bridge server closure and the J1 route', () => {
  const serverReaders = readersFrom('relay-bridge/server.ts');
  const routeReaders = readersFrom('relay-bridge/julius-dispatch.ts');

  it('the server closure readers are exactly the pinned list', () => {
    expect(serverReaders).toEqual([...SERVER_KEY_READERS].sort());
  });

  it.each(SERVER_KEY_READERS)('pins %s and refuses a prefix, suffix, case change, child and glob', (line) => {
    expect(SERVER_KEY_READERS.filter((item) => item === line)).toHaveLength(1);
    const mutants = [` ${line}`, `${line} `, `${line}x`, `x${line}`, line.toUpperCase(), `${line}/child`, line.replace(/\.ts$/u, '.*')];
    for (const mutant of mutants) expect(SERVER_KEY_READERS as readonly string[]).not.toContain(mutant);
  });

  it('the J1 route closure reads no provider key env and shares no reader with the server allowlist', () => {
    expect(routeReaders).toEqual([]);
    expect(routeReaders.filter((file) => (SERVER_KEY_READERS as readonly string[]).includes(file))).toEqual([]);
    const server = readFileSync(join(ROOT, 'relay-bridge/server.ts'), 'utf8');
    expect(server).not.toMatch(/julius-dispatch(?:-adapters|-wiring)?/);
  });
});
