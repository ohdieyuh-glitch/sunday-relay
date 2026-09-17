import type { ConnectorCapability, ConnectorDescriptor, ConnectorRouteOption, ConnectRoute } from './connect-contracts';

/**
 * JULIUS CONNECT — THE GOVERNED CONNECTOR REGISTRY.
 *
 * Two populations, never confused:
 *
 *   REAL SERVICES. GitHub, Figma, Slack, Google Drive, Linear, Vercel are described as they are: the routes Julius would
 *   use (OAuth/API preferred) and the capabilities they expose. No provider integration for Julius Connect exists in this
 *   build yet, so every one of their routes says `available: false` and why. Julius will not claim to connect them.
 *
 *   DEVELOPMENT CONNECTORS. Deterministic, provider-free stand-ins, one per route shape -- OAuth-shaped, MCP-shaped,
 *   API-credential-shaped and browser-only -- so the whole lifecycle (request, prepare, approve, connect, use, audit,
 *   revoke) is exercised end to end without contacting anything. `development: true`, and every surface labels them
 *   DEVELOPMENT CONNECTOR.
 */

const cap = (capabilityId: string, label: string, risk: ConnectorCapability['risk']): ConnectorCapability => ({ capabilityId, label, risk });

const route = (r: ConnectRoute, humanStep: string, extra: Partial<ConnectorRouteOption> = {}): ConnectorRouteOption => ({
  route: r,
  available: true,
  unavailableReason: null,
  humanStep,
  mcpRegistryEntryId: null,
  ...extra,
});

const NOT_BUILT = (service: string, how: string) =>
  `${service} ${how} integration for Julius Connect is not built in this build; no request to ${service} is made.`;

const unavailable = (r: ConnectRoute, service: string, how: string, humanStep: string): ConnectorRouteOption =>
  route(r, humanStep, { available: false, unavailableReason: NOT_BUILT(service, how) });

export const JULIUS_CONNECT_REGISTRY: readonly ConnectorDescriptor[] = Object.freeze([
  /* ------------------------------------------------------------ real services */
  {
    connectorId: 'github', serviceId: 'github', displayName: 'GitHub', aliases: ['gh'], version: '0.0.0', development: false,
    routes: [unavailable('oauth_api', 'GitHub', 'OAuth app', 'Approve the GitHub App for the chosen repositories')],
    capabilities: [cap('repo.read', 'Read repositories', 'read'), cap('repo.write', 'Push commits', 'write'), cap('pull_request.create', 'Open pull requests', 'write'),
      cap('pull_request.comment', 'Comment on pull requests', 'write'), cap('repo.delete', 'Delete repositories', 'destructive'), cap('organization.admin', 'Administer the organization', 'admin')],
  },
  {
    connectorId: 'figma', serviceId: 'figma', displayName: 'Figma', aliases: [], version: '0.0.0', development: false,
    routes: [unavailable('oauth_api', 'Figma', 'OAuth', 'Approve access in Figma'), unavailable('mcp', 'Figma', 'MCP', 'Approve the Figma MCP server')],
    capabilities: [cap('files.read', 'Read design files', 'read'), cap('design.write', 'Edit designs', 'write'), cap('comments.write', 'Comment on files', 'write'), cap('team.admin', 'Administer the team', 'admin')],
  },
  {
    connectorId: 'slack', serviceId: 'slack', displayName: 'Slack', aliases: [], version: '0.0.0', development: false,
    routes: [unavailable('oauth_api', 'Slack', 'OAuth', 'Approve the Slack app for the allowed channels')],
    capabilities: [cap('channels.read', 'View allowed channels', 'read'), cap('messages.send', 'Send messages', 'write'),
      cap('workspace.admin', 'Workspace administration', 'admin'), cap('users.manage', 'User management', 'admin')],
  },
  {
    connectorId: 'google-drive', serviceId: 'google-drive', displayName: 'Google Drive', aliases: ['drive', 'gdrive'], version: '0.0.0', development: false,
    routes: [unavailable('oauth_api', 'Google Drive', 'OAuth', 'Approve access in your Google account')],
    capabilities: [cap('files.read', 'Read files', 'read'), cap('files.write', 'Create and edit files', 'write'), cap('files.delete', 'Delete files', 'destructive')],
  },
  {
    connectorId: 'linear', serviceId: 'linear', displayName: 'Linear', aliases: [], version: '0.0.0', development: false,
    routes: [unavailable('oauth_api', 'Linear', 'OAuth', 'Approve access in Linear')],
    capabilities: [cap('issues.read', 'Read issues', 'read'), cap('issues.write', 'Create and update issues', 'write'), cap('workspace.admin', 'Workspace administration', 'admin')],
  },
  {
    connectorId: 'vercel', serviceId: 'vercel', displayName: 'Vercel', aliases: [], version: '0.0.0', development: false,
    routes: [unavailable('oauth_api', 'Vercel', 'OAuth', 'Approve the Vercel integration for the chosen projects')],
    capabilities: [cap('deployments.read', 'Read deployments', 'read'), cap('deployments.create', 'Create deployments', 'write'), cap('team.admin', 'Team administration', 'admin')],
  },

  /* ---------------------------------------------------- development connectors */
  {
    connectorId: 'dev-figma', serviceId: 'dev-figma', displayName: 'Design Tool (development)', aliases: ['figma-dev', 'design'], version: '1.0.0-dev', development: true,
    routes: [route('oauth_api', 'Approve access in the design tool (development authorization -- nothing is contacted)')],
    capabilities: [cap('files.read', 'Read design files', 'read'), cap('design.write', 'Edit designs', 'write'), cap('comments.write', 'Comment on files', 'write'),
      cap('team.admin', 'Administer the team', 'admin'), cap('files.delete', 'Delete design files', 'destructive')],
  },
  {
    connectorId: 'dev-insight-mcp', serviceId: 'dev-insight-mcp', displayName: 'Insight Tool (development)', aliases: ['insight', 'mcp-tool'], version: '1.0.0-dev', development: true,
    routes: [route('mcp', "Approve the tool's access (development MCP server -- nothing is contacted)", { mcpRegistryEntryId: 'dev-insight-mcp' })],
    capabilities: [cap('insight.query', 'Query insights', 'read'), cap('insight.run', 'Run analyses', 'write'), cap('insight.admin', 'Administer the tool', 'admin')],
  },
  {
    connectorId: 'dev-postgres', serviceId: 'dev-postgres', displayName: 'Project Database (development)', aliases: ['postgres', 'database', 'db'], version: '1.0.0-dev', development: true,
    routes: [route('api_credential', 'Sign in to the database console and create a scoped credential (development -- nothing is contacted)')],
    capabilities: [cap('db.read', 'Read tables', 'read'), cap('db.write', 'Write rows', 'write'), cap('db.admin', 'Manage roles and schema', 'admin'), cap('db.drop', 'Drop tables', 'destructive')],
  },
  {
    connectorId: 'dev-social', serviceId: 'dev-social', displayName: 'Social App (development)', aliases: ['social', 'instagram', 'photos'], version: '1.0.0-dev', development: true,
    routes: [route('browser_computer', 'Sign in once in the governed browser so Julius can post as you (development -- nothing is contacted)')],
    capabilities: [cap('profile.read', 'Read the profile', 'read'), cap('posts.read', 'Read posts', 'read'), cap('posts.create', 'Publish a post', 'write'),
      cap('messages.send', 'Send direct messages', 'write'), cap('account.settings', 'Change account settings', 'admin'), cap('posts.delete', 'Delete posts', 'destructive')],
  },
  {
    connectorId: 'dev-legacy-portal', serviceId: 'dev-legacy-portal', displayName: 'Supplier Portal (development)', aliases: ['portal', 'legacy'], version: '1.0.0-dev', development: true,
    routes: [route('browser_computer', 'Sign in once so Julius can operate the portal within the approved actions (development -- nothing is contacted)')],
    capabilities: [cap('portal.read', 'Read orders', 'read'), cap('portal.submit', 'Submit forms', 'write'), cap('portal.account_settings', 'Change account settings', 'admin')],
  },
] satisfies readonly ConnectorDescriptor[]);

/** Every connector a name could mean: exact id first, then service, display name and aliases. */
export function discoverConnectors(query: string, registry: readonly ConnectorDescriptor[] = JULIUS_CONNECT_REGISTRY): readonly ConnectorDescriptor[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const exact = registry.filter((c) => c.connectorId === q);
  const loose = registry.filter((c) => c.connectorId !== q && (c.serviceId === q || c.displayName.toLowerCase().includes(q) || c.aliases.includes(q)));
  return [...exact, ...loose];
}

export function findConnector(connectorId: string, registry: readonly ConnectorDescriptor[] = JULIUS_CONNECT_REGISTRY): ConnectorDescriptor | null {
  return registry.find((c) => c.connectorId === connectorId) ?? null;
}

/**
 * JULIUS CHOOSES THE ROUTE: the first route in the connector's preference order that this build can actually use. Null
 * when none can -- and then Julius says so, with each route's reason, instead of connecting nothing and calling it done.
 */
export function chooseConnectRoute(connector: ConnectorDescriptor): ConnectorRouteOption | null {
  return connector.routes.find((r) => r.available) ?? null;
}

/**
 * WHAT JULIUS ASKS FOR, AND WHAT IT PLAINLY DOES NOT. Only capabilities the work needs, never admin or destructive ones
 * on the user's behalf; everything else the service offers is listed as not requested, so the prompt shows both.
 */
export function planCapabilityAsk(connector: ConnectorDescriptor, needed: readonly string[]): { requested: string[]; notRequested: string[]; unknown: string[] } {
  const known = new Set(connector.capabilities.map((c) => c.capabilityId));
  const unknown = needed.filter((n) => !known.has(n));
  const safe = new Set(connector.capabilities.filter((c) => c.risk === 'read' || c.risk === 'write').map((c) => c.capabilityId));
  const requested = [...new Set(needed.filter((n) => known.has(n) && safe.has(n)))];
  const notRequested = connector.capabilities.map((c) => c.capabilityId).filter((id) => !requested.includes(id));
  return { requested, notRequested, unknown };
}
