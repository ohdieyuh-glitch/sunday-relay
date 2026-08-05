/**
 * FAKE MCP SERVER — SPAWNED STDIO CHILD ENTRY POINT (TEST FIXTURE).
 *
 * This file is executed as a REAL CHILD PROCESS by
 * `src/relay/mcp/transports/stdio-transport.ts`, which is what makes the stdio
 * tests prove real behaviour: a real spawn, a real process group, real pipes,
 * real JSON-RPC over stdin/stdout, and a real exit.
 *
 * IT RUNS WITH AN EMPTY ENVIRONMENT. Relay builds the child environment from
 * nothing and forwards only what a registry entry allowlisted, so this file may
 * rely on NO inherited variable — not PATH, not HOME, not NODE_OPTIONS. The
 * only variable it reads is `RELAY_FIXTURE_SCENARIO`, which the fixture
 * registry entries explicitly allowlist. A scenario test asserts that
 * `process.env` here contains nothing else.
 *
 * THREE SCENARIOS DELIBERATELY VIOLATE THE PROTOCOL, before any SDK server is
 * connected — they exist to prove Relay classifies them DISTINCTLY:
 *
 *   protocol_mismatch  answers `initialize` with a revision Relay refuses,
 *                      by hand, because a correct SDK server cannot produce
 *                      one. This is what separates `protocol_mismatch` from
 *                      `malformed_response`.
 *   malformed_message  writes bytes to stdout that are not JSON-RPC at all.
 *   process_crash      exits non-zero part-way through a session.
 *
 * Those three are the only places any JSON is written by hand, and they are
 * fixtures whose entire job is to be wrong. Everything else uses the SDK.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createFakeMcpServer, FAKE_SERVER_NAMES, FAKE_SERVER_VERSION } from './fake-mcp-server.mjs';

const scenario = process.env.RELAY_FIXTURE_SCENARIO ?? 'clean_read_only';
const serverName = process.env.RELAY_FIXTURE_SERVER_NAME ?? FAKE_SERVER_NAMES.repository;

/* ------------------------------------------------------------------ *
 * Deliberate protocol violations.
 * ------------------------------------------------------------------ */

if (scenario === 'malformed_message') {
  // Not JSON-RPC. Not even JSON. Relay must classify this `non_mcp_stdout`
  // and must never let it become a successful anything.
  process.stdout.write('relay-fixture: starting up, this banner is not MCP\n');
  process.stdout.write('{"this":"is json but has no jsonrpc member"}\n');
  // Stay alive so the failure is "the channel is corrupt", not "it exited".
  setInterval(() => {}, 1_000);
} else if (scenario === 'protocol_mismatch') {
  // Answer `initialize` with a revision Relay refuses. Written by hand because
  // a correct SDK server will not emit one — see the module docstring.
  let buffer = '';
  process.stdin.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
      if (line.trim() === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.method === 'initialize') {
        process.stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            // A real revision Relay knows about and refuses as a production
            // baseline, so the refusal message can name it precisely.
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: serverName, version: FAKE_SERVER_VERSION },
          },
        })}\n`);
      }
    }
  });
  process.stdin.resume();
} else {
  const server = createFakeMcpServer({ scenario, serverName });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  if (scenario === 'process_crash') {
    // Crash shortly after the handshake, so the connection reaches `ready`
    // and then dies — the case where a partial result must never be recorded
    // as a completion.
    setTimeout(() => { process.exit(9); }, 150);
  }
}
