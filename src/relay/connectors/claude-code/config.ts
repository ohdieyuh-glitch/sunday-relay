import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectSettingsAssessment } from './contracts';

/**
 * Project configuration risk detection (Prompt 8) — structural only. Reads
 * whether Claude-affecting config EXISTS in a directory, never its contents,
 * to decide whether a repository can run the initial live fixture or needs
 * checkpoint review. CLAUDE.md alone is context, not a permission grant, so
 * it does not force review; settings / MCP / hooks do.
 */

export function assessProjectSettings(dir: string, now: string): ProjectSettingsAssessment {
  const exists = (p: string): boolean => {
    try {
      return existsSync(join(dir, p));
    } catch {
      return false;
    }
  };
  const dirExists = (p: string): boolean => {
    try {
      return existsSync(join(dir, p)) && statSync(join(dir, p)).isDirectory();
    } catch {
      return false;
    }
  };

  const hasClaudeMd = exists('CLAUDE.md');
  const hasProjectSettings = exists('.claude/settings.json');
  const hasLocalSettings = exists('.claude/settings.local.json');
  const hasMcpConfig = exists('.mcp.json');
  const hasHooks = dirExists('.claude/hooks') || dirExists('.claude/commands');

  const findings: string[] = [];
  if (hasProjectSettings) findings.push('project .claude/settings.json present — could grant tool permissions.');
  if (hasLocalSettings) findings.push('.claude/settings.local.json present — could grant tool permissions.');
  if (hasMcpConfig) findings.push('.mcp.json present — could load MCP servers.');
  if (hasHooks) findings.push('project hooks/commands present — could execute automatically.');

  // CLAUDE.md is deliberately NOT a review trigger (context only).
  const risk = findings.length > 0 ? 'review_required' : 'clean';
  return { hasClaudeMd, hasProjectSettings, hasLocalSettings, hasMcpConfig, hasHooks, findings, risk, assessedAt: now };
}
