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

console.log('== visual and collider that do not register ==');
rows = evaluate({ contract, visual: good, originPlaced: origin.slice(), camera: null,
  collider: { extent: good.extent.slice(), centre: good.centre.map((v, i) => v + (i === 1 ? 90000 : 0)) } });
check('a displaced collider is REFUSED', find(rows, 'DO NOT register')?.kind === 'bad');
check('…and one that matches is accepted',
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
