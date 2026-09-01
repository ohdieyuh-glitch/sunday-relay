import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { JULIUS_OPERATIONAL_EVENT_TYPES, JULIUS_TRAJECTORY_KINDS, JuliusRuntimeApi } from '../julius';
import { createJuliusMemoryStore } from '../julius';
import type { JuliusCardPolicy, JuliusPolicyOperation } from '../julius';

/**
 * THE ARCHITECTURAL BOUNDARY, ASSERTED IN BOTH DIRECTIONS.
 *
 * `/gauntletloop` is a user-activated review command. It may use generic
 * infrastructure; Julius may not know it exists. That is one rule with two
 * halves, and only checking one half is how the coupling came back last time:
 *
 *     Gauntlet  ──uses──▶  generic interfaces      ALLOWED
 *     Julius    ──uses──▶  Gauntlet                FORBIDDEN
 *
 * The checks below read the SOURCE of both directories, because an import is
 * the thing that actually creates coupling and a type name is not.
 */

const JULIUS_DIR = join(__dirname, '..', 'julius');
const GAUNTLET_DIR = __dirname;
const PERSISTENCE_DIR = join(__dirname, '..', '..', 'persistence');

const sourcesIn = (dir: string, filter: (name: string) => boolean = () => true) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && filter(name))
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));

/* ============ 6. Julius contains no Gauntlet-specific API ============== */

describe('Julius does not know the Gauntlet Loop exists', () => {
  const juliusSources = sourcesIn(JULIUS_DIR);

  it('imports nothing from the gauntlet directory', () => {
    for (const source of juliusSources) {
      const imports = [...source.text.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]!);
      for (const specifier of imports) {
        expect(specifier, `${source.name} imports ${specifier}`).not.toMatch(/gauntlet/i);
      }
    }
  });

  it('names no gauntlet identifier in any production source', () => {
    // Comments explaining the boundary are allowed and are the only place the
    // word may appear; an identifier is not.
    const stripComments = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const source of juliusSources.filter((entry) => !entry.name.endsWith('.test.ts'))) {
      const code = stripComments(source.text);
      expect(code.toLowerCase(), `${source.name} names a gauntlet identifier`).not.toContain('gauntlet');
    }
  });

  it('exposes no gauntlet method on the execution API', () => {
    const methods = Object.getOwnPropertyNames(JuliusRuntimeApi.prototype);
    for (const method of methods) {
      expect(method.toLowerCase(), `${method} is a gauntlet API`).not.toContain('gauntlet');
    }
    for (const forbidden of ['inspectGauntlet', 'startGauntlet', 'resumeGauntlet', 'gauntletState', 'gauntletCheckpoint']) {
      expect(methods, forbidden).not.toContain(forbidden);
    }
  });

  it('declares no gauntlet event type or trajectory kind', () => {
    for (const type of JULIUS_OPERATIONAL_EVENT_TYPES) {
      expect(type.toLowerCase(), type).not.toContain('gauntlet');
    }
    for (const kind of JULIUS_TRAJECTORY_KINDS) {
      expect(kind.toLowerCase(), kind).not.toContain('gauntlet');
    }
  });

  it('has no gauntlet field on the C.A.R.D. policy', () => {
    // The BOUND is generic — a deployment may limit how many times work is
    // reviewed again — and the FEATURE that uses it is not Julius's.
    const policy: JuliusCardPolicy = {
      revision: 'r', autonomy: 'AUTONOMOUS', allowedProviders: [], capabilities: [],
      network: false, filesystemMutation: false, fallback: false, automaticRetry: false,
      subagents: { allowed: false, maxDepth: 1, maxActive: 1, maxTotal: 1 },
      iterativeReview: { allowed: true, maxRounds: 3 }, concurrency: 1, approvals: [],
    };
    for (const key of Object.keys(policy)) {
      expect(key.toLowerCase(), key).not.toContain('gauntlet');
    }
    const operation: JuliusPolicyOperation = 'CONTINUE_ITERATIVE_REVIEW';
    expect(operation).toBe('CONTINUE_ITERATIVE_REVIEW');
  });

  it('carries no gauntlet store on the runtime store', () => {
    const store = createJuliusMemoryStore();
    for (const method of Object.keys(store)) {
      expect(method.toLowerCase(), `${method} is a gauntlet store method`).not.toContain('gauntlet');
    }
  });

  it('has no gauntlet table inside the Julius namespace', () => {
    const migrations = readdirSync(join(PERSISTENCE_DIR, 'wonderland-migrations'))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => ({ name, text: readFileSync(join(PERSISTENCE_DIR, 'wonderland-migrations', name), 'utf8') }));
    for (const migration of migrations) {
      expect(migration.text, `${migration.name} creates a julius_gauntlet table`)
        .not.toContain('relay_wonderland.julius_gauntlet');
    }
    // And no Julius repository reads or writes a gauntlet.
    for (const source of sourcesIn(PERSISTENCE_DIR, (name) => name.startsWith('julius'))) {
      expect(source.text.toLowerCase(), `${source.name} touches a gauntlet`).not.toContain('gauntlet');
    }
  });
});

/* ============ the allowed direction, and only the allowed one ========== */

describe('the gauntlet depends on generic interfaces, not on Julius', () => {
  const gauntletSources = sourcesIn(GAUNTLET_DIR, (name) => !name.endsWith('.test.ts'));

  it('imports nothing from the Julius directory', () => {
    for (const source of gauntletSources) {
      const imports = [...source.text.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]!);
      for (const specifier of imports) {
        expect(specifier, `${source.name} imports ${specifier}`).not.toMatch(/julius/i);
      }
    }
  });

  it('names no Julius identifier in its production source', () => {
    const stripComments = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const source of gauntletSources) {
      expect(stripComments(source.text).toLowerCase(), `${source.name} names Julius`)
        .not.toContain('julius');
    }
  });

  it('declares its work and review needs in its own vocabulary', () => {
    const ports = readFileSync(join(GAUNTLET_DIR, 'gauntlet-ports.ts'), 'utf8');
    for (const generic of ['GauntletWorkPort', 'GauntletReviewPort', 'GauntletPolicy']) {
      expect(ports, generic).toContain(generic);
    }
    // Not a mission state machine, not a task graph, not a scheduler, not a
    // lease — anything of those would be a Julius interface renamed.
    for (const leaked of ['MissionState', 'TaskGraph', 'claimRunnable', 'leaseGeneration', 'CardPolicy']) {
      expect(ports, `${leaked} leaked into the gauntlet's ports`).not.toContain(leaked);
    }
  });
});
