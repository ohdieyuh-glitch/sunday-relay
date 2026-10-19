import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * MCP ARCHITECTURAL BOUNDARIES (§3, §28).
 *
 * These are STRUCTURAL tests over the real source tree, not assertions about
 * intent. Each one names the offending file when it fails, because a boundary
 * violation that reports "boundary broken" costs an hour to locate.
 *
 * The three properties they hold:
 *
 *   1. the MCP SDK lives BELOW the adapter boundary — only `client/` and
 *      `transports/` may import it;
 *   2. process, network and credential code is SERVER-ONLY — no browser module
 *      may reach it, and the MCP domain/policy/registry/mission/psp layers stay
 *      pure enough for the website to import;
 *   3. nothing durable holds a live handle, a raw secret, an executable path
 *      or an unrestricted MCP result.
 */

const ROOT = resolve(__dirname, '..', '..', '..');
const MCP_DIR = join(ROOT, 'src', 'relay', 'mcp');

const rel = (file: string): string => relative(ROOT, file).split(sep).join('/');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|mts|mjs)$/.test(name) ? [full] : [];
  });
}

const read = (file: string): string => readFileSync(file, 'utf8');

/**
 * Comments are STRIPPED before any source assertion.
 *
 * Without this, these tests fail on their own subject matter: the process
 * transport's docstring explains why it does not call `getDefaultEnvironment`,
 * the barrel's docstring explains why it does not re-export `../transports/`,
 * and a rule that cannot tell an explanation from a violation is a rule that
 * punishes documenting the decision. Every assertion below is about CODE.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const code = (file: string): string => stripComments(read(file));

const ALL_MCP_FILES = walk(MCP_DIR);

/**
 * PRODUCTION files only — `.test.ts` is excluded deliberately.
 *
 * A test file legitimately contains the very strings these rules forbid: this
 * file greps for `@modelcontextprotocol/sdk` and `child_process`, so scanning
 * itself would make every rule fail against its own implementation. Test files
 * are also not shipped: they are not reachable from a browser entry and are not
 * in the CLI or website bundle, which is what the rules are protecting.
 */
const PRODUCTION_MCP_FILES = ALL_MCP_FILES.filter((file) => !/\.test\.[cm]?tsx?$/.test(file));

/** Directories permitted to import the SDK. */
const SDK_ALLOWED_PREFIXES = [
  'src/relay/mcp/transports/',
  'src/relay/mcp/testing/',
];

/* ==================================================================== *
 * 1. THE SDK ADAPTER BOUNDARY
 * ==================================================================== */

describe('the MCP SDK stays below the adapter boundary', () => {
  it('finds MCP source files to check', () => {
    expect(ALL_MCP_FILES.length).toBeGreaterThan(15);
    expect(PRODUCTION_MCP_FILES.length).toBeGreaterThan(15);
  });

  it('ONLY the transport and fixture layers import @modelcontextprotocol/sdk', () => {
    const offenders = PRODUCTION_MCP_FILES
      .filter((file) => /@modelcontextprotocol\/sdk/.test(code(file)))
      .map(rel)
      .filter((file) => !SDK_ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix)));
    expect(offenders, `these files import the MCP SDK outside the adapter boundary: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the domain, policy, registry, mission, psp and gateway layers are SDK-free', () => {
    for (const layer of ['domain', 'policy', 'registry', 'mission', 'psp', 'gateway', 'client']) {
      for (const file of walk(join(MCP_DIR, layer))) {
        expect(/@modelcontextprotocol/.test(code(file)), `${rel(file)} imports the SDK`).toBe(false);
      }
    }
  });

  it('no Relay domain type is an alias of an SDK type', () => {
    // A re-exported SDK type would pass the import check while making the
    // domain depend on the SDK's shape anyway.
    for (const file of walk(join(MCP_DIR, 'domain'))) {
      expect(/export .*from ['"]@modelcontextprotocol/.test(code(file)), rel(file)).toBe(false);
    }
  });

  it('the pinned SDK actually speaks Relay\'s baseline revision', async () => {
    // If a dependency bump moved the protocol out from under Relay, this fails
    // rather than the mismatch shipping. See `mcp-sdk-client.ts`.
    const types = await import('@modelcontextprotocol/sdk/types.js');
    expect(types.LATEST_PROTOCOL_VERSION).toBe('2025-11-25');
    // The gap this milestone's own negotiator exists to close: the SDK accepts
    // more than Relay does, so "the SDK connected" is not "the server speaks
    // the revision this mission was verified against".
    expect(types.SUPPORTED_PROTOCOL_VERSIONS.length).toBeGreaterThan(1);
    expect(types.DEFAULT_NEGOTIATED_PROTOCOL_VERSION).not.toBe('2025-11-25');
  }, 30_000);

  it('the SDK is pinned to an EXACT version, not a range', () => {
    const pkg = JSON.parse(read(join(ROOT, 'package.json'))) as { dependencies: Record<string, string> };
    const pinned = pkg.dependencies['@modelcontextprotocol/sdk'];
    expect(pinned).toBeDefined();
    expect(pinned, 'the SDK must be pinned exactly — no ^, ~, * or latest').toMatch(/^\d+\.\d+\.\d+$/);
    expect(pinned!.startsWith('1.'), 'Relay uses the production-supported v1 SDK').toBe(true);
  });
});

/* ==================================================================== *
 * 2. SERVER-ONLY CODE
 * ==================================================================== */

describe('process, network and credential code is server-only', () => {
  const BROWSER_SAFE_LAYERS = ['domain', 'policy', 'registry', 'mission', 'psp', 'gateway'];

  /**
   * Matches the IMPORT, not the substring. `mcp-credential.ts` legitimately
   * declares a credential CLASS called `child_process_env`, and a rule that
   * cannot tell an enum value from an import would force that value to be
   * renamed to satisfy a grep.
   */
  const IMPORTS_CHILD_PROCESS = /(from|import|require\s*\()\s*['"]node:child_process['"]|from\s+['"]child_process['"]/;

  it('no browser-safe MCP layer imports node:child_process', () => {
    for (const layer of BROWSER_SAFE_LAYERS) {
      for (const file of walk(join(MCP_DIR, layer))) {
        expect(IMPORTS_CHILD_PROCESS.test(code(file)), `${rel(file)} imports child_process`).toBe(false);
      }
    }
  });

  it('no browser-safe MCP layer imports any node: builtin', () => {
    for (const layer of BROWSER_SAFE_LAYERS) {
      for (const file of walk(join(MCP_DIR, layer))) {
        const matches = code(file).match(/from\s+['"]node:[a-z/]+['"]/g) ?? [];
        expect(matches, `${rel(file)} imports ${matches.join(', ')}`).toEqual([]);
      }
    }
  });

  it('ONLY the stdio process transport spawns anything', () => {
    const spawners = PRODUCTION_MCP_FILES
      .filter((file) => IMPORTS_CHILD_PROCESS.test(code(file)))
      .map(rel);
    expect(spawners).toEqual(['src/relay/mcp/transports/stdio-process-transport.ts']);
  });

  it('the process transport spawns with shell:false and detached:true', () => {
    const source = code(join(MCP_DIR, 'transports', 'stdio-process-transport.ts'));
    expect(source).toContain('shell: false');
    expect(source).not.toMatch(/shell:\s*true/);
    // detached is what makes process-GROUP termination possible at all.
    expect(source).toContain('detached: true');
    expect(source).toContain('process.kill(-pid');
  });

  it('the process transport never spreads process.env into a child', () => {
    const source = code(join(MCP_DIR, 'transports', 'stdio-process-transport.ts'));
    expect(source).not.toMatch(/\.\.\.process\.env/);
    expect(source).not.toContain('getDefaultEnvironment');
  });

  it('the MCP barrel does not re-export the transports, the client or the fixtures', () => {
    const barrel = code(join(MCP_DIR, 'index.ts'));
    for (const forbidden of ['./transports/', './testing/', './client/']) {
      expect(barrel.includes(forbidden), `the barrel re-exports ${forbidden}`).toBe(false);
    }
  });

  it('the browser MCP component imports only the shared projection and the mission preflight', () => {
    const component = code(join(ROOT, 'src', 'relay', 'ui', 'mcp', 'RelayMcpConnections.tsx'));
    const imports = [...component.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    for (const specifier of imports) {
      const forbidden = /transports|testing|client\/|node:|@modelcontextprotocol/.test(specifier);
      expect(forbidden, `the MCP UI imports ${specifier}`).toBe(false);
    }
  });
});

/* ==================================================================== *
 * 3. SECRETS NEVER ENTER DURABLE STATE
 * ==================================================================== */

describe('secrets, handles and host topology never enter durable Relay state', () => {
  it('no MCP domain record declares a credential-bearing field', () => {
    // The credential domain's own forbidden-field list, applied to the SOURCE
    // of every durable record type.
    const FORBIDDEN_FIELD = /^\s*readonly (accessToken|refreshToken|apiKey|token|secret|password|clientSecret|privateKey|authorization)\??:/m;
    for (const file of walk(join(MCP_DIR, 'domain'))) {
      expect(FORBIDDEN_FIELD.test(code(file)), `${rel(file)} declares a credential field`).toBe(false);
    }
  });

  it('the resolved-credential type exists ONLY on the transport-open path', () => {
    const users = PRODUCTION_MCP_FILES
      .filter((file) => /McpResolvedCredential/.test(code(file)))
      .map(rel);
    for (const file of users) {
      const permitted = file.startsWith('src/relay/mcp/transports/')
        || file === 'src/relay/mcp/domain/mcp-ports.ts'
        || file === 'src/relay/mcp/client/mcp-connection-manager.ts';
      expect(permitted, `${file} references resolved credential material`).toBe(true);
    }
  });

  it('the audit record carries a summary and a fingerprint, never raw arguments or results', () => {
    const source = code(join(MCP_DIR, 'domain', 'mcp-invocation.ts'));
    // The interface must not declare a raw payload field.
    expect(/readonly arguments:/.test(source.split('export interface McpAuditRecord')[1] ?? '')).toBe(false);
    expect(/readonly result:/.test(source.split('export interface McpAuditRecord')[1] ?? '')).toBe(false);
    expect(source).toContain('safeArgumentSummary');
    expect(source).toContain('safeResultSummary');
  });

  it('no VITE_-prefixed name appears anywhere in the MCP subsystem', () => {
    // A VITE_ variable is compiled into the browser bundle. An MCP service
    // token with such a name would be published on the website.
    for (const file of PRODUCTION_MCP_FILES) {
      const matches = code(file).match(/VITE_[A-Z0-9_]*/g) ?? [];
      expect(matches, `${rel(file)} references ${matches.join(', ')}`).toEqual([]);
    }
  });

  it('the surface projection carries no field that could hold a secret or a path', () => {
    const source = code(join(MCP_DIR, 'domain', 'mcp-surface-projection.ts'));
    for (const forbidden of ['token', 'secret', 'password', 'authorization', 'executablePath', 'environment']) {
      expect(new RegExp(`readonly ${forbidden}`, 'i').test(source), `the projection declares ${forbidden}`).toBe(false);
    }
  });
});

/* ==================================================================== *
 * 4. THE REVIEWER'S ISOLATION IS UNCHANGED
 * ==================================================================== */

describe('the Independent Reviewer stays MCP-disabled', () => {
  const profile = join(ROOT, 'relay-bridge', 'reviewer-harness', 'hermes', 'isolated-profile.ts');

  it('the isolated Hermes profile still emits mcp_servers: {}', () => {
    const source = read(profile);
    expect(source).toContain("'mcp_servers: {}'");
  });

  it('this milestone added nothing to the Reviewer harness', () => {
    const source = read(profile);
    expect(/@modelcontextprotocol/.test(source)).toBe(false);
    expect(/src\/relay\/mcp/.test(source)).toBe(false);
  });

  it('no reviewer-harness file imports the MCP subsystem', () => {
    for (const file of walk(join(ROOT, 'relay-bridge', 'reviewer-harness'))) {
      expect(/relay\/mcp/.test(read(file)), `${rel(file)} imports the MCP subsystem`).toBe(false);
    }
  });
});

/* ==================================================================== *
 * 5. NO DEPLOYMENT CONFIGURATION WAS ADDED
 * ==================================================================== */

describe('this milestone deploys nothing', () => {
  it('adds no deployment configuration file', () => {
    for (const name of ['vercel.json', 'railway.json', 'railway.toml', 'fly.toml', 'netlify.toml', 'render.yaml', 'Dockerfile']) {
      expect(existsSync(join(ROOT, name)), `${name} exists`).toBe(false);
    }
  });

  it('no MCP file references a deployment CLI', () => {
    for (const file of PRODUCTION_MCP_FILES) {
      const source = code(file);
      expect(/\b(vercel|railway|flyctl|netlify|wrangler)\s+(deploy|up|--prod)/.test(source), rel(file)).toBe(false);
    }
  });
});
