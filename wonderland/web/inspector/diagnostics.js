// The inspector's verdicts, with no DOM in sight.
//
// These ARE the tool. A viewer that shows a mesh is a viewer; what makes this
// worth building is that it answers, on a laptop, the questions that have cost
// this project metered L4 sessions. So they live apart from the rendering, get
// tested against fabricated broken worlds, and are proven to FIRE rather than
// proven to exist.
//
// Every verdict is one of: ok, bad, warn, pending. "pending" means the input to
// answer it is absent — never a pass.

const OK = 'ok', BAD = 'bad', WARN = 'warn', PENDING = 'pending';

const row = (kind, text, why) => ({ kind, text, why: why || null });
const fmt = (a) => a.map((v) => v.toFixed(0)).join(', ');

/**
 * @param {object} input
 *  contract           the placement contract
 *  visual             {extent:[x,y,z], centre:[x,y,z]} in UNREAL cm, or null
 *  collider           same shape, or null
 *  originPlaced       [x,y,z] where the mesh origin actually landed, or null
 *  camera             a contract camera, or null for free orbit
 *  frustumFraction    0..1 of far sampled geometry inside the frame, or null
 */
export function evaluate(input) {
  const { contract, visual, collider, originPlaced, camera, frustumFraction } = input;
  const out = [];
  if (!contract) return [row(PENDING, 'no contract loaded')];

  if (!visual) {
    out.push(row(PENDING, 'no visual mesh loaded',
      'placement cannot be checked against geometry that is not here'));
  } else {
    out.push(scaleVerdict(contract, visual));
    out.push(flipVerdict(contract, visual));
    if (originPlaced) out.push(originVerdict(contract, originPlaced));
  }

  out.push(cameraVerdict(contract, camera, frustumFraction));

  if (collider && visual) out.push(registrationVerdict(visual, collider));
  return out.filter(Boolean);
}

function scaleVerdict(contract, visual) {
  const expected = contract.extent?.expected_unreal_extent_cm;
  if (!expected) {
    return row(WARN, 'No expected extent in the contract — scale NOT checked',
      'an absent check is not a passing one');
  }
  const ratios = expected.map((e, i) => visual.extent[i] / e);
  const worst = Math.max(...ratios.map((r) => Math.max(r, 1 / r)));
  if (worst <= 1.02) {
    return row(OK, `Scale matches the engine measurement (worst ratio ${worst.toFixed(4)})`);
  }
  const hint = worst > 50
    ? 'A ratio near 100 means the metre-to-centimetre conversion was applied twice: Unreal’s glTF import already does it.'
    : 'Compare transform.unreal_uniform_scale and unreal_backdrop_scale against the manifest.';
  return row(BAD, `WRONG SCALE by about ${worst.toFixed(3)}x`,
    `measured ${fmt(visual.extent)} cm, expected ${fmt(expected)} cm. ${hint}`);
}

function flipVerdict(contract, visual) {
  const predicted = contract.extent?.centre_offset_from_origin_cm;
  const origin = contract.placement?.origin_cm;
  if (!predicted || !origin) {
    return row(WARN, 'No predicted centre offset — orientation NOT checked',
      'this is the only check that can see a flip, because a flip changes no extent');
  }
  const measured = visual.centre.map((v, i) => v - origin[i]);
  const scale = Math.max(...predicted.map(Math.abs)) || 1;
  const wrong = [0, 1, 2].filter((i) =>
    Math.abs(predicted[i]) > 0.05 * scale &&
    Math.abs(measured[i]) > 0.05 * scale &&
    predicted[i] * measured[i] < 0);
  if (!wrong.length) {
    return row(OK, 'Right way up — the geometry sits where the contract predicts',
      `centre offset ${fmt(measured)} cm vs predicted ${fmt(predicted)} cm`);
  }
  return row(BAD, `FLIPPED on ${wrong.map((i) => 'XYZ'[i]).join('')}`,
    `The centre should sit ${fmt(predicted)} cm from the origin and sits ${fmt(measured)}. ` +
    'Every extent is identical either way, which is why no size check can see it. ' +
    'Check transform.axis_correction_deg against the GLB’s node rotation.');
}

function originVerdict(contract, originPlaced) {
  const origin = contract.placement.origin_cm;
  const drift = Math.hypot(...originPlaced.map((v, i) => v - origin[i]));
  if (drift <= 0.5) {
    return row(OK, `Origin lands on ${contract.placement.anchor_camera || 'the anchor'}`,
      'every ray from that point is unchanged by the backdrop scale, which is what makes it free');
  }
  return row(BAD, `Origin is ${drift.toFixed(1)} cm off the anchor`,
    'a backdrop anchored anywhere else does not survive being scaled');
}

function cameraVerdict(contract, camera, frustumFraction) {
  if (!camera) {
    return row(PENDING, 'Free orbit — pick a hero camera to check its framing');
  }
  const skyline = contract.skyline_elevation_deg;
  const [bottom, top] = camera.frame_elevation_deg;
  if (typeof skyline !== 'number') {
    return row(WARN, `${camera.tag} framing NOT checked`,
      'the contract states no skyline elevation to check it against');
  }
  if (top >= skyline) {
    const extra = frustumFraction === null || frustumFraction === undefined ? ''
      : ` ${(100 * frustumFraction).toFixed(1)}% of far geometry is inside the frame.`;
    return row(OK, `${camera.tag} reaches the castle skyline`,
      `frame tops out at ${top.toFixed(1)}°, the skyline sits at ${skyline}°.${extra}`);
  }
  return row(BAD, `${camera.tag} CANNOT see the castle skyline`,
    `frame covers ${bottom.toFixed(1)}° to ${top.toFixed(1)}° and the skyline sits at ` +
    `${skyline}°. The limit is ELEVATION, not rotation — no yaw fixes this.`);
}

function registrationVerdict(visual, collider) {
  const delta = Math.hypot(...collider.centre.map((v, i) => v - visual.centre[i]));
  const span = Math.hypot(...visual.extent) || 1;
  const rel = delta / span;
  if (rel <= 0.05) {
    return row(OK, 'Visual and collider register',
      `centres ${delta.toFixed(0)} cm apart, ${(100 * rel).toFixed(1)}% of the visual span`);
  }
  return row(BAD, 'Visual and collider DO NOT register',
    `centres ${delta.toFixed(0)} cm apart (${(100 * rel).toFixed(1)}% of the span). ` +
    'Marble’s collider export carries no node rotation while the visual mesh does, ' +
    'so the two need different axis corrections.');
}

export const KINDS = { OK, BAD, WARN, PENDING };
