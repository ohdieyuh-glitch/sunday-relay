import { describe, expect, it } from 'vitest';

import {
  addressPermitted, checkRedirect, checkResolvedAddresses, checkUrlPolicy,
  classifyAddress, classifyIpv4, classifyIpv6, contentTypeAcceptable, originOf,
  MCP_DEFAULT_NETWORK_POLICY, MCP_LOOPBACK_TEST_NETWORK_POLICY,
} from './policy/mcp-network-policy';
import { fixedResolver, loopbackOnlyResolver } from './testing/fake-mcp-harness';

const DEFAULT = MCP_DEFAULT_NETWORK_POLICY;
const LOOPBACK = MCP_LOOPBACK_TEST_NETWORK_POLICY;
const PRIVATE_OK = { ...MCP_DEFAULT_NETWORK_POLICY, allowPrivateNetwork: true, allowPlainHttp: true };

/* ==================================================================== *
 * ADDRESS CLASSIFICATION
 * ==================================================================== */

describe('IPv4 classification', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['169.254.169.254', 'cloud_metadata'],
    ['169.254.170.2', 'cloud_metadata'],
    ['100.100.100.200', 'cloud_metadata'],
    ['127.0.0.1', 'loopback'],
    ['127.9.9.9', 'loopback'],
    ['10.0.0.5', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.254', 'private'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'private'],
    ['169.254.1.1', 'link_local'],
    ['0.0.0.0', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['8.8.8.8', 'public'],
    ['not-an-ip', 'unparsable'],
    ['999.1.1.1', 'unparsable'],
  ];
  for (const [address, expected] of cases) {
    it(`${address} -> ${expected}`, () => {
      expect(classifyIpv4(address)).toBe(expected);
    });
  }

  it('172.32.0.1 is PUBLIC — the private range stops at 172.31', () => {
    expect(classifyIpv4('172.32.0.1')).toBe('public');
    expect(classifyIpv4('172.15.0.1')).toBe('public');
  });
});

describe('IPv6 classification', () => {
  it('classifies loopback, unspecified, ULA, link-local and multicast', () => {
    expect(classifyIpv6('::1')).toBe('loopback');
    expect(classifyIpv6('::')).toBe('unspecified');
    expect(classifyIpv6('fd00::1')).toBe('private');
    expect(classifyIpv6('fe80::1')).toBe('link_local');
    expect(classifyIpv6('ff02::1')).toBe('multicast');
    expect(classifyIpv6('2001:db8::1')).toBe('reserved');
    expect(classifyIpv6('2606:4700::1111')).toBe('public');
  });

  it('IPv4-MAPPED loopback is loopback, not a public IPv6 address', () => {
    // The bug this prevents: `::ffff:127.0.0.1` is loopback with two extra colons.
    expect(classifyIpv6('::ffff:127.0.0.1')).toBe('loopback');
    expect(classifyIpv6('::ffff:169.254.169.254')).toBe('cloud_metadata');
    expect(classifyIpv6('::ffff:10.0.0.1')).toBe('private');
  });

  it('strips brackets and zone identifiers', () => {
    expect(classifyIpv6('[::1]')).toBe('loopback');
    expect(classifyIpv6('fe80::1%eth0')).toBe('link_local');
  });

  it('routes through classifyAddress by shape', () => {
    expect(classifyAddress('127.0.0.1')).toBe('loopback');
    expect(classifyAddress('::1')).toBe('loopback');
  });
});

describe('address permission', () => {
  it('NEVER permits metadata, link-local, unspecified, multicast, reserved or unparsable — under any policy', () => {
    for (const policy of [DEFAULT, LOOPBACK, PRIVATE_OK]) {
      for (const klass of ['cloud_metadata', 'link_local', 'unspecified', 'multicast', 'reserved', 'unparsable'] as const) {
        expect(addressPermitted(klass, policy).permitted, klass).toBe(false);
      }
    }
  });

  it('blocks loopback by DEFAULT and permits it only under the explicit test policy', () => {
    expect(addressPermitted('loopback', DEFAULT).permitted).toBe(false);
    expect(addressPermitted('loopback', DEFAULT).reason).toContain('explicit test network policy');
    expect(addressPermitted('loopback', LOOPBACK).permitted).toBe(true);
  });

  it('blocks private networks by DEFAULT and permits them only under an explicit private-network policy', () => {
    expect(addressPermitted('private', DEFAULT).permitted).toBe(false);
    expect(addressPermitted('private', PRIVATE_OK).permitted).toBe(true);
  });

  it('permits public addresses', () => {
    expect(addressPermitted('public', DEFAULT).permitted).toBe(true);
  });
});

/* ==================================================================== *
 * URL POLICY
 * ==================================================================== */

describe('URL policy', () => {
  it('accepts an ordinary https endpoint', () => {
    expect(checkUrlPolicy('https://mcp.example.com/mcp', DEFAULT).allowed).toBe(true);
  });

  it('refuses non-http schemes', () => {
    for (const url of ['file:///etc/passwd', 'ftp://x/y', 'gopher://x', 'ws://x/y']) {
      expect(checkUrlPolicy(url, DEFAULT).allowed, url).toBe(false);
    }
  });

  it('REFUSES embedded credentials rather than stripping them', () => {
    const verdict = checkUrlPolicy('https://user:pw@mcp.example.com/mcp', DEFAULT);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('userinfo');
  });

  it('refuses a fragment', () => {
    expect(checkUrlPolicy('https://mcp.example.com/mcp#frag', DEFAULT).allowed).toBe(false);
  });

  it('refuses an unparsable URL', () => {
    expect(checkUrlPolicy('not a url', DEFAULT).allowed).toBe(false);
  });

  it('refuses plain HTTP by default', () => {
    const verdict = checkUrlPolicy('http://mcp.example.com/mcp', DEFAULT);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('https');
  });

  it('refuses plain HTTP to a PUBLIC destination even when allowPlainHttp is set', () => {
    const permissive = { ...DEFAULT, allowPlainHttp: true };
    expect(checkUrlPolicy('http://8.8.8.8/mcp', permissive).allowed).toBe(false);
  });

  it('permits plain HTTP to loopback under the explicit test policy', () => {
    expect(checkUrlPolicy('http://127.0.0.1:5555/mcp', LOOPBACK).allowed).toBe(true);
  });

  it('refuses a literal metadata address outright', () => {
    const verdict = checkUrlPolicy('https://169.254.169.254/latest/meta-data/', DEFAULT);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('metadata');
  });

  it('refuses a literal loopback address under the default policy', () => {
    expect(checkUrlPolicy('https://127.0.0.1/mcp', DEFAULT).allowed).toBe(false);
  });

  it('reports the literal address class so DNS can be skipped for literals', () => {
    expect(checkUrlPolicy('https://8.8.8.8/mcp', DEFAULT).literalAddressClass).toBe('public');
    expect(checkUrlPolicy('https://mcp.example.com/mcp', DEFAULT).literalAddressClass).toBeNull();
  });
});

/* ==================================================================== *
 * DNS — the attack a string check cannot see
 * ==================================================================== */

describe('resolved-address policy', () => {
  it('REFUSES a public-LOOKING hostname that resolves to cloud metadata', async () => {
    const resolver = fixedResolver({ 'totally-normal.example.com': ['169.254.169.254'] });
    const verdict = await checkResolvedAddresses('totally-normal.example.com', resolver, DEFAULT);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('169.254.169.254');
    expect(verdict.reason).toContain('metadata');
  });

  it('REFUSES a hostname that resolves to a private address', async () => {
    const resolver = fixedResolver({ 'internal.example.com': ['10.0.0.7'] });
    expect((await checkResolvedAddresses('internal.example.com', resolver, DEFAULT)).allowed).toBe(false);
  });

  it('REFUSES a MIXED answer rather than picking the safe one', async () => {
    // Picking the public address hands address selection to whoever controls
    // the DNS record.
    const resolver = fixedResolver({ 'mixed.example.com': ['8.8.8.8', '169.254.169.254'] });
    const verdict = await checkResolvedAddresses('mixed.example.com', resolver, DEFAULT);
    expect(verdict.allowed).toBe(false);
  });

  it('permits an all-public answer and PINS the address it checked', async () => {
    const resolver = fixedResolver({ 'good.example.com': ['8.8.8.8', '1.1.1.1'] });
    const verdict = await checkResolvedAddresses('good.example.com', resolver, DEFAULT);
    expect(verdict.allowed).toBe(true);
    expect(verdict.pinnedAddress).toBe('8.8.8.8');
  });

  it('refuses when resolution fails or is empty', async () => {
    expect((await checkResolvedAddresses('nope.example.com', fixedResolver({}), DEFAULT)).allowed).toBe(false);
    expect((await checkResolvedAddresses('empty.example.com', fixedResolver({ 'empty.example.com': [] }), DEFAULT)).allowed).toBe(false);
  });

  it('the loopback-only test resolver refuses every external name', async () => {
    await expect(loopbackOnlyResolver.resolve('example.com')).rejects.toThrow(/RELAY TEST GUARD/);
    expect(await loopbackOnlyResolver.resolve('127.0.0.1')).toEqual(['127.0.0.1']);
  });
});

/* ==================================================================== *
 * REDIRECTS
 * ==================================================================== */

describe('redirect policy', () => {
  const from = new URL('https://mcp.example.com/mcp');

  it('permits a same-origin redirect and KEEPS credentials', () => {
    const verdict = checkRedirect(from, '/mcp/v2', 1, DEFAULT);
    expect(verdict.allowed).toBe(true);
    expect(verdict.mayForwardCredentials).toBe(true);
  });

  it('permits a cross-origin redirect but DROPS credentials', () => {
    const verdict = checkRedirect(from, 'https://other.example.com/mcp', 1, DEFAULT);
    expect(verdict.allowed).toBe(true);
    expect(verdict.mayForwardCredentials).toBe(false);
  });

  it('REFUSES a redirect to a metadata address', () => {
    const verdict = checkRedirect(from, 'http://169.254.169.254/latest/', 1, DEFAULT);
    expect(verdict.allowed).toBe(false);
    expect(verdict.mayForwardCredentials).toBe(false);
  });

  it('REFUSES a redirect to a loopback address under the default policy', () => {
    expect(checkRedirect(from, 'http://127.0.0.1:9999/', 1, DEFAULT).allowed).toBe(false);
  });

  it('caps the redirect count', () => {
    const verdict = checkRedirect(from, 'https://mcp.example.com/again', DEFAULT.maximumRedirects + 1, DEFAULT);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('redirected more than');
  });

  it('refuses an unparsable redirect target', () => {
    expect(checkRedirect(from, 'http://[bad', 1, DEFAULT).allowed).toBe(false);
  });

  it('computes origins without a path', () => {
    expect(originOf(new URL('https://a.example.com:8443/x/y?z=1'))).toBe('https://a.example.com:8443');
  });
});

/* ==================================================================== *
 * CONTENT TYPE
 * ==================================================================== */

describe('content-type policy', () => {
  it('accepts only JSON and SSE', () => {
    expect(contentTypeAcceptable('application/json')).toBe(true);
    expect(contentTypeAcceptable('application/json; charset=utf-8')).toBe(true);
    expect(contentTypeAcceptable('text/event-stream')).toBe(true);
  });

  it('rejects an HTML error page and a missing header', () => {
    expect(contentTypeAcceptable('text/html')).toBe(false);
    expect(contentTypeAcceptable(null)).toBe(false);
    expect(contentTypeAcceptable('application/octet-stream')).toBe(false);
  });
});

/* ==================================================================== *
 * DEFAULTS
 * ==================================================================== */

describe('the default network policy is closed', () => {
  it('has every unsafe capability off', () => {
    expect(DEFAULT.allowLoopbackForTesting).toBe(false);
    expect(DEFAULT.allowPrivateNetwork).toBe(false);
    expect(DEFAULT.allowPlainHttp).toBe(false);
    expect(DEFAULT.maximumRedirects).toBeLessThanOrEqual(5);
    expect(DEFAULT.maximumResponseBytes).toBeGreaterThan(0);
    expect(DEFAULT.connectTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT.requestTimeoutMs).toBeGreaterThan(0);
  });

  it('the loopback test policy differs ONLY in the ways it must', () => {
    expect(LOOPBACK.allowLoopbackForTesting).toBe(true);
    expect(LOOPBACK.allowPrivateNetwork).toBe(false);
  });
});
