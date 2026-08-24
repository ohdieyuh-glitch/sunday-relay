import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryWonderlandStore, WonderlandService } from '../src/relay/wonderland';
import { RelayWonderlandPublisher } from '../src/relay/wonderland/relay-integration';
import { createWonderlandHost, handleWonderlandRequest, type WonderlandAuthorizer } from './wonderland-host';

const TOKEN = 'session-p1'; let counter = 0; const now = () => '2026-08-24T12:00:00.000Z';
const authorizer: WonderlandAuthorizer = { authenticate(header) { if (header === `Relay-Session ${TOKEN}`) return { playerId: 'p1', projectRoles: { project1: 'MEMBER' }, agentIds: ['agent1'], cardIds: ['card1'] }; if (header === 'Relay-Session opponent') return { playerId: 'p2', projectRoles: { project1: 'MEMBER' }, agentIds: ['agent2'], cardIds: ['card2'] }; return null; } };
const service = () => new WonderlandService(createMemoryWonderlandStore(), { now, id: (kind) => `${kind}_${++counter}` });
const servers: Server[] = []; afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }))));

async function hosted(api = service()) {
  const host = createWonderlandHost(api, authorizer);
  const server = createServer((req, res) => { const url = new URL(req.url ?? '/', 'http://local'); const chunks: Buffer[] = []; req.on('data', (chunk: Buffer) => chunks.push(chunk)); req.on('end', () => { const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as unknown : undefined; void handleWonderlandRequest({ req, res, method: req.method ?? 'GET', url, body, cors: {}, host }); }); });
  servers.push(server); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server failed'); return { api, host, base: `http://127.0.0.1:${address.port}` };
}
const auth = { authorization: `Relay-Session ${TOKEN}` };
function openSse(response: Response) { const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffered = ''; return { async next(event = 'wonderland') { for (;;) { const boundary = buffered.indexOf('\n\n'); if (boundary >= 0) { const frame = buffered.slice(0, boundary + 2); buffered = buffered.slice(boundary + 2); if (frame.includes(`event: ${event}`)) return frame; continue; } const part = await reader.read(); if (part.done) throw new Error('SSE ended'); buffered += decoder.decode(part.value); } }, close: () => reader.cancel() }; }

describe('hosted Wonderland SSE and commands', () => {
  it('authenticates, commits a command, delivers live, and replays a missed event by cursor', async () => {
    const { base, api } = await hosted(); const response = await fetch(`${base}/relay-api/wonderland/events?projectId=project1&after=0`, { headers: auth }); expect(response.status).toBe(200); const stream = openSse(response); await stream.next('connected');
    const command = await fetch(`${base}/relay-api/wonderland/challenges`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'project1', opponentId: 'p2', mode: 'EVAL', idempotencyKey: 'challenge-1', playerId: 'spoofed', agentId: 'agent1', cardVersionId: 'card1' }) }); expect(command.status).toBe(201); const first = await stream.next(); expect(first).toContain('battle.created'); expect(first).toContain('"playerId":"p1"'); await stream.close();
    api.ingestRelayEvent('real:mission:planning', { projectId: 'project1', missionId: 'mission1', eventType: 'agent.planning' });
    const replayResponse = await fetch(`${base}/relay-api/wonderland/events?projectId=project1&after=1`, { headers: auth }); const replay = openSse(replayResponse); const missed = await replay.next(); expect(missed).toContain('agent.planning'); expect((missed.match(/"sequence":2/g) ?? [])).toHaveLength(1); await replay.close();
  });
  it('fails closed for missing auth, cross-project access, malformed cursors, and Brain reads', async () => {
    const { base } = await hosted(); expect((await fetch(`${base}/relay-api/wonderland/events?projectId=project1&after=0`)).status).toBe(401); expect((await fetch(`${base}/relay-api/wonderland/events?projectId=other&after=0`, { headers: auth })).status).toBe(403); expect((await fetch(`${base}/relay-api/wonderland/events?projectId=project1&after=nope`, { headers: auth })).status).toBe(400); expect((await fetch(`${base}/relay-api/wonderland/brain?projectId=other`, { headers: auth })).status).toBe(403);
  });
  it('redacts secrets at the hosted transport and blocks OWNER telemetry from an opponent', async () => {
    const { base, api } = await hosted(); api.ingestRelayEvent('secret', { projectId: 'project1', missionId: 'm1', playerId: 'p1', eventType: 'battle.telemetry', visibility: 'OWNER', payload: { apiKey: 'sk-abcdefghijklmnop', systemPrompt: 'hidden', safe: 'test passed' } });
    const opponentStream = await fetch(`${base}/relay-api/wonderland/events?projectId=project1&after=0`, { headers: { authorization: 'Relay-Session opponent' } }); const reader = opponentStream.body!.getReader(); const first = await reader.read(); expect(new TextDecoder().decode(first.value)).toContain('connected'); await reader.cancel();
    const ownerResponse = await fetch(`${base}/relay-api/wonderland/events?projectId=project1&after=0`, { headers: auth }); const ownerStream = openSse(ownerResponse); const owner = await ownerStream.next(); expect(owner).toContain('[REDACTED]'); expect(owner).not.toContain('abcdefghijklmnop'); expect(owner).not.toContain('hidden'); await ownerStream.close();
  });
  it('maps a real Relay Mission transition and terminal event into the same transport', async () => {
    const { base, api } = await hosted(); const response = await fetch(`${base}/relay-api/wonderland/events?projectId=project1&after=0`, { headers: auth }); const stream = openSse(response); await stream.next('connected'); const publisher = new RelayWonderlandPublisher(api);
    publisher.publishMission('project1', 'mission-real', { state: 'coding', phase: 'coding', currentRole: 'coding_agent', events: [{ sequence: 1, at: now(), role: 'coding_agent', category: 'coding_agent', truth: 'relay_evidence', headline: 'Coding Agent launched' }] });
    const event = await stream.next(); expect(event).toContain('agent.implementing'); expect(api.state().events.some((item) => item.eventType === 'battle.telemetry')).toBe(true); await stream.close();
  });
  it('rate limits concurrent subscriptions and records connection health', async () => {
    const { base, host } = await hosted(); host.maxSubscriptionsPerPlayer = 1; const one = await fetch(`${base}/relay-api/wonderland/events?projectId=project1&after=0`, { headers: auth }); expect(one.status).toBe(200); const two = await fetch(`${base}/relay-api/wonderland/events?projectId=project1&after=0`, { headers: auth }); expect(two.status).toBe(429); expect(host.metrics.activeSubscriptions).toBe(1); await one.body?.cancel();
  });
});
