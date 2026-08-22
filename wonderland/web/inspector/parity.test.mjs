// The browser and Unreal must place a point in the SAME spot, or the inspector
// cannot be trusted to find a placement bug.
//
// This is the whole reason the placement contract exists. A JavaScript
// reimplementation of the chain would agree with Python right up until one of
// them was the bug, and then the tool built to catch flipped imports would
// reproduce the flip. So: python3 transforms a set of points through
// placement.py, this transforms the same points through the contract, and the
// two are compared to the micron.
//
//   node wonderland/web/inspector/parity.test.mjs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { unrealPlacement, handedness, forwardFromRotator, verticalFov, basisMatrix }
  from './placement.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARBLE = path.resolve(HERE, '../../marble');
const WORLD = path.join(MARBLE, 'worlds', 'royal-garden-backdrop');

let pass = 0; const fail = [];
const ok = (n) => { pass += 1; console.log(`  ok   ${n}`); };
const bad = (n, d) => { fail.push(n); console.log(`  FAIL ${n}${d ? `\n         ${d}` : ''}`); };
const check = (n, cond, d) => (cond ? ok(n) : bad(n, d));

const py = (script) => execFileSync('python3', ['-c', script], { encoding: 'utf8' }).trim();

const contract = JSON.parse(py(`
import json,sys
sys.path.insert(0, ${JSON.stringify(MARBLE)})
import placement_contract
print(json.dumps(placement_contract.build(${JSON.stringify(WORLD)})))
`));

// Points chosen to exercise every axis independently plus the corners.
const POINTS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
                [-49.38, -72.215, -0.941], [47.599, 75.726, 80.492], [3.5, -2.25, 11.75]];

const reference = JSON.parse(py(`
import json,sys
sys.path.insert(0, ${JSON.stringify(MARBLE)})
import placement
m = json.load(open(${JSON.stringify(path.join(WORLD, 'manifest.json'))}))
place = placement.placement_from(m)
node = placement.node_rotation(m)
out = []
for p in ${JSON.stringify(POINTS)}:
    g = tuple(node[i][0]*p[0] + node[i][1]*p[1] + node[i][2]*p[2] for i in range(3))
    out.append(list(place(g)))
print(json.dumps(out))
`));

console.log('== a point lands in the same place in both languages ==');
const nodeM = basisMatrix(contract.placement.node_rotation_rows);
const placeM = unrealPlacement(contract);
let worst = 0;
POINTS.forEach((p, i) => {
  const v = new THREE.Vector3(...p).applyMatrix4(nodeM).applyMatrix4(placeM);
  const r = reference[i];
  worst = Math.max(worst, Math.abs(v.x - r[0]), Math.abs(v.y - r[1]), Math.abs(v.z - r[2]));
});
check(`all ${POINTS.length} sample points agree with placement.py`, worst < 1e-6,
  `worst component disagreement ${worst} cm`);
check('…to well under a micron, not merely "close"', worst < 1e-7,
  `worst ${worst} cm — a loose tolerance here would hide a real basis error`);

console.log('== the handedness conversion is its own inverse ==');
const h = handedness(contract);
const round = new THREE.Vector3(123.5, -456.25, 789.125).applyMatrix4(h).applyMatrix4(h);
check('applying it twice returns the original point',
  round.distanceTo(new THREE.Vector3(123.5, -456.25, 789.125)) < 1e-9);
check('…and it flips exactly one axis, so left-handed becomes right-handed',
  Math.sign(new THREE.Matrix4().copy(h).determinant()) === -1,
  'a conversion with a positive determinant changes nothing about handedness');

console.log('== the extent the contract predicts is the extent the engine measured ==');
const expected = contract.extent.expected_unreal_extent_cm;
const predicted = contract.extent.predicted_extent_cm;
check('component by component, in Unreal axis order',
  expected.every((e, i) => Math.abs(predicted[i] - e) / e < 1e-5),
  `predicted ${predicted} vs expected ${expected}`);

console.log('== the rotator agrees with placement.forward_from_rotator ==');
const fwdRef = JSON.parse(py(`
import json,sys
sys.path.insert(0, ${JSON.stringify(MARBLE)})
import placement
print(json.dumps([list(placement.forward_from_rotator(p, y)) for p, y in
                  [(-11.57, 90.0), (5.0, 90.0), (0.0, 0.0), (45.0, -135.0)]]))
`));
[[-11.57, 90.0], [5.0, 90.0], [0.0, 0.0], [45.0, -135.0]].forEach(([p, y], i) => {
  const v = forwardFromRotator(p, y), r = fwdRef[i];
  check(`forward at pitch ${p} yaw ${y}`,
    Math.max(Math.abs(v.x - r[0]), Math.abs(v.y - r[1]), Math.abs(v.z - r[2])) < 1e-12);
});

console.log('== the FOV conversion is Unreal-horizontal, not three.js-vertical ==');
const cam0 = contract.cameras.find((c) => c.index === 0);
const cam6 = contract.cameras.find((c) => c.index === 6);
check('HeroCam0 and HeroCam6 are both in the contract', !!cam0 && !!cam6);
check('HeroCam6 shares HeroCam0\'s position, so the backdrop anchor holds',
  JSON.stringify(cam0.location_cm) === JSON.stringify(cam6.location_cm),
  `${cam0?.location_cm} vs ${cam6?.location_cm}`);
const v0 = verticalFov(cam0.fov_horizontal_deg, 16 / 9);
check('62° horizontal on 16:9 is a smaller vertical angle', v0 < cam0.fov_horizontal_deg && v0 > 30,
  `got ${v0.toFixed(3)}°`);
const derived = 2 * THREE.MathUtils.radToDeg(Math.atan(
  Math.tan(THREE.MathUtils.degToRad(v0) / 2) * (16 / 9)));
check('…and converting back returns the horizontal angle', Math.abs(derived - cam0.fov_horizontal_deg) < 1e-9);
check('the contract\'s frame_elevation matches pitch ± half the vertical angle',
  Math.abs((cam0.pitch_deg + v0 / 2) - cam0.frame_elevation_deg[1]) < 1e-3,
  `contract says ${cam0.frame_elevation_deg[1]}, derived ${(cam0.pitch_deg + v0 / 2).toFixed(4)}`);

console.log('== the contract carries what the inspector must not compute itself ==');
for (const key of ['basis_rows', 'unreal_units_per_gltf_unit', 'origin_cm', 'z_offset_cm',
                   'node_rotation_rows']) {
  check(`placement.${key} is present`, contract.placement[key] !== undefined);
}
check('a skyline elevation is stated, measured rather than assumed',
  typeof contract.skyline_elevation_deg === 'number');
check('and every camera carries the frame it covers',
  contract.cameras.every((c) => Array.isArray(c.frame_elevation_deg)));

console.log(`\npassed ${pass}, failed ${fail.length}`);
for (const f of fail) console.log(`  FAILED: ${f}`);
process.exit(fail.length ? 1 : 0);
