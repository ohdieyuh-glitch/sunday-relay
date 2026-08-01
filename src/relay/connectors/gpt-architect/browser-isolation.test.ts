import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE OPENAI SDK AND ITS CREDENTIAL MUST NEVER REACH THE BROWSER.
 *
 * This walks the ACTUAL import graph from the browser entry point and proves
 * that nothing reachable from it imports `openai` or names an OpenAI
 * credential. A comment or a convention would not survive a refactor; a
 * transitive closure check does.
 */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const BROWSER_ENTRY = join(REPO, 'src', 'relay', 'main.tsx');

const readIfExists = (p: string): string | null => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf8') : null);

/** Resolve a relative import to a real file, trying the usual extensions. */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [
    base, `${base}.ts`, `${base}.tsx`, `${base}.js`,
    join(base, 'index.ts'), join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    const spec = match[1] ?? match[2];
    if (typeof spec === 'string') out.push(spec);
  }
  return out;
}

/** Every file transitively reachable from the browser entry point. */
function browserClosure(): { files: string[]; bareImports: Set<string> } {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const queue = [BROWSER_ENTRY];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readIfExists(file);
    if (source === null) continue;
    for (const spec of importSpecifiers(source)) {
      if (spec.startsWith('.')) {
        const resolved = resolveImport(file, spec);
        if (resolved !== null && !seen.has(resolved)) queue.push(resolved);
      } else if (!spec.endsWith('.css')) {
        bare.add(spec);
      }
    }
  }
  return { files: [...seen], bareImports: bare };
}

describe('the OpenAI SDK is server-only', () => {
  const { files, bareImports } = browserClosure();

  it('walks a real, non-trivial browser closure', () => {
    expect(existsSync(BROWSER_ENTRY)).toBe(true);
    expect(files.length).toBeGreaterThan(50);
  });

  it('no module reachable from the browser imports the OpenAI SDK', () => {
    expect([...bareImports].filter((s) => s === 'openai' || s.startsWith('openai/'))).toEqual([]);
    const offenders = files.filter((f) => {
      const source = readIfExists(f) ?? '';
      return /from\s+['"]openai['"]|require\(\s*['"]openai['"]\s*\)/.test(source);
    });
    expect(offenders, 'these browser-reachable modules import the OpenAI SDK').toEqual([]);
  });

  it('no module reachable from the browser names an OpenAI credential', () => {
    const offenders = files.filter((f) => {
      const source = readIfExists(f) ?? '';
      return /OPENAI_API_KEY|OPENAI_PROMPT_ARCHITECT_MODEL/.test(source);
    });
    expect(offenders, 'these browser-reachable modules name an OpenAI credential').toEqual([]);
  });

  it('no module reachable from the browser reaches the GPT connector', () => {
    const offenders = files.filter((f) => f.includes(join('connectors', 'gpt-architect')));
    expect(offenders, 'the GPT connector must never enter the browser graph').toEqual([]);
  });
});

describe('no VITE-prefixed OpenAI variable exists anywhere', () => {
  it('is absent from every tracked source file and from .env.example', () => {
    const roots = [join(REPO, 'src'), join(REPO, 'relay-bridge'), join(REPO, 'scripts')];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          walk(full);
        } else if (/\.(ts|tsx|mts|mjs|js)$/.test(entry.name)) {
          // Test files legitimately contain the pattern as an ASSERTION that
          // it is absent; only a definition or a use is a violation.
          if (/\.(test|spec)\./.test(entry.name)) continue;
          const source = readFileSync(full, 'utf8');
          // A VITE_ name would be inlined into the browser bundle.
          if (/VITE_[A-Z_]*OPENAI|VITE_OPENAI/.test(source)) offenders.push(full);
        }
      }
    };
    for (const root of roots) if (existsSync(root)) walk(root);
    expect(offenders).toEqual([]);

    const envExample = readIfExists(join(REPO, '.env.example')) ?? '';
    expect(envExample).not.toMatch(/VITE_[A-Z_]*OPENAI/);
  });

  it('the vite client type declarations expose no OpenAI variable', () => {
    const decl = readIfExists(join(REPO, 'src', 'relay', 'vite-env.d.ts')) ?? '';
    expect(decl).not.toContain('OPENAI');
  });
});
