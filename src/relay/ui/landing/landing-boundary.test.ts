import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const directory = join(process.cwd(), 'src', 'relay', 'ui', 'landing');
const productionFiles = readdirSync(directory)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes('.test.'))
  .map((name) => [name, readFileSync(join(directory, name), 'utf8')] as const);

describe('Relay landing browser boundary', () => {
  it('has no Node, provider, core execution, store, persistence, or global routing imports', () => {
    for (const [name, source] of productionFiles) {
      expect(source, name).not.toMatch(/from\s+['"]node:/);
      expect(source, name).not.toMatch(/fusion-engine|connectors|workspace|mission\/|state\/store|server\//);
      expect(source, name).not.toMatch(/localStorage|sessionStorage|fetch\(|WebSocket|EventSource/);
      expect(source, name).not.toMatch(/OPENAI|ANTHROPIC|SUPABASE|API_KEY/);
    }
  });

  it('uses explicit host callbacks and contains no credential fields', () => {
    const component = productionFiles.find(([name]) => name === 'RelayLanding.tsx')?.[1] ?? '';
    const types = productionFiles.find(([name]) => name === 'types.ts')?.[1] ?? '';
    expect(types).toContain('onConnectProject?:');
    expect(types).toContain('onStart?:');
    expect(types).toContain('onOpenTerminal?:');
    expect(component).not.toMatch(/type=["']password/);
    expect(component).not.toMatch(/(?:label|name|placeholder)=["'][^"']*(?:credential|api.?key|token|secret)/i);
  });
});
