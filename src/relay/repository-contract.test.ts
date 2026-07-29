import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { repositorySlug, YC_EXPECTED_REPOSITORY, YC_FORBIDDEN_REPOSITORIES } from './yc';

/**
 * Repository contract — the properties the separation established, asserted
 * from inside the product so integration work cannot quietly undo them.
 *
 * Repository separation is only worth doing once. These tests are what stop
 * a later integration from re-importing Alcatraz implementation, dropping the
 * governance artifacts, or pointing Relay back at the other product's remote.
 */

const ROOT = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Read-only git; returns null when git is unavailable (never fails the run
 * for an environmental reason). */
function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

describe('repository identity', () => {
  it('origin identifies sunday-relay', () => {
    const url = git(['remote', 'get-url', 'origin']);
    if (url === null) return;                        // no git in this environment
    expect(repositorySlug(url)).toBe(YC_EXPECTED_REPOSITORY);
  });

  it('turbo-broccoli is rejected as a Relay origin', () => {
    for (const forbidden of YC_FORBIDDEN_REPOSITORIES) {
      expect(repositorySlug(`https://github.com/${forbidden}.git`)).not.toBe(YC_EXPECTED_REPOSITORY);
      expect(YC_FORBIDDEN_REPOSITORIES).toContain(forbidden);
    }
    const url = git(['remote', 'get-url', 'origin']);
    if (url === null) return;
    for (const forbidden of YC_FORBIDDEN_REPOSITORIES) {
      expect(repositorySlug(url)).not.toBe(forbidden);
    }
  });

  it('package metadata names the independent Relay repository', () => {
    const pkg = JSON.parse(read('package.json')) as {
      name: string; description: string; repository: { url: string }; bin?: Record<string, string>;
    };
    expect(pkg.name).toBe('sunday-relay');
    expect(pkg.description).toContain('Sunday Relay');
    expect(pkg.repository.url).toContain('sunday-relay');
    expect(pkg.repository.url).not.toContain('turbo-broccoli');
  });
});

describe('no Alcatraz implementation entered the product repository', () => {
  const FORBIDDEN_TREES = [
    'server', 'api', 'supabase', 'migrations',
    join('src', 'fusion-engine'), join('src', 'server'), join('src', 'api'),
    join('src', 'components'), join('src', 'screens'),
  ];

  it('carries none of the Alcatraz product trees', () => {
    for (const tree of FORBIDDEN_TREES) {
      expect(existsSync(join(ROOT, tree)), `${tree} must not exist in Relay`).toBe(false);
    }
  });

  it('carries no Alcatraz deployment configuration', () => {
    for (const file of ['vercel.json', 'netlify.toml', 'fly.toml', 'Dockerfile', 'railway.json']) {
      expect(existsSync(join(ROOT, file)), `${file} must not exist in Relay`).toBe(false);
    }
  });

  it('src/ contains the Relay product and nothing else', () => {
    const entries = readdirSync(join(ROOT, 'src')).filter((e) => statSync(join(ROOT, 'src', e)).isDirectory());
    expect(entries).toEqual(['relay']);
  });

  it('no Relay source imports an Alcatraz module', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
    const forbidden: Array<[RegExp, string]> = [
      [/from\s+['"][^'"]*\/fusion-engine/, 'the Alcatraz fusion engine'],
      [/from\s+['"]@\/state\/|from\s+['"][^'"]*\/state\/session/, 'the Alcatraz session store'],
      [/from\s+['"]@\/components\//, 'Alcatraz UI components'],
      [/from\s+['"]@\/styles\//, 'the Alcatraz stylesheet'],
    ];
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, 'src', 'relay'))) {
      if (/\.test\.tsx?$/.test(file)) continue;
      const content = readFileSync(file, 'utf8');
      for (const [pattern, why] of forbidden) {
        if (pattern.test(content)) offenders.push(`${file} imports ${why}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('governance survives integration', () => {
  it('the governance document is present and still states the merge policy', () => {
    const governance = read('docs/REPOSITORY_GOVERNANCE.md');
    expect(governance).toContain('Repository Governance — Sunday Relay');
    expect(governance).toContain('Squash merge only');
    expect(governance).toContain('ohdieyuh-glitch/sunday-relay');
    expect(governance).toContain('ohdieyuh-glitch/turbo-broccoli');
    expect(governance).toContain('founder authorization');
    expect(governance).toContain('auto-merge is off');
  });

  it('the PR template is present and still requires the founder gate', () => {
    const template = read('.github/PULL_REQUEST_TEMPLATE.md');
    expect(template).toContain('This PR targets Sunday Relay only');
    expect(template).toContain('must be squash-merged');
    expect(template).toContain('Do not merge without founder authorization');
    expect(template).toContain('Independent Review');
  });

  it('the boundary scanner is present and executable by CI', () => {
    expect(existsSync(join(ROOT, 'scripts/relay-repository-boundary.mjs'))).toBe(true);
    expect(read('scripts/relay-repository-boundary.mjs')).toContain('RELAY REPOSITORY BOUNDARY');
  });

  it('Relay CI is present, independent, and never deploys', () => {
    const ci = read('.github/workflows/relay-ci.yml');
    expect(ci).toContain('name: Relay CI');
    expect(ci).toContain('node scripts/relay-repository-boundary.mjs');
    expect(ci).toContain('npm run typecheck');
    expect(ci).toContain('npm test');
    // Safe trigger and least privilege.
    expect(ci).not.toContain('pull_request_target');
    expect(ci).toContain('permissions:');
    expect(ci).toContain('contents: read');
    // No secret reaches this workflow at all.
    expect(ci).not.toMatch(/\$\{\{\s*secrets\./);
  });

  it('CI runs parity for real — no existence guard that can switch it off', () => {
    const ci = read('.github/workflows/relay-ci.yml');
    expect(ci).toContain('npm run relay:surface-parity:check');
    expect(ci).toContain('npm run relay:surface-parity:check:strict');
    expect(ci).toContain('node scripts/relay-parity-gate.mjs');
    expect(ci).not.toContain('no parity registry in this tree — skipping');
    expect(ci).not.toContain('no relay-bridge in this tree — skipping');
  });
});
