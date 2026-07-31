import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Usage-domain boundary — the canonical usage snapshot stays a PURE domain
 * module: no React, no browser APIs, no clock reads, no network, and no
 * dependency on the UI it feeds. Mirrors the demo-simulation boundary test.
 */

const ROOT = __dirname;
const sources = readdirSync(ROOT)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes('.test.'))
  .map((name) => ({ name, source: readFileSync(join(ROOT, name), 'utf8') }));
const combined = sources.map((f) => f.source).join('\n');

describe('usage domain boundary', () => {
  it('scans the real module files', () => {
    expect(sources.length).toBeGreaterThanOrEqual(4);
  });

  it('imports no React and no UI — the dependency points the other way', () => {
    expect(combined).not.toMatch(/from\s+['"]react/);
    expect(combined).not.toMatch(/from\s+['"][^'"]*\/ui\//);
    expect(combined).not.toMatch(/\.tsx['"]/);
  });

  it('reads no clock — time is always an injected ISO string', () => {
    expect(combined).not.toMatch(/Date\.now\s*\(/);
    expect(combined).not.toMatch(/new Date\(\)/);
  });

  it('touches no browser API, storage, network, or timer', () => {
    expect(combined).not.toMatch(
      /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|document\.[a-zA-Z]|window\.[a-zA-Z]/,
    );
    expect(combined).not.toMatch(/setTimeout|setInterval/);
    expect(combined).not.toMatch(/relay-api/);
  });

  it('imports no provider, adapter, server, or Node built-in', () => {
    expect(combined).not.toMatch(/from\s+['"]node:/);
    expect(combined).not.toMatch(
      /(?:from|import)\s*['"][^'"]*(?:relay-bridge|connectors|openai|anthropic|server)\//i,
    );
    expect(combined).not.toMatch(/api\.anthropic\.com|api\.openai\.com/);
  });

  it('never converts missing usage into zero', () => {
    // The projection may bound REAL numbers, but no code path may replace a
    // null figure with a numeric zero for display.
    expect(combined).not.toMatch(/percentUsed\s*\?\?\s*0/);
    expect(combined).not.toMatch(/remaining\s*\?\?\s*0/);
  });
});
