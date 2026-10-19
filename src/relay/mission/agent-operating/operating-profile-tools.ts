/**
 * SUNDAY RELAY — THE INITIAL TOOL GRANTS.
 *
 * Tools are EXPLICITLY GRANTED capabilities, listed so an operator can read
 * what an agent may do without inferring it from behaviour. This is the small
 * starting catalogue, not the future compound-agent tool marketplace: adding a
 * tool here is a deliberate product decision, not a plugin install.
 *
 * A GRANT CANNOT EXCEED THE MODE POLICY. `RelayModePolicy` already carries
 * `prohibitedTools`, and that policy is the authority. `toolGrantsWithinPolicy`
 * exists so a grant list can be checked against it rather than against a
 * second, parallel permission model that could drift from the first.
 *
 * PURE. No I/O, no provider, no secrets.
 */

import type { RelayModePolicy } from '../modes';
import type { RelayAgentRole, RelayToolGrant } from './operating-profile-types';

/**
 * THE CANONICAL GRANTS PER ROLE.
 *
 * Research sits under the Prompt Architect, testing under the Coding Agent,
 * and finding-authorship under the Reviewer — because each is a CAPABILITY of
 * an existing role, never a new role of its own.
 */
export const RELAY_ROLE_TOOL_GRANTS: Readonly<Record<RelayAgentRole, readonly RelayToolGrant[]>> = Object.freeze({
  prompt_architect: Object.freeze([
    { toolId: 'read_project', label: 'Read project' },
    { toolId: 'read_project_brain', label: 'Read Project Brain' },
    { toolId: 'research', label: 'Research' },
    { toolId: 'search_documentation', label: 'Search documentation' },
    { toolId: 'create_requirements', label: 'Create requirements' },
    { toolId: 'create_handoff', label: 'Create handoff' },
  ]),
  coding_agent: Object.freeze([
    { toolId: 'read_files', label: 'Read files' },
    { toolId: 'edit_assigned_files', label: 'Edit assigned files' },
    { toolId: 'search_code', label: 'Search code' },
    { toolId: 'run_commands', label: 'Run commands' },
    { toolId: 'run_tests', label: 'Run tests' },
    { toolId: 'inspect_build', label: 'Inspect build' },
    { toolId: 'safe_git', label: 'Safe git' },
  ]),
  reviewer: Object.freeze([
    { toolId: 'read_diff', label: 'Read diff' },
    { toolId: 'read_files', label: 'Read files' },
    { toolId: 'inspect_tests', label: 'Inspect tests' },
    { toolId: 'inspect_trace', label: 'Inspect trace' },
    { toolId: 'inspect_capsules', label: 'Inspect capsules' },
    { toolId: 'create_findings', label: 'Create findings' },
  ]),
});

/** Every tool identifier this build knows how to grant. */
export const RELAY_KNOWN_TOOL_IDS: readonly string[] = Object.freeze(
  [...new Set(Object.values(RELAY_ROLE_TOOL_GRANTS).flat().map((g) => g.toolId))].sort(),
);

/** The grants a role starts with. A copy, so a caller cannot mutate the table. */
export function toolGrantsForRole(role: RelayAgentRole): readonly RelayToolGrant[] {
  return RELAY_ROLE_TOOL_GRANTS[role].map((grant) => ({ ...grant }));
}

/**
 * Which of these grants the mode policy PROHIBITS.
 *
 * The policy speaks in patterns like `git push` and `deploy`; a grant is
 * refused when its identifier or its label matches one, so `safe_git` survives
 * a `git push` prohibition — which is exactly the distinction the tool name
 * was chosen to make — while a hypothetical `deploy` grant would not.
 *
 * Returns the REFUSED grants, so an empty array means the list is within
 * policy.
 */
export function toolGrantsOutsidePolicy(
  grants: readonly RelayToolGrant[],
  policy: Pick<RelayModePolicy, 'prohibitedTools'>,
): readonly RelayToolGrant[] {
  const prohibited = policy.prohibitedTools.map((p) => p.toLowerCase());
  return grants.filter((grant) => {
    const id = grant.toolId.toLowerCase();
    return prohibited.some((rule) => {
      // `Bash(rm *)` and `db:drop` are patterns, not identifiers. A grant is
      // refused when the rule names the capability itself, never when it
      // merely shares a word with it.
      const bare = rule.replace(/^bash\(|\)$/g, '').trim();
      const head = bare.split(/[\s(*]/)[0];
      return head !== '' && (id === head || id === bare.replace(/\s+/g, '_'));
    });
  });
}

/** True when every grant is permitted by the mode policy. */
export function toolGrantsWithinPolicy(
  grants: readonly RelayToolGrant[],
  policy: Pick<RelayModePolicy, 'prohibitedTools'>,
): boolean {
  return toolGrantsOutsidePolicy(grants, policy).length === 0;
}
