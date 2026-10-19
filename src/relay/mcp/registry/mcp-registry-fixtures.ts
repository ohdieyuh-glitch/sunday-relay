/**
 * CURATED REGISTRY FIXTURES — the five private-beta CATEGORIES (§20).
 *
 * READ THIS BEFORE BELIEVING ANYTHING IN THIS FILE IS LIVE.
 *
 * Every entry below carries `simulation: true`. None of them connects to
 * GitHub, to a real filesystem server, to a database, to a browser harness or
 * to any external service whatsoever. They exist so that the registry, the
 * preflight, the CLI and the website have real, well-formed entries to operate
 * on, and so the SHAPE of a curated entry is reviewable before any live one is
 * authored.
 *
 * The `relay.` executable names are not real programs. They resolve only
 * through the fake-server allowlist used by the offline proof
 * (`../testing/`), so a fixture cannot accidentally launch anything on a
 * developer's machine: there is nothing on any PATH by these names, and the
 * executable allowlist would refuse them anyway outside the test policy.
 *
 * WHAT RELAY DOES NOT CLAIM, restated because §26 requires it: no live GitHub
 * MCP, no live filesystem MCP for users, no live database MCP, no live browser
 * MCP, no live deployment MCP, no marketplace publishing, no production OAuth.
 */

import type { McpRegistryEntryId, McpServerDefinitionId } from '../../protocol/ids';
import { MCP_BASELINE_PROTOCOL_REVISION } from '../domain/mcp-protocol';
import type { McpRegistryEntry } from './mcp-registry-types';

const id = (value: string): McpRegistryEntryId => value as McpRegistryEntryId;
const definitionId = (value: string): McpServerDefinitionId => value as McpServerDefinitionId;

const CURATED_AT = '2026-08-02T00:00:00.000Z';

/**
 * 1. FILESYSTEM / REPOSITORY — read-only repository inspection.
 * The category a Coding Agent's workspace reads would use.
 */
const filesystemRepository: McpRegistryEntry = {
  registryEntryId: id('mrg_fixture_filesystem_repository'),
  serverDefinitionId: definitionId('msd_fixture_filesystem_repository'),
  displayName: 'Repository Reader (fixture)',
  category: 'filesystem_repository',
  state: 'approved',
  expectedServerName: 'relay-fixture-repository',
  expectedServerVersion: '0.1.0',
  publisher: 'Aquala Technologies (fixture)',
  transport: 'stdio',
  stdio: {
    executable: 'relay-fixture-repository',
    fixedArguments: ['--read-only'],
    argumentAllowlist: ['--scenario=*'],
    environmentAllowlist: ['RELAY_FIXTURE_SCENARIO'],
    workspaceRootBehavior: 'workspace_root',
    packageIdentity: null,
    artifactChecksumSha256: null,
  },
  http: null,
  minimumProtocolRevision: MCP_BASELINE_PROTOCOL_REVISION,
  declaredToolRisk: {
    read_file: 'read_only',
    list_directory: 'read_only',
    search_repository: 'read_only',
  },
  maximumRiskClass: 'read_only',
  requiredCredentialClass: null,
  requiredCredentialScopes: [],
  securityReviewedAt: CURATED_AT,
  securityReviewer: 'relay-founder',
  revokedAt: null,
  revocationReason: null,
  simulation: true,
  notes: ['Fixture only. Reads nothing outside the offline proof harness.'],
};

/**
 * 2. GIT / GITHUB — the category that motivates most of the approval model.
 * Deliberately `reviewed` rather than `approved`: it is the one category whose
 * write surface reaches outside the workspace, and it stays unconnectable
 * until a real security review of a real server happens.
 */
const gitHosting: McpRegistryEntry = {
  registryEntryId: id('mrg_fixture_git_hosting'),
  serverDefinitionId: definitionId('msd_fixture_git_hosting'),
  displayName: 'Git Hosting (fixture)',
  category: 'git_hosting',
  state: 'reviewed',
  expectedServerName: 'relay-fixture-git-hosting',
  expectedServerVersion: '0.1.0',
  publisher: 'Aquala Technologies (fixture)',
  transport: 'streamable_http',
  stdio: null,
  http: {
    url: 'https://git-hosting.fixture.invalid/mcp',
    expectedOrigin: 'https://git-hosting.fixture.invalid',
    allowsPlainHttp: false,
  },
  minimumProtocolRevision: MCP_BASELINE_PROTOCOL_REVISION,
  declaredToolRisk: {
    search_repository: 'read_only',
    read_file: 'read_only',
    create_branch: 'workspace_write',
    create_issue: 'external_write',
    create_pull_request: 'external_write',
    merge_pull_request: 'destructive',
  },
  maximumRiskClass: 'destructive',
  requiredCredentialClass: 'oauth_authorization_code',
  requiredCredentialScopes: ['repo:read'],
  securityReviewedAt: null,
  securityReviewer: null,
  revokedAt: null,
  revocationReason: null,
  simulation: true,
  notes: [
    'Fixture only. `.invalid` is a reserved TLD that never resolves, so this entry cannot reach a network host.',
    'State is `reviewed`, not `approved` — Relay will refuse to connect until a real server is really reviewed.',
  ],
};

/** 3. DOCUMENTATION / CONTEXT — the Prompt Architect's read-only research. */
const documentationContext: McpRegistryEntry = {
  registryEntryId: id('mrg_fixture_documentation'),
  serverDefinitionId: definitionId('msd_fixture_documentation'),
  displayName: 'Documentation Context (fixture)',
  category: 'documentation_context',
  state: 'approved',
  expectedServerName: 'relay-fixture-documentation',
  expectedServerVersion: '0.1.0',
  publisher: 'Aquala Technologies (fixture)',
  transport: 'stdio',
  stdio: {
    executable: 'relay-fixture-documentation',
    fixedArguments: [],
    argumentAllowlist: ['--scenario=*'],
    environmentAllowlist: ['RELAY_FIXTURE_SCENARIO'],
    workspaceRootBehavior: 'isolated_temp',
    packageIdentity: null,
    artifactChecksumSha256: null,
  },
  http: null,
  minimumProtocolRevision: MCP_BASELINE_PROTOCOL_REVISION,
  declaredToolRisk: {
    search_documentation: 'read_only',
    read_document: 'read_only',
  },
  maximumRiskClass: 'read_only',
  requiredCredentialClass: null,
  requiredCredentialScopes: [],
  securityReviewedAt: CURATED_AT,
  securityReviewer: 'relay-founder',
  revokedAt: null,
  revocationReason: null,
  simulation: true,
  notes: ['Fixture only.'],
};

/** 4. DATABASE SCHEMA / READ-ONLY. */
const databaseReadonly: McpRegistryEntry = {
  registryEntryId: id('mrg_fixture_database_readonly'),
  serverDefinitionId: definitionId('msd_fixture_database_readonly'),
  displayName: 'Database Schema, read-only (fixture)',
  category: 'database_readonly',
  state: 'draft',
  expectedServerName: 'relay-fixture-database',
  expectedServerVersion: '0.1.0',
  publisher: 'Aquala Technologies (fixture)',
  transport: 'stdio',
  stdio: {
    executable: 'relay-fixture-database',
    fixedArguments: ['--read-only'],
    argumentAllowlist: [],
    environmentAllowlist: ['RELAY_FIXTURE_SCENARIO'],
    workspaceRootBehavior: 'isolated_temp',
    packageIdentity: null,
    artifactChecksumSha256: null,
  },
  http: null,
  minimumProtocolRevision: MCP_BASELINE_PROTOCOL_REVISION,
  declaredToolRisk: {
    describe_schema: 'read_only',
    query_readonly: 'read_only',
    drop_table: 'destructive',
  },
  maximumRiskClass: 'destructive',
  requiredCredentialClass: 'bearer_token',
  requiredCredentialScopes: ['db:read'],
  securityReviewedAt: null,
  securityReviewer: null,
  revokedAt: null,
  revocationReason: null,
  simulation: true,
  notes: [
    'Fixture only, and deliberately `draft` — a database connector is not connectable in this milestone.',
    '`drop_table` is declared so the risk floor is proven to classify it destructive even on a read-only-named entry.',
  ],
};

/** 5. BROWSER / TESTING. */
const browserTesting: McpRegistryEntry = {
  registryEntryId: id('mrg_fixture_browser_testing'),
  serverDefinitionId: definitionId('msd_fixture_browser_testing'),
  displayName: 'Browser Testing (fixture)',
  category: 'browser_testing',
  state: 'draft',
  expectedServerName: 'relay-fixture-browser',
  expectedServerVersion: '0.1.0',
  publisher: 'Aquala Technologies (fixture)',
  transport: 'streamable_http',
  stdio: null,
  http: {
    url: 'https://browser.fixture.invalid/mcp',
    expectedOrigin: 'https://browser.fixture.invalid',
    allowsPlainHttp: false,
  },
  minimumProtocolRevision: MCP_BASELINE_PROTOCOL_REVISION,
  declaredToolRisk: {
    navigate: 'external_write',
    screenshot: 'read_only',
    click: 'external_write',
  },
  maximumRiskClass: 'external_write',
  requiredCredentialClass: null,
  requiredCredentialScopes: [],
  securityReviewedAt: null,
  securityReviewer: null,
  revokedAt: null,
  revocationReason: null,
  simulation: true,
  notes: ['Fixture only.'],
};

/**
 * A REVOKED entry. Present deliberately: revocation is the registry operation
 * that has to work under pressure, so it needs a fixture that proves refusal
 * rather than a comment saying it would.
 */
const revokedExample: McpRegistryEntry = {
  registryEntryId: id('mrg_fixture_revoked'),
  serverDefinitionId: definitionId('msd_fixture_revoked'),
  displayName: 'Withdrawn Connector (fixture)',
  category: 'documentation_context',
  state: 'revoked',
  expectedServerName: 'relay-fixture-revoked',
  expectedServerVersion: '0.0.1',
  publisher: 'Aquala Technologies (fixture)',
  transport: 'stdio',
  stdio: {
    executable: 'relay-fixture-revoked',
    fixedArguments: [],
    argumentAllowlist: [],
    environmentAllowlist: [],
    workspaceRootBehavior: 'isolated_temp',
    packageIdentity: null,
    artifactChecksumSha256: null,
  },
  http: null,
  minimumProtocolRevision: MCP_BASELINE_PROTOCOL_REVISION,
  declaredToolRisk: {},
  maximumRiskClass: 'read_only',
  requiredCredentialClass: null,
  requiredCredentialScopes: [],
  securityReviewedAt: CURATED_AT,
  securityReviewer: 'relay-founder',
  revokedAt: CURATED_AT,
  revocationReason: 'withdrawn during curation to exercise the revocation path',
  simulation: true,
  notes: ['Fixture only. Exists to prove a revoked entry is refused.'],
};

export const MCP_REGISTRY_FIXTURES: readonly McpRegistryEntry[] = Object.freeze([
  filesystemRepository,
  gitHosting,
  documentationContext,
  databaseReadonly,
  browserTesting,
  revokedExample,
]);

/**
 * Every fixture is a simulation. Asserted in `mcp-registry.test.ts` over the
 * whole array rather than trusted per entry, so an entry added without the
 * flag fails a test instead of appearing in the product as a live connector.
 */
export const allFixturesAreSimulations = (): boolean =>
  MCP_REGISTRY_FIXTURES.every((entry) => entry.simulation);
