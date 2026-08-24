import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { writeFileAtomic } from '../persistence/atomic-file';

export type ArtifactVisibility = 'OWNER' | 'PARTICIPANTS' | 'PUBLIC';
export interface ArtifactRecord { id: string; projectId: string; ownerPlayerId: string; battleId: string | null; visibility: ArtifactVisibility; mediaType: string; path: string; createdAt: string; }
export interface ArtifactStore { put(record: Omit<ArtifactRecord, 'path'>, bytes: Uint8Array): ArtifactRecord; read(id: string, principal: { playerId: string; projectIds: readonly string[]; battleIds: readonly string[] }, signedToken: string): Uint8Array | null; sign(id: string, playerId: string, expiresAt: number): string; }

export function createFileArtifactStore(root: string, signingSecret: string): ArtifactStore {
  if (signingSecret.length < 32) throw new Error('Artifact signing secret must contain at least 32 characters.');
  const dir = resolve(root); mkdirSync(dir, { recursive: true }); const indexPath = join(dir, 'artifacts.index.json');
  let loaded: ArtifactRecord[] = []; try { if (existsSync(indexPath)) loaded = JSON.parse(readFileSync(indexPath, 'utf8')) as ArtifactRecord[]; } catch { loaded = []; }
  const records = new Map(loaded.filter((record) => record.path.startsWith(dir + sep)).map((record) => [record.id, record]));
  const mac = (value: string) => createHmac('sha256', signingSecret).update(value).digest('hex');
  return {
    put(input, bytes) { const path = resolve(join(dir, encodeURIComponent(input.id))); if (!path.startsWith(dir + sep) || path === indexPath) throw new Error('Invalid artifact id.'); writeFileSync(path, bytes, { mode: 0o600 }); const record = { ...input, path }; records.set(input.id, record); writeFileAtomic(indexPath, JSON.stringify([...records.values()])); return record; },
    sign(id, playerId, expiresAt) { const payload = `${id}.${playerId}.${expiresAt}`; return `${payload}.${mac(payload)}`; },
    read(id, principal, token) { const record = records.get(id); if (!record || !principal.projectIds.includes(record.projectId)) return null; const parts = token.split('.'); if (parts.length !== 4 || parts[0] !== id || parts[1] !== principal.playerId || !/^\d+$/.test(parts[2]) || Number(parts[2]) < Date.now()) return null; const payload = parts.slice(0, 3).join('.'); const expected = Buffer.from(mac(payload)); const actual = Buffer.from(parts[3]); if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null; const allowed = record.visibility === 'PUBLIC' || record.ownerPlayerId === principal.playerId || (record.visibility === 'PARTICIPANTS' && record.battleId !== null && principal.battleIds.includes(record.battleId)); return allowed ? readFileSync(record.path) : null; },
  };
}
