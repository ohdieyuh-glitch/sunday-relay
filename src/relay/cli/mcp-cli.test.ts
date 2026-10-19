import { describe, expect, it } from 'vitest';

import {
  MCP_REGISTRY_FIXTURES, projectApprovals, projectCatalog, projectConnections,
  runMcpMissionPreflight,
} from '../mcp';
import { EXIT } from './exit-codes';
import {
  MCP_CLI_HELP, renderApprovalDecision, renderApprovals, renderCapabilities,
  renderCatalog, renderConnections, renderInspect, renderMissionMcpPreflight,
  renderTestConnection,
} from './mcp-cli';
import { parseCli, runCli, HELP_TEXT, type CliIo } from './main';

const options = { plain: true, width: 80 };

function capture(): { io: CliIo; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    io: { out: (line) => { lines.push(line); }, isTTY: false, env: {} },
  };
}

/* ==================================================================== *
 * PARSING
 * ==================================================================== */

describe('relay mcp argument parsing', () => {
  it('parses every documented action', () => {
    for (const action of ['catalog', 'connections', 'approvals']) {
      const parsed = parseCli(['mcp', action]);
      expect(parsed.command).toBe('mcp');
      expect(parsed.mcpAction).toBe(action);
      expect(parsed.error).toBeUndefined();
    }
  });

  it('parses the actions that take an id', () => {
    for (const action of ['inspect', 'capabilities', 'test-connection', 'approve', 'revoke']) {
      const parsed = parseCli(['mcp', action, 'mcn_abc']);
      expect(parsed.mcpAction, action).toBe(action);
      expect(parsed.mcpRef, action).toBe('mcn_abc');
      expect(parsed.error, action).toBeUndefined();
    }
  });

  it('REFUSES an unknown action and lists the real ones', () => {
    const parsed = parseCli(['mcp', 'install-anything']);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain('catalog');
  });

  it('REFUSES an id-taking action with no id', () => {
    expect(parseCli(['mcp', 'inspect']).error).toContain('requires an id');
  });

  it('there is deliberately NO `mcp add` / `mcp install` command', () => {
    // Private beta: only curated entries are connectable, so there is no
    // arbitrary-server installation path to parse in the first place.
    for (const action of ['add', 'install', 'connect-url', 'register']) {
      expect(parseCli(['mcp', action]).error, action).toBeDefined();
    }
  });

  it('parses `mission mcp preflight <mission-id>`', () => {
    const parsed = parseCli(['mission', 'mcp', 'preflight', 'msn-1']);
    expect(parsed.command).toBe('mission');
    expect(parsed.missionAction).toBe('mcp');
    expect(parsed.missionRef).toBe('msn-1');
    expect(parsed.error).toBeUndefined();
  });

  it('refuses `mission mcp` without preflight', () => {
    expect(parseCli(['mission', 'mcp']).error).toContain('preflight');
  });
});

/* ==================================================================== *
 * HELP
 * ==================================================================== */

describe('help', () => {
  it('documents every MCP command', () => {
    for (const command of ['mcp catalog', 'mcp connections', 'mcp inspect', 'mcp capabilities',
      'mcp test-connection', 'mcp approvals', 'mcp approve', 'mcp revoke', 'mission mcp preflight']) {
      expect(HELP_TEXT, command).toContain(command);
    }
  });

  it('the MCP help fragment lists the same commands', () => {
    expect(MCP_CLI_HELP.length).toBe(9);
  });
});

/* ==================================================================== *
 * RENDERING
 * ==================================================================== */

describe('relay mcp catalog', () => {
  const rows = projectCatalog(MCP_REGISTRY_FIXTURES);
  const lines = renderCatalog(rows, options).join('\n');

  it('labels EVERY fixture as a simulation', () => {
    const simulationLines = lines.split('\n').filter((line) => line.includes('SIMULATION FIXTURE'));
    expect(simulationLines.length).toBe(rows.length);
  });

  it('states the private-beta policy plainly', () => {
    expect(lines).toContain('only curated entries may be connected');
    expect(lines).toContain('no marketplace');
  });

  it('marks non-connectable entries as such', () => {
    expect(lines).toContain('NOT connectable');
  });

  it('shows the executable NAME, never a resolved path', () => {
    expect(lines).toContain('relay-fixture-repository');
    expect(lines).not.toContain('/tmp/');
    expect(lines).not.toMatch(/\/home\//);
  });

  it('never prints a token or an authorization header', () => {
    expect(lines).not.toMatch(/Bearer |ghp_|sk-|Authorization:/);
  });
});

describe('relay mcp connections', () => {
  it('reports the truthful empty state rather than inventing a connector', () => {
    const lines = renderConnections(projectConnections([], MCP_REGISTRY_FIXTURES), options).join('\n');
    expect(lines).toContain('no MCP connections are configured');
  });
});

describe('relay mcp inspect', () => {
  it('is a usage error for an unknown connection', () => {
    const result = renderInspect(null, 'mcn_nope', options);
    expect(result.exitCode).toBe(EXIT.usage);
    expect(result.lines.join('\n')).toContain('mcn_nope');
  });
});

describe('relay mcp capabilities', () => {
  it('reports honestly that no snapshot has been captured, and does not exit 0', () => {
    const result = renderCapabilities(null, 'mcn_nope', options);
    expect(result.exitCode).toBe(EXIT.blocked);
    expect(result.lines.join('\n')).toContain('No capability snapshot');
  });
});

describe('relay mcp test-connection', () => {
  it('fails truthfully for an unknown connection and exits non-zero', () => {
    const result = renderTestConnection({
      connectionId: 'mcn_nope',
      reachable: false,
      negotiatedProtocolVersion: null,
      identityVerified: false,
      failureCategory: 'capability_missing',
      failureMessage: 'no such connection',
      simulation: true,
    }, options);
    expect(result.exitCode).toBe(EXIT.doctorFailure);
    const text = result.lines.join('\n');
    expect(text).toContain('[FAIL] transport reachable');
    expect(text).toContain('CONNECTION TEST FAILED');
  });
});

describe('relay mcp approvals / approve / revoke', () => {
  it('reports the truthful empty state', () => {
    expect(renderApprovals(projectApprovals([]), options).join('\n')).toContain('no MCP approvals');
  });

  it('refuses to approve an id that does not exist', () => {
    const result = renderApprovalDecision('approve', 'mca_nope', { ok: false, reason: 'no such approval' });
    expect(result.exitCode).toBe(EXIT.usage);
  });

  it('states that an approval does not widen', () => {
    const result = renderApprovalDecision('approve', 'mca_1', { ok: true, reason: '' });
    expect(result.lines.join('\n')).toContain('does not widen');
  });
});

describe('relay mission mcp preflight', () => {
  const preflight = (requirements: Parameters<typeof runMcpMissionPreflight>[0]['binding']['requirements']) =>
    runMcpMissionPreflight({
      binding: {
        missionBindingId: 'mcb_x' as never,
        missionId: 'msn-1',
        accountId: 'a',
        workspaceId: 'w',
        projectId: null,
        requirements,
        approvedSnapshots: {},
        writablePathPrefixes: [],
        createdAt: '2026-08-02T12:00:00.000Z',
      },
      registry: MCP_REGISTRY_FIXTURES,
      connections: [],
      snapshots: { get: () => null },
      credentials: [],
      grants: [],
      approvals: [],
      networkPolicyAllows: () => true,
      now: '2026-08-02T12:00:00.000Z',
    });

  it('a mission with NO MCP requirements is READY and exits 0', () => {
    const result = renderMissionMcpPreflight('msn-1', preflight([]), options);
    expect(result.exitCode).toBe(EXIT.completed);
    expect(result.lines.join('\n')).toContain('READY');
  });

  it('a missing REQUIRED connector BLOCKS and exits non-zero', () => {
    const result = renderMissionMcpPreflight('msn-1', preflight([{
      registryEntryId: 'mrg_fixture_filesystem_repository',
      required: true,
      capabilities: [],
      requiredScopes: [],
      preApprovedOperations: [],
      minimumProtocolRevision: '2025-11-25',
    }]), options);
    expect(result.exitCode).toBe(EXIT.blocked);
    const text = result.lines.join('\n');
    expect(text).toContain('BLOCK');
    expect(text).toContain('readiness is BLOCKED');
  });

  it('a missing OPTIONAL connector DEGRADES and still exits 0', () => {
    const result = renderMissionMcpPreflight('msn-1', preflight([{
      registryEntryId: 'mrg_fixture_filesystem_repository',
      required: false,
      capabilities: [],
      requiredScopes: [],
      preApprovedOperations: [],
      minimumProtocolRevision: '2025-11-25',
    }]), options);
    expect(result.exitCode).toBe(EXIT.completed);
    expect(result.lines.join('\n')).toContain('DEGRADED');
  });
});

/* ==================================================================== *
 * END TO END THROUGH runCli
 * ==================================================================== */

describe('runCli routes the MCP commands', () => {
  it('`relay mcp catalog` prints the curated registry', async () => {
    const { io, lines } = capture();
    const code = await runCli(['mcp', 'catalog', '--plain'], io);
    expect(code).toBe(EXIT.completed);
    expect(lines.join('\n')).toContain('RELAY MCP CATALOG');
  });

  it('`relay mcp connections --json` emits structured output with no secret', async () => {
    const { io, lines } = capture();
    const code = await runCli(['mcp', 'connections', '--json'], io);
    expect(code).toBe(EXIT.completed);
    const payload = JSON.parse(lines.join('')) as { connections: unknown[] };
    expect(Array.isArray(payload.connections)).toBe(true);
    expect(lines.join('')).not.toMatch(/Bearer |ghp_|sk-/);
  });

  it('`relay mission mcp preflight` runs and reports readiness', async () => {
    const { io, lines } = capture();
    const code = await runCli(['mission', 'mcp', 'preflight', 'msn-1', '--plain'], io);
    expect(code).toBe(EXIT.completed);
    expect(lines.join('\n')).toContain('RELAY MISSION MCP PREFLIGHT');
  });

  it('an unknown mcp action is a usage error', async () => {
    const { io } = capture();
    expect(await runCli(['mcp', 'install-github'], io)).toBe(EXIT.usage);
  });
});
