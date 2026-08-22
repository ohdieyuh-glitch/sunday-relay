// Prove the verdicts FIRE, against worlds broken on purpose.
//
// A diagnostic that has only ever been run on a healthy world is a diagnostic
// nobody knows the behaviour of. Each case below is a fault that has actually
// shipped in this project, or one the goal explicitly asks the inspector to
// catch.
//
//   node wonderland/web/inspector/diagnostics.test.mjs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { evaluate } from './diagnostics.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MARBLE = path.resolve(HERE, '../../marble');
const WORLD = path.join(MARBLE, 'worlds', 'royal-garden-backdrop');

let pass = 0; const fail = [];
const ok = (n) => { pass += 1; console.log(`  ok   ${n}`); };
const bad = (n, d) => { fail.push(n); console.log(`  FAIL ${n}${d ? `\n         ${d}` : ''}`); };
const check = (n, c, d) => (c ? ok(n) : bad(n, d));

const contract = JSON.parse(execFileSync('python3', ['-c', `
import json,sys
sys.path.insert(0, ${JSON.stringify(MARBLE)})
import placement_contract
print(json.dumps(placement_contract.build(${JSON.stringify(WORLD)})))
`], { encoding: 'utf8' }));

const clone = (o) => JSON.parse(JSON.stringify(o));
const origin = contract.placement.origin_cm;
const good = {
  extent: contract.extent.predicted_extent_cm.slice(),
  centre: contract.extent.centre_offset_from_origin_cm.map((v, i) => v + origin[i]),
};
const cam = (i) => contract.cameras.find((c) => c.index === i);
const find = (rows, needle) => rows.find((r) => r.text.includes(needle));
const kindsOf = (rows) => rows.map((r) => r.kind);

console.log('== a healthy world passes, and says why ==');
let rows = evaluate({ contract, visual: good, collider: null,
  originPlaced: origin.slice(), camera: cam(6), frustumFraction: 0.30 });
check('nothing is reported bad', !kindsOf(rows).includes('bad'), JSON.stringify(rows, null, 1));
check('scale is confirmed against the engine measurement', !!find(rows, 'Scale matches'));
check('orientation is confirmed', !!find(rows, 'Right way up'));
check('the origin is confirmed to land on the anchor', !!find(rows, 'Origin lands on'));
check('HeroCam6 is reported as reaching the skyline', !!find(rows, 'reaches the castle skyline'));

console.log('== the 100x scale error that shipped ==');
rows = evaluate({ contract, visual: { extent: good.extent.map((v) => v * 100), centre: good.centre },
  originPlaced: origin.slice(), camera: null });
const scaleRow = find(rows, 'WRONG SCALE');
check('a 100x world is REFUSED', scaleRow?.kind === 'bad');
check('…and the message names the metre/centimetre trap',
  /metre-to-centimetre/.test(scaleRow?.why || ''), scaleRow?.why);

console.log('== the 180-degree flip, which changes no extent ==');
const flipped = { extent: good.extent.slice(),
  centre: contract.extent.centre_offset_from_origin_cm.map((v, i) => origin[i] - v) };
rows = evaluate({ contract, visual: flipped, originPlaced: origin.slice(), camera: null });
const flipRow = find(rows, 'FLIPPED');
check('an upside-down world is REFUSED', flipRow?.kind === 'bad', JSON.stringify(rows.map(r=>r.text)));
check('…on the axes that are actually wrong', /FLIPPED on .*Z/.test(flipRow?.text || ''), flipRow?.text);
check('…while its extent check still PASSES, which is the whole point',
  find(rows, 'Scale matches')?.kind === 'ok');

console.log('== a backdrop anchored off the arrival camera ==');
rows = evaluate({ contract, visual: good, originPlaced: [origin[0] + 250, origin[1], origin[2]],
  camera: null });
check('an origin 250 cm off the anchor is REFUSED', find(rows, 'Origin is')?.kind === 'bad');

console.log('== the camera that cannot see what the backdrop cost ==');
rows = evaluate({ contract, visual: good, originPlaced: origin.slice(),
  camera: cam(0), frustumFraction: 0.009 });
const camRow = find(rows, 'CANNOT see');
check('HeroCam0 is REFUSED as an arrival that shows the skyline', camRow?.kind === 'bad');
check('…and the message says the limit is elevation, not yaw',
  /ELEVATION, not rotation/.test(camRow?.why || ''), camRow?.why);
check('…and HeroCam6 at the same point is accepted',
  find(evaluate({ contract, visual: good, originPlaced: origin.slice(), camera: cam(6) }),
       'reaches the castle skyline')?.kind === 'ok');

console.log('== the collider check must find a TRANSFORM ERROR, not a difference ==');
// Measured from the real assets: the collider is a decimated proxy with
// 0.89 / 0.72 / 0.77 of the visual's extent, every axis agrees in sign, and the
// centres sit 6.5% apart. The first version of this check called that
// misregistration, which is a false alarm that trains people to ignore it.
const proxyCentre = good.centre.map((v, i) => v + [5721, 13998, 5756][i]);
const proxyExtent = good.extent.map((v, i) => v * [0.888, 0.723, 0.774][i]);
rows = evaluate({ contract, visual: good, originPlaced: origin.slice(), camera: null,
  collider: { extent: proxyExtent, centre: proxyCentre } });
check('the REAL collider — a coarser proxy 6.5% off centre — is accepted',
  find(rows, 'Visual and collider register')?.kind === 'ok',
  JSON.stringify(rows.map((r) => `${r.kind}:${r.text}`)));
check('…and the verdict says a proxy difference is not a placement fault',
  /decimated\s+proxy/.test(find(rows, 'Visual and collider register')?.why || ''));

// A flip IS a transform error, and is what the check exists for.
const originV = contract.placement.origin_cm;
const flippedCentre = good.centre.map((v, i) => (i === 1 ? originV[i] - (v - originV[i]) : v));
rows = evaluate({ contract, visual: good, originPlaced: origin.slice(), camera: null,
  collider: { extent: proxyExtent, centre: flippedCentre } });
check('a collider FLIPPED on an axis is refused',
  find(rows, 'FLIPPED on')?.kind === 'bad', JSON.stringify(rows.map((r) => r.text)));

// So is a separation comparable to the object itself.
rows = evaluate({ contract, visual: good, originPlaced: origin.slice(), camera: null,
  collider: { extent: proxyExtent, centre: good.centre.map((v, i) => v + (i === 0 ? 150000 : 0)) } });
check('a collider a third of the world away is refused',
  find(rows, 'DO NOT register')?.kind === 'bad');
check('…and an exactly matching collider is accepted',
  find(evaluate({ contract, visual: good, originPlaced: origin.slice(), camera: null,
       collider: { extent: good.extent.slice(), centre: good.centre.slice() } }),
       'Visual and collider register')?.kind === 'ok');

console.log('== absent input is PENDING, never a pass ==');
rows = evaluate({ contract, visual: null, camera: null });
check('no mesh reads pending', find(rows, 'no visual mesh loaded')?.kind === 'pending');
check('free orbit reads pending, not ok', find(rows, 'Free orbit')?.kind === 'pending');
const noExpected = clone(contract); delete noExpected.extent.expected_unreal_extent_cm;
check('a contract with no expected extent WARNS rather than passing',
  find(evaluate({ contract: noExpected, visual: good, camera: null }), 'scale NOT checked')?.kind === 'warn');
const noCentre = clone(contract); delete noCentre.extent.centre_offset_from_origin_cm;
check('a contract with no predicted centre WARNS rather than passing',
  find(evaluate({ contract: noCentre, visual: good, camera: null }), 'orientation NOT checked')?.kind === 'warn');
check('no contract at all is pending', evaluate({ contract: null })[0].kind === 'pending');

console.log(`\npassed ${pass}, failed ${fail.length}`);
for (const f of fail) console.log(`  FAILED: ${f}`);
process.exit(fail.length ? 1 : 0);
