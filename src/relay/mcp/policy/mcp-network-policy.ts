/**
 * MCP NETWORK POLICY — SSRF, redirect and credential-forwarding rules (PURE).
 *
 * THE MISTAKE THIS MODULE REFUSES TO MAKE:
 *
 *     "the hostname string looks public, therefore the destination is public"
 *
 * It is not. `evil.example.com` can have an A record of `169.254.169.254`, and
 * a host that filters on the STRING hands its cloud metadata credentials to
 * whoever registered that name. §7 states the rule directly: a DNS name is
 * never safe because its input string appears public. So the policy here runs
 * in two stages and BOTH must pass:
 *
 *   1. `checkUrlPolicy`  — syntax, scheme, credentials, fragment, literal IPs;
 *   2. `checkResolvedAddresses` — the addresses DNS actually returned.
 *
 * Stage 2 takes a RESOLVER PORT, so tests inject resolutions (including a name
 * that resolves to a metadata address) without any DNS traffic at all.
 *
 * DNS REBINDING. A name checked at stage 2 and connected to a moment later can
 * resolve differently in between. Relay's answer is to pin: the transport
 * connects to an address that was checked, and `pinnedAddress` on the verdict
 * is what it must use. Re-resolving between check and connect is the rebinding
 * window, and the only way to close it is not to re-resolve.
 *
 * LOOPBACK IS BLOCKED BY DEFAULT AND UNBLOCKED ONLY BY AN EXPLICIT TEST
 * POLICY. `allowLoopbackForTesting` exists because §23 requires the offline
 * proof to run a real Streamable HTTP server on an ephemeral loopback port.
 * It is a named field on a policy object, not an environment variable and not
 * a default, so a production configuration cannot acquire it by accident and
 * `mcp-network-policy.test.ts` asserts the default policy refuses loopback.
 */

export interface McpNetworkPolicy {
  /** Permit `http://` to loopback. Test harnesses only. */
  readonly allowLoopbackForTesting: boolean;
  /** Permit RFC1918 / ULA destinations — e.g. Railway private networking. */
  readonly allowPrivateNetwork: boolean;
  /** Permit plain HTTP to a permitted private/loopback destination. */
  readonly allowPlainHttp: boolean;
  readonly maximumRedirects: number;
  readonly connectTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly maximumResponseBytes: number;
}

/** The default. Everything unsafe is off. */
export const MCP_DEFAULT_NETWORK_POLICY: McpNetworkPolicy = Object.freeze({
  allowLoopbackForTesting: false,
  allowPrivateNetwork: false,
  allowPlainHttp: false,
  maximumRedirects: 3,
  connectTimeoutMs: 5_000,
  requestTimeoutMs: 30_000,
  maximumResponseBytes: 4 * 1024 * 1024,
});

/** The explicit, named test policy. Used ONLY by the offline proof harness. */
export const MCP_LOOPBACK_TEST_NETWORK_POLICY: McpNetworkPolicy = Object.freeze({
  ...MCP_DEFAULT_NETWORK_POLICY,
  allowLoopbackForTesting: true,
  allowPlainHttp: true,
  connectTimeoutMs: 2_000,
  requestTimeoutMs: 5_000,
});

export type McpAddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link_local'
  | 'cloud_metadata'
  | 'unspecified'
  | 'multicast'
  | 'reserved'
  | 'unparsable';

/* ------------------------------------------------------------------ *
 * Address classification.
 * ------------------------------------------------------------------ */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Well-known cloud metadata endpoints, checked before anything else. */
const CLOUD_METADATA_ADDRESSES = new Set([
  '169.254.169.254',  // AWS / GCP / Azure / DigitalOcean / Oracle
  '169.254.170.2',    // AWS ECS task metadata
  '100.100.100.200',  // Alibaba Cloud
  'fd00:ec2::254',    // AWS IMDSv2 over IPv6
]);

export function classifyIpv4(address: string): McpAddressClass {
  const match = IPV4.exec(address);
  if (!match) return 'unparsable';
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return 'unparsable';
  const [a, b] = octets as [number, number, number, number];

  if (CLOUD_METADATA_ADDRESSES.has(address)) return 'cloud_metadata';
  if (a === 0) return 'unspecified';
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  // Carrier-grade NAT — routable to infrastructure the caller does not own.
  if (a === 100 && b >= 64 && b <= 127) return 'private';
  if (a === 169 && b === 254) return 'link_local';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'reserved';
  // 192.0.0.0/24, 192.0.2.0/24, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24
  if (a === 192 && b === 0) return 'reserved';
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return 'reserved';
  if (a === 203 && b === 0) return 'reserved';
  return 'public';
}

/**
 * Expand an IPv6 literal to its eight 16-bit groups, or null when it is not a
 * parsable IPv6 address.
 *
 * WHY THIS EXISTS RATHER THAN A SET OF REGEXES OVER THE TEXT. An IPv6 address
 * has many spellings and Relay does not choose which one it is handed. The
 * WHATWG URL parser rewrites `https://[::ffff:127.0.0.1]/` into the hex form
 * `[::ffff:7f00:1]` BEFORE any policy code sees it, so a rule that matches only
 * the dotted-quad spelling of an IPv4-mapped address never fires in production
 * and classifies loopback as public. A resolver port can hand back either
 * spelling too. Classifying the NUMBER instead of the STRING removes the whole
 * family of defects at once: `::ffff:127.0.0.1`, `::ffff:7f00:1`,
 * `0:0:0:0:0:ffff:7f00:1` and `::FFFF:7F00:1` are one address and get one answer.
 */
function ipv6Groups(input: string): readonly number[] | null {
  if (!/^[0-9a-f:.]+$/.test(input) || !input.includes(':')) return null;

  // An embedded dotted quad may only appear as the final 32 bits. Rewrite it to
  // two hex groups so the rest of the parse deals with hex alone.
  let text = input;
  const lastColon = text.lastIndexOf(':');
  const trailer = text.slice(lastColon + 1);
  if (trailer.includes('.')) {
    const quad = IPV4.exec(trailer);
    if (!quad) return null;
    const octets = quad.slice(1, 5).map(Number);
    if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
    const [a, b, c, d] = octets as [number, number, number, number];
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  } else if (text.includes('.')) {
    return null; // a dot anywhere else is not an address
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (side === '') return [];
    const out: number[] = [];
    for (const group of side.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };

  const left = parseSide(halves[0]!);
  if (left === null) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;

  const right = parseSide(halves[1]!);
  if (right === null) return null;
  const elided = 8 - left.length - right.length;
  if (elided < 1) return null; // `::` must stand for at least one group
  return [...left, ...new Array<number>(elided).fill(0), ...right];
}

const ipv4FromGroups = (high: number, low: number): string =>
  `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;

/**
 * The class of the IPv4 address an IPv6 address carries, or null when it
 * carries none. Every embedding is answered as the IPv4 it transports, because
 * that is the host the packet actually reaches.
 */
function embeddedIpv4Class(groups: readonly number[]): McpAddressClass | null {
  const zeroThrough = (count: number): boolean => groups.slice(0, count).every((value) => value === 0);
  const carried = (): McpAddressClass => classifyIpv4(ipv4FromGroups(groups[6]!, groups[7]!));

  // ::ffff:a.b.c.d — IPv4-mapped (RFC 4291 §2.5.5.2). The form the URL parser produces.
  if (zeroThrough(5) && groups[5] === 0xffff) return carried();
  // ::ffff:0:a.b.c.d — IPv4-translated (RFC 2765 §2.1).
  if (zeroThrough(4) && groups[4] === 0xffff && groups[5] === 0) return carried();
  // 64:ff9b::/96 — the well-known NAT64 prefix (RFC 6052 §2.1).
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((value) => value === 0)) {
    return carried();
  }
  // 2002:a.b.c.d::/48 — 6to4 (RFC 3056 §2), which carries the IPv4 in groups 1-2.
  if (groups[0] === 0x2002) return classifyIpv4(ipv4FromGroups(groups[1]!, groups[2]!));
  // ::a.b.c.d — IPv4-compatible (deprecated). `::` and `::1` are not that.
  if (zeroThrough(6) && !(groups[6] === 0 && (groups[7] === 0 || groups[7] === 1))) return carried();
  return null;
}

const CLOUD_METADATA_IPV6: readonly (readonly number[])[] = Object.freeze(
  [...CLOUD_METADATA_ADDRESSES]
    .filter((address) => address.includes(':'))
    .map((address) => ipv6Groups(address))
    .filter((groups): groups is readonly number[] => groups !== null),
);

export function classifyIpv6(input: string): McpAddressClass {
  const address = input.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]!;
  const groups = ipv6Groups(address);
  if (groups === null) return 'unparsable';

  if (CLOUD_METADATA_IPV6.some((known) => known.every((value, index) => value === groups[index]))) {
    return 'cloud_metadata';
  }
  // An embedded IPv4 answers first: `::ffff:169.254.169.254` is the metadata
  // service, not a public IPv6 address that happens to contain those digits.
  const embedded = embeddedIpv4Class(groups);
  if (embedded !== null) return embedded;

  if (groups.every((value) => value === 0)) return 'unspecified';
  if (groups.slice(0, 7).every((value) => value === 0) && groups[7] === 1) return 'loopback';

  const first = groups[0]!;
  if ((first & 0xffc0) === 0xfe80) return 'link_local';   // fe80::/10
  if ((first & 0xfe00) === 0xfc00) return 'private';      // unique local fc00::/7
  if ((first & 0xff00) === 0xff00) return 'multicast';    // ff00::/8
  if (first === 0x2001 && groups[1] === 0x0db8) return 'reserved'; // documentation 2001:db8::/32
  return 'public';
}

export function classifyAddress(address: string): McpAddressClass {
  if (address.includes(':')) return classifyIpv6(address);
  return classifyIpv4(address);
}

/** Address classes that are never permitted, under any policy. */
const NEVER_PERMITTED: readonly McpAddressClass[] = Object.freeze([
  'cloud_metadata', 'link_local', 'unspecified', 'multicast', 'reserved', 'unparsable',
]);

export function addressPermitted(
  addressClass: McpAddressClass,
  policy: McpNetworkPolicy,
): { readonly permitted: boolean; readonly reason: string | null } {
  if (NEVER_PERMITTED.includes(addressClass)) {
    return {
      permitted: false,
      reason: addressClass === 'cloud_metadata'
        ? 'the destination is a cloud instance-metadata address'
        : `the destination is a ${addressClass.replace('_', ' ')} address`,
    };
  }
  if (addressClass === 'loopback') {
    return policy.allowLoopbackForTesting
      ? { permitted: true, reason: null }
      : { permitted: false, reason: 'loopback destinations require an explicit test network policy' };
  }
  if (addressClass === 'private') {
    return policy.allowPrivateNetwork
      ? { permitted: true, reason: null }
      : { permitted: false, reason: 'private-network destinations require an explicit private-network policy' };
  }
  return { permitted: true, reason: null };
}

/* ------------------------------------------------------------------ *
 * Stage 1 — URL syntax and scheme.
 * ------------------------------------------------------------------ */

export interface McpUrlVerdict {
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly url: URL | null;
  /** Set when the host is a literal IP; null when it is a name needing DNS. */
  readonly literalAddressClass: McpAddressClass | null;
}

const refuse = (reason: string): McpUrlVerdict =>
  ({ allowed: false, reason, url: null, literalAddressClass: null });

export function checkUrlPolicy(raw: string, policy: McpNetworkPolicy): McpUrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse('the endpoint is not a parsable absolute URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return refuse(`the scheme ${url.protocol.replace(':', '')} is not permitted — MCP endpoints are http or https only`);
  }

  // Credentials in a URL end up in logs, in referrers and in error messages.
  // There is no safe way to carry them, so they are refused outright rather
  // than stripped — stripping would silently connect unauthenticated.
  if (url.username !== '' || url.password !== '') {
    return refuse('the endpoint embeds credentials in its userinfo component');
  }
  if (url.hash !== '') {
    return refuse('the endpoint carries a fragment, which is never sent and never meaningful for MCP');
  }

  const host = url.hostname;
  if (host === '') return refuse('the endpoint has no host');

  const isLiteral = IPV4.test(host) || host.includes(':') || /^\[.*\]$/.test(host);
  const literalAddressClass = isLiteral ? classifyAddress(host) : null;

  if (url.protocol === 'http:') {
    if (!policy.allowPlainHttp) {
      return refuse('plain HTTP is not permitted — a public MCP endpoint must use https');
    }
    // Plain HTTP is only ever acceptable to a destination that is itself
    // permitted as loopback or private. A public destination over HTTP is
    // refused even when `allowPlainHttp` is set, because the flag is about
    // trusted local networks, not about turning TLS off.
    const permittedPlain =
      (literalAddressClass === 'loopback' && policy.allowLoopbackForTesting)
      || (literalAddressClass === 'private' && policy.allowPrivateNetwork)
      || (literalAddressClass === null && (policy.allowLoopbackForTesting || policy.allowPrivateNetwork));
    if (!permittedPlain) {
      return refuse('plain HTTP is permitted only to an explicitly allowed loopback or private destination');
    }
  }

  if (literalAddressClass !== null) {
    const verdict = addressPermitted(literalAddressClass, policy);
    if (!verdict.permitted) return refuse(verdict.reason ?? 'the destination address is not permitted');
  }

  return { allowed: true, reason: null, url, literalAddressClass };
}

/* ------------------------------------------------------------------ *
 * Stage 2 — resolved addresses.
 * ------------------------------------------------------------------ */

/** Injected in tests; backed by `node:dns` on the server side. */
export interface McpDnsResolverPort {
  resolve(hostname: string): Promise<readonly string[]>;
}

export interface McpResolutionVerdict {
  readonly allowed: boolean;
  readonly reason: string | null;
  /** The address the transport MUST connect to. Closes the rebinding window. */
  readonly pinnedAddress: string | null;
  readonly classes: readonly McpAddressClass[];
}

/**
 * EVERY resolved address must pass. A name resolving to one public and one
 * private address is refused, not "connected to the public one": a host that
 * picks the safe answer from a mixed set has handed address selection to the
 * attacker who controls the record.
 */
export async function checkResolvedAddresses(
  hostname: string,
  resolver: McpDnsResolverPort,
  policy: McpNetworkPolicy,
): Promise<McpResolutionVerdict> {
  let addresses: readonly string[];
  try {
    addresses = await resolver.resolve(hostname);
  } catch {
    return { allowed: false, reason: `the hostname ${hostname} could not be resolved`, pinnedAddress: null, classes: [] };
  }
  if (addresses.length === 0) {
    return { allowed: false, reason: `the hostname ${hostname} resolved to no addresses`, pinnedAddress: null, classes: [] };
  }
  const classes = addresses.map(classifyAddress);
  for (let index = 0; index < addresses.length; index += 1) {
    const verdict = addressPermitted(classes[index]!, policy);
    if (!verdict.permitted) {
      return {
        allowed: false,
        reason: `${hostname} resolves to ${addresses[index]}, and ${verdict.reason}`,
        pinnedAddress: null,
        classes,
      };
    }
  }
  return { allowed: true, reason: null, pinnedAddress: addresses[0]!, classes };
}

/* ------------------------------------------------------------------ *
 * Redirects.
 * ------------------------------------------------------------------ */

export interface McpRedirectVerdict {
  readonly allowed: boolean;
  readonly reason: string | null;
  /** False whenever the hop leaves the original origin. */
  readonly mayForwardCredentials: boolean;
  readonly target: URL | null;
}

export const originOf = (url: URL): string => `${url.protocol}//${url.host}`;

/**
 * Evaluates one redirect hop.
 *
 * `mayForwardCredentials` is false the moment the origin changes, and the
 * transport DROPS the Authorization header rather than following with it. That
 * is the whole of the credential-forwarding defence: a redirect to an
 * attacker-controlled origin is a request for Relay's token, and answering it
 * with an unauthenticated request is the correct, boring outcome.
 */
export function checkRedirect(
  from: URL,
  location: string,
  hopNumber: number,
  policy: McpNetworkPolicy,
): McpRedirectVerdict {
  if (hopNumber > policy.maximumRedirects) {
    return {
      allowed: false,
      reason: `the endpoint redirected more than ${policy.maximumRedirects} times`,
      mayForwardCredentials: false,
      target: null,
    };
  }
  let target: URL;
  try {
    target = new URL(location, from);
  } catch {
    return { allowed: false, reason: 'the redirect target is not a parsable URL', mayForwardCredentials: false, target: null };
  }
  const verdict = checkUrlPolicy(target.toString(), policy);
  if (!verdict.allowed) {
    return { allowed: false, reason: `the redirect target was refused: ${verdict.reason}`, mayForwardCredentials: false, target: null };
  }
  const sameOrigin = originOf(target) === originOf(from);
  return { allowed: true, reason: null, mayForwardCredentials: sameOrigin, target };
}

/* ------------------------------------------------------------------ *
 * Content type.
 * ------------------------------------------------------------------ */

/** Streamable HTTP answers with JSON or an SSE stream. Anything else is not MCP. */
export const MCP_ACCEPTED_RESPONSE_TYPES: readonly string[] = Object.freeze([
  'application/json',
  'text/event-stream',
]);

export function contentTypeAcceptable(header: string | null): boolean {
  if (header === null) return false;
  const base = header.split(';')[0]!.trim().toLowerCase();
  return MCP_ACCEPTED_RESPONSE_TYPES.includes(base);
}
