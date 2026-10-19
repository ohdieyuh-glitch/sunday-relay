import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = __dirname;
const sourceFiles = readdirSync(ROOT)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx'))
  .map((name) => ({ name, source: readFileSync(join(ROOT, name), 'utf8') }));
const combined = sourceFiles.map((file) => file.source).join('\n');

describe('Demo Simulation browser-only boundary', () => {
  it('does not import or invoke live orchestration, providers, connectors, persistence, or attestations', () => {
    expect(combined).not.toMatch(
      /(?:from|import)\s*['"][^'"]*(?:relay-bridge|openai|anthropic|claude-runtime|hermes-reviewer|live-adapter|persistence)|beginLiveMission\s*\(|cancelLiveMission\s*\(|pollLiveMission\s*\(|createExecutionAttestation\s*\(/i,
    );
  });

  it('has no network, shell, process, storage, or production mission side effects', () => {
    expect(combined).not.toMatch(
      /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|child_process|execFile|spawn\s*\(|localStorage|sessionStorage|createDraftFromRequest|startProject|resetAll/,
    );
  });

  it('uses only the dedicated simulated truth class and non-production identifier', () => {
    expect(combined).toContain("'simulated_demo'");
    expect(combined).toContain('demo-simulation:normalize-project-name:');
    expect(combined).not.toContain("truthClass: 'live'");
  });
});
