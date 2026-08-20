import { describe, expect, it } from 'vitest';

import type { MarbleGenerationRequest, MarbleWorldRegion } from './marble-contracts';
import {
  applyProviderOperation,
  isSubmittable,
  manifestReadiness,
  marbleDedupeKey,
  markSubmitted,
  newMarbleOperation,
  readMarbleManifest,
  validateMarbleRequest,
} from './marble-operations';
import {
  approveMarbleGeneration,
  decideMarbleGate,
  leaksMarbleSecret,
  marbleEvent,
  readMarbleConfig,
  redactMarbleSecrets,
  requestMarbleApproval,
} from './marble-gate';
import { MockMarbleProvider, toWorldLabsGenerateBody } from './marble-provider';
import { decideRegionBinding, rendererIsUsable, stagedImport, unevaluatedRenderer } from './marble-region';

const NOW = '2026-08-19T12:00:00.000Z';

function req(over: Partial<MarbleGenerationRequest> = {}): MarbleGenerationRequest {
  return {
    requestId: 'req-1',
    projectId: 'proj-a',
    regionId: 'hero-corridor',
    displayName: 'Arrival Plaza surround',
    model: 'marble-1.1',
    promptType: 'text',
    textPrompt: 'a lush ornate fantasy garden city',
    requestedAtIso: NOW,
    requestedBy: 'founder',
    ...over,
  };
}

const REGION: MarbleWorldRegion = {
  regionId: 'hero-corridor',
  displayName: 'Arrival Plaza / Golden Build Gate / Great Framing Tree',
  authoritativeAnchors: ['golden_gate', 'cam_arrival_hero', 'player_spawn', 'relay_dog'],
  boundsUu: { minX: -4000, minY: -3000, maxX: 4000, maxY: 6000 },
};

const ENABLED = {
  MARBLE_ENABLED: 'true',
  MARBLE_LIVE_GENERATION_ALLOWED: 'true',
  WORLDLABS_API_KEY: 'wl_abcdefghijklmnopqrstuv',
};

describe('request validation', () => {
  it('accepts a well-formed text request', () => {
    expect(validateMarbleRequest(req(), REGION).ok).toBe(true);
  });

  it('rejects a text request with no prompt', () => {
    const v = validateMarbleRequest(req({ textPrompt: '   ' }));
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toContain('textPrompt is required');
  });

  it('rejects an image request with no references', () => {
    const v = validateMarbleRequest(req({ promptType: 'image', textPrompt: null }));
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toContain('at least one image reference');
  });

  it('rejects an image request carrying several references', () => {
    const v = validateMarbleRequest(
      req({
        promptType: 'image',
        textPrompt: null,
        imageRefs: [
          { source: 'uri', value: 'a' },
          { source: 'uri', value: 'b' },
        ],
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toContain('multi-image');
  });

  it('refuses a request bound to a different region than the one supplied', () => {
    const v = validateMarbleRequest(req({ regionId: 'somewhere-else' }), REGION);
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toContain('does not match');
  });
});

describe('the generate body uses the documented World Labs field names', () => {
  it('builds a text prompt body', () => {
    const b = toWorldLabsGenerateBody(req());
    expect(b).toHaveProperty('display_name');
    expect(b).toHaveProperty('model');
    expect(b.world_prompt).toEqual({
      type: 'text',
      text_prompt: 'a lush ornate fantasy garden city',
    });
  });

  it('uses media_asset_id for an uploaded asset and uri for a link', () => {
    const uri = toWorldLabsGenerateBody(
      req({ promptType: 'image', imageRefs: [{ source: 'uri', value: 'https://x/y.png' }] }),
    );
    expect(uri.world_prompt).toEqual({
      type: 'image',
      image_prompt: { source: 'uri', uri: 'https://x/y.png' },
    });
    const asset = toWorldLabsGenerateBody(
      req({ promptType: 'image', imageRefs: [{ source: 'media_asset', value: 'ma-1' }] }),
    );
    expect(asset.world_prompt).toEqual({
      type: 'image',
      image_prompt: { source: 'media_asset', media_asset_id: 'ma-1' },
    });
  });
});

describe('the feature flag is fail-closed', () => {
  it('is off when unset', () => {
    const c = readMarbleConfig({});
    expect(c.enabled).toBe(false);
    expect(c.liveGenerationAllowed).toBe(false);
    expect(c.credentialConfigured).toBe(false);
  });

  it('is off for every plausible near-miss value', () => {
    for (const v of ['1', 'yes', 'TRUE', 'True', 'on', ' true']) {
      expect(readMarbleConfig({ MARBLE_ENABLED: v }).enabled).toBe(false);
    }
    expect(readMarbleConfig({ MARBLE_ENABLED: 'true' }).enabled).toBe(true);
  });

  it('reports a credential as configured without ever holding it', () => {
    const c = readMarbleConfig(ENABLED);
    expect(c.credentialConfigured).toBe(true);
    expect(JSON.stringify(c)).not.toContain('wl_abcdefghijklmnopqrstuv');
  });
});

describe('nothing billable happens without explicit approval', () => {
  const approvedOp = () => {
    const op = newMarbleOperation(req());
    return approveMarbleGeneration(requestMarbleApproval(op), 'founder', NOW);
  };

  it('refuses when the feature is disabled', () => {
    const d = decideMarbleGate({
      config: readMarbleConfig({}),
      operation: approvedOp(),
      liveInFlight: 0,
    });
    expect(d.allowed).toBe(false);
    expect(d.refusal).toBe('feature_disabled');
  });

  it('refuses when live generation is not separately allowed', () => {
    const d = decideMarbleGate({
      config: readMarbleConfig({ MARBLE_ENABLED: 'true', WORLDLABS_API_KEY: 'wl_x'.padEnd(24, 'y') }),
      operation: approvedOp(),
      liveInFlight: 0,
    });
    expect(d.refusal).toBe('live_generation_not_allowed');
  });

  it('refuses when no credential is configured', () => {
    const d = decideMarbleGate({
      config: readMarbleConfig({ MARBLE_ENABLED: 'true', MARBLE_LIVE_GENERATION_ALLOWED: 'true' }),
      operation: approvedOp(),
      liveInFlight: 0,
    });
    expect(d.refusal).toBe('no_credential');
  });

  it('refuses an unapproved operation even with everything else enabled', () => {
    const d = decideMarbleGate({
      config: readMarbleConfig(ENABLED),
      operation: newMarbleOperation(req()),
      liveInFlight: 0,
    });
    expect(d.refusal).toBe('not_approved');
  });

  it('allows only a fully approved operation with the feature on', () => {
    const d = decideMarbleGate({
      config: readMarbleConfig(ENABLED),
      operation: approvedOp(),
      liveInFlight: 0,
    });
    expect(d.allowed).toBe(true);
  });

  it('refuses approval with no identity attached', () => {
    expect(() => approveMarbleGeneration(requestMarbleApproval(newMarbleOperation(req())), '  ', NOW)).toThrow();
  });

  it('refuses to approve straight from draft', () => {
    expect(() => approveMarbleGeneration(newMarbleOperation(req()), 'founder', NOW)).toThrow();
  });

  it('honours the concurrency ceiling', () => {
    const d = decideMarbleGate({
      config: readMarbleConfig({ ...ENABLED, MARBLE_MAX_CONCURRENT: '2' }),
      operation: approvedOp(),
      liveInFlight: 2,
    });
    expect(d.refusal).toBe('concurrency_limit');
  });
});

describe('a retry never becomes a second bill', () => {
  it('an operation with a provider id is not submittable', () => {
    const op = markSubmitted(
      approveMarbleGeneration(requestMarbleApproval(newMarbleOperation(req())), 'founder', NOW),
      'op-123',
      NOW,
    );
    expect(isSubmittable(op)).toBe(false);
    expect(() => markSubmitted(op, 'op-456', NOW)).toThrow(/already has provider operation/);
  });

  it('the gate refuses to resend a submitted operation', () => {
    const op = markSubmitted(
      approveMarbleGeneration(requestMarbleApproval(newMarbleOperation(req())), 'founder', NOW),
      'op-123',
      NOW,
    );
    const d = decideMarbleGate({ config: readMarbleConfig(ENABLED), operation: op, liveInFlight: 0 });
    expect(d.refusal).toBe('already_submitted');
    expect(d.detail).toContain('poll it');
  });

  it('polling the same payload twice leaves the record unchanged', () => {
    const op = markSubmitted(
      approveMarbleGeneration(requestMarbleApproval(newMarbleOperation(req())), 'founder', NOW),
      'op-123',
      NOW,
    );
    const payload = {
      operation_id: 'op-123',
      done: false,
      error: null,
      metadata: { world_id: 'w-1', progress: { status: 'IN_PROGRESS' } },
    } as const;
    const once = applyProviderOperation(op, payload, NOW);
    const twice = applyProviderOperation(once, payload, NOW);
    expect(twice).toEqual(once);
  });

  it('refuses a payload belonging to a different operation', () => {
    const op = markSubmitted(
      approveMarbleGeneration(requestMarbleApproval(newMarbleOperation(req())), 'founder', NOW),
      'op-123',
      NOW,
    );
    expect(() =>
      applyProviderOperation(op, { operation_id: 'op-999', done: true } as never, NOW),
    ).toThrow(/mismatch/);
  });

  it('a terminal operation cannot be reopened by a late poll', () => {
    let op = markSubmitted(
      approveMarbleGeneration(requestMarbleApproval(newMarbleOperation(req())), 'founder', NOW),
      'op-123',
      NOW,
    );
    op = applyProviderOperation(
      op,
      {
        operation_id: 'op-123',
        done: true,
        error: { code: 'X', message: 'generation failed' },
        metadata: { world_id: 'w-1', progress: { status: 'IN_PROGRESS' } },
      },
      NOW,
    );
    expect(op.state).toBe('failed');
    const later = applyProviderOperation(
      op,
      { operation_id: 'op-123', done: false, error: null, metadata: {} },
      NOW,
    );
    expect(later.state).toBe('failed');
  });
});

describe('caching and cross-project isolation', () => {
  it('the same ask twice produces the same dedupe key', () => {
    expect(marbleDedupeKey(req({ requestId: 'a', requestedBy: 'x' }))).toBe(
      marbleDedupeKey(req({ requestId: 'b', requestedBy: 'y' })),
    );
  });

  it('a different project never reuses another project world', () => {
    expect(marbleDedupeKey(req({ projectId: 'proj-a' }))).not.toBe(
      marbleDedupeKey(req({ projectId: 'proj-b' })),
    );
  });

  it('the gate refuses a duplicate and names the world to reuse', () => {
    const op = approveMarbleGeneration(requestMarbleApproval(newMarbleOperation(req())), 'founder', NOW);
    const d = decideMarbleGate({
      config: readMarbleConfig(ENABLED),
      operation: op,
      liveInFlight: 0,
      existingWorldByDedupe: { [op.dedupeKey]: 'world-existing' },
    });
    expect(d.refusal).toBe('duplicate_request');
    expect(d.detail).toContain('world-existing');
  });

  it('a duplicate in ANOTHER project does not block generation', () => {
    const op = approveMarbleGeneration(requestMarbleApproval(newMarbleOperation(req())), 'founder', NOW);
    const otherKey = marbleDedupeKey(req({ projectId: 'proj-b' }));
    const d = decideMarbleGate({
      config: readMarbleConfig(ENABLED),
      operation: op,
      liveInFlight: 0,
      existingWorldByDedupe: { [otherKey]: 'world-of-other-project' },
    });
    expect(d.allowed).toBe(true);
  });
});

describe('malformed and incomplete provider responses', () => {
  it('done with no world is a failure, not an empty success', () => {
    const op = markSubmitted(
      approveMarbleGeneration(requestMarbleApproval(newMarbleOperation(req())), 'founder', NOW),
      'op-1',
      NOW,
    );
    const out = applyProviderOperation(
      op,
      { operation_id: 'op-1', done: true, error: null, metadata: {}, response: { world: null } },
      NOW,
    );
    expect(out.state).toBe('failed');
    expect(out.failure).toContain('no world');
  });

  it('a world with no assets reads as all-unknown rather than throwing', () => {
    const m = readMarbleManifest({ id: 'w-1' });
    expect(m.colliderMeshUrl).toBeNull();
    expect(m.panoUrl).toBeNull();
    expect(m.metricScaleFactor).toBeNull();
    expect(Object.keys(m.splatUrls)).toHaveLength(0);
  });

  it('unknown is never coerced to zero', () => {
    const m = readMarbleManifest({
      id: 'w-1',
      assets: { splats: { semantics_metadata: { metric_scale_factor: null } } },
    });
    expect(m.metricScaleFactor).toBeNull();
    expect(m.metricScaleFactor).not.toBe(0);
  });

  it('empty-string asset urls are dropped rather than kept as usable', () => {
    const m = readMarbleManifest({
      id: 'w-1',
      assets: { splats: { spz_urls: { '100k': '', '500k': 'https://x/500k.spz' } } },
    });
    expect(m.splatUrls['100k']).toBeUndefined();
    expect(m.splatUrls['500k']).toBe('https://x/500k.spz');
  });
});

describe('splat and collider are associated but not conflated', () => {
  it('a world with splats and no collider is renderable but not walkable', async () => {
    const p = new MockMarbleProvider({ omitCollider: true });
    const m = readMarbleManifest(await p.fetchWorld('w-1'));
    const r = manifestReadiness(m);
    expect(r.renderable).toBe(true);
    expect(r.walkable).toBe(false);
    expect(r.missing).toContain('collider_mesh');
  });

  it('a world with no splats is not renderable at all', async () => {
    const p = new MockMarbleProvider({ omitSplats: true });
    const r = manifestReadiness(readMarbleManifest(await p.fetchWorld('w-2')));
    expect(r.renderable).toBe(false);
  });
});

describe('binding to an authored region', () => {
  const goodRenderer = {
    ...unevaluatedRenderer('candidate-x'),
    ue58Compatible: true,
    linuxPackaging: true,
    pixelStreamingVerified: true,
    opaqueOccluderSupport: true,
  };

  it('an unevaluated renderer is unknown, not usable', () => {
    const r = rendererIsUsable(unevaluatedRenderer('nobody-checked'));
    expect(r.usable).toBe(false);
    expect(r.unknown).toContain('ue58Compatible');
    expect(r.failed).toHaveLength(0);
  });

  it('refuses to bind with no renderer selected', async () => {
    const m = readMarbleManifest(await new MockMarbleProvider().fetchWorld('w-1'));
    const d = decideRegionBinding({ region: REGION, manifest: m, renderer: null });
    expect(d.bound).toBe(false);
    expect(d.reasons.join(' ')).toContain('no splat renderer selected');
  });

  it('refuses a binding that would displace an authored anchor', async () => {
    const m = readMarbleManifest(await new MockMarbleProvider().fetchWorld('w-1'));
    const d = decideRegionBinding({
      region: REGION,
      manifest: m,
      renderer: goodRenderer,
      displacedAnchors: ['golden_gate'],
    });
    expect(d.bound).toBe(false);
    expect(d.reasons.join(' ')).toContain('layout is authoritative');
  });

  it('binds as backdrop_only when there is no collider', async () => {
    const m = readMarbleManifest(await new MockMarbleProvider({ omitCollider: true }).fetchWorld('w-1'));
    const d = decideRegionBinding({ region: REGION, manifest: m, renderer: goodRenderer });
    expect(d.bound).toBe(true);
    expect(d.capability).toBe('backdrop_only');
  });

  it('binds as walkable when a collider is present', async () => {
    const m = readMarbleManifest(await new MockMarbleProvider().fetchWorld('w-1'));
    const d = decideRegionBinding({ region: REGION, manifest: m, renderer: goodRenderer });
    expect(d.capability).toBe('walkable');
  });

  it('a staged import claims nothing', () => {
    const s = stagedImport('req-1', 'hero-corridor');
    expect(s.splatImported).toBe(false);
    expect(s.colliderImported).toBe(false);
    expect(s.importedAtIso).toBeNull();
  });
});

describe('credentials never leave the server', () => {
  it('redacts credential shapes from free text', () => {
    const t = redactMarbleSecrets('failed with WLT-Api-Key: wl_abcdefghijklmnopqrst and more');
    expect(t).not.toContain('wl_abcdefghijklmnopqrst');
    expect(t).toContain('[redacted]');
  });

  it('detects a credential-shaped value anywhere in a payload', () => {
    expect(leaksMarbleSecret({ nested: { note: 'wl_abcdefghijklmnopqrstuvwx' } })).toBe(true);
    expect(leaksMarbleSecret({ nested: { note: 'nothing to see' } })).toBe(false);
  });

  it('detects a server-only field name regardless of case', () => {
    expect(leaksMarbleSecret({ ApiKey: 'x' })).toBe(true);
    expect(leaksMarbleSecret({ Authorization: 'x' })).toBe(true);
  });

  it('survives a cyclic payload without hanging', () => {
    const a: Record<string, unknown> = { name: 'ok' };
    a.self = a;
    expect(leaksMarbleSecret(a)).toBe(false);
  });

  it('an event built from a leaky provider error records no credential', () => {
    const e = marbleEvent('MarbleGenerationStarted', req(), NOW, {
      providerMessage: 'rejected: WLT-Api-Key: wl_abcdefghijklmnopqrst',
    });
    expect(JSON.stringify(e)).not.toContain('wl_abcdefghijklmnopqrst');
    expect(leaksMarbleSecret(e)).toBe(false);
  });
});

describe('the mock is the default and cannot cost anything', () => {
  it('reports itself as not billable', () => {
    expect(new MockMarbleProvider().billable).toBe(false);
  });

  it('runs the whole lifecycle without a network', async () => {
    const p = new MockMarbleProvider({ pollsBeforeDone: 2 });
    let op = approveMarbleGeneration(requestMarbleApproval(newMarbleOperation(req())), 'founder', NOW);
    const { operationId } = await p.submit(req());
    op = markSubmitted(op, operationId, NOW);

    op = applyProviderOperation(op, await p.poll(operationId), NOW);
    expect(op.state).toBe('running');

    op = applyProviderOperation(op, await p.poll(operationId), NOW);
    expect(op.state).toBe('succeeded');
    expect(op.worldId).not.toBeNull();

    const m = readMarbleManifest(await p.fetchWorld(op.worldId as string));
    expect(manifestReadiness(m).renderable).toBe(true);
  });

  it('surfaces a provider failure as a failed operation', async () => {
    const p = new MockMarbleProvider({ failWith: 'quota exhausted' });
    let op = approveMarbleGeneration(requestMarbleApproval(newMarbleOperation(req())), 'founder', NOW);
    const { operationId } = await p.submit(req());
    op = markSubmitted(op, operationId, NOW);
    op = applyProviderOperation(op, await p.poll(operationId), NOW);
    expect(op.state).toBe('failed');
    expect(op.failure).toContain('quota exhausted');
  });
});
