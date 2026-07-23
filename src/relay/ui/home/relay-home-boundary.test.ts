import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src', 'relay', 'ui', 'home');
function walk(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx|css)$/.test(name) ? [full] : [];
  });
}
const files = walk(root).filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'));
const sources = files.map((file) => readFileSync(file, 'utf8')).join('\n');

describe('Relay Home browser and authority boundaries', () => {
  it('has no Node, provider, Relay Core, execution, global-store, or router imports', () => {
    expect(sources).not.toMatch(/from\s+['"]node:/);
    expect(sources).not.toMatch(/fusion-engine|connectors\/|adapters\/|\/core\/|\/mission\/|zustand|react-router/);
    expect(sources).not.toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY|fetch\s*\(/);
  });
  it('does not fabricate execution events or expose secret entry controls', () => {
    expect(sources).not.toMatch(/dispatchAgent|startMission|appendEvent|executeMission/);
    expect(sources).not.toMatch(/type=["']password/);
    expect(sources).not.toMatch(/name=["'][^"']*(api.?key|token|cookie|secret)/i);
    expect(sources).not.toMatch(/access everything/i);
  });
  it('contains explicit desktop, mobile, 320px-safe, full-screen settings, and reduced-motion rules', () => {
    const css = readFileSync(join(root, 'relay-home.css'), 'utf8');
    expect(css).toContain('overflow-x:hidden');
    expect(css).toContain('@media(max-width:700px)');
    expect(css).toContain('@media(max-width:360px)');
    expect(css).toContain('.rh-settings-overlay');
    expect(css).toContain('@media(prefers-reduced-motion:reduce)');
    expect(css).not.toMatch(/\.sidebar|<aside/);
  });
});
