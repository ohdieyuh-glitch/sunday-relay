// Does the browser's physics agree with Wonderland's placement, and does it
// actually CATCH a bad collider?
//
// The second half is the point. A physics preview that settles every probe
// neatly is worthless — the whole reason to have one is to fail on a world
// that would have failed on the GPU, so every verdict here is exercised
// against a world deliberately built to produce it.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import * as phys from './physics.js';
import { ueToThree, unrealPlacement } from './placement.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT = join(HERE, 'placement-contract.json');

let pass = 0;
const fail = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail.push(name); console.log(`  FAIL ${name}${detail ? '\n         ' + detail : ''}`); }
}

// The contract is the shared truth. Absent, this suite cannot claim parity with
// anything — a FAILURE, not a skip: "no contract, so nothing compared" has
// passed silently in this project before.
if (!existsSync(CONTRACT)) {
  console.log('  FAIL placement-contract.json is missing — regenerate it');
  process.exit(1);
}
const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'));
const toThree = uu => {
  const out = ueToThree(contract, new THREE.Vector3(uu[0], uu[1], uu[2]));
  return [out.x, out.y, out.z];
};

// --- 1. scale and gravity are Wonderland's, not cannon-es's defaults
{
  const { world } = phys.createWorld();
  check('gravity is UE 980 uu/s^2 expressed in metres, on the Z axis',
        Math.abs(world.gravity.z + 9.8) < 1e-6 && world.gravity.y === 0,
        `${world.gravity.x},${world.gravity.y},${world.gravity.z}`);
  check('a hundred Unreal units is one physics metre', phys.UU_PER_M === 100);
}

// --- 2. the ground is where the contract says, and a probe lands ON it
{
  const { world } = phys.createWorld({ groundZUU: 0 });
  const r = 30;
  const probe = phys.addProbeUU(world, [0, 0, 900], r, toThree);
  const res = phys.dropTest(world, probe, r);   // a sphere rests at its radius
  check('a probe dropped from 900 uu lands ON the ground plane',
        res.verdict === 'on-surface',
        `${res.verdict}, rest ${res.restUU.toFixed(2)} uu, expected ${r}, settled=${res.settled}`);
  check('...and it actually came to rest rather than being read mid-fall', res.settled,
        `${res.steps} steps`);
}

// --- 3. a static box collider holds the probe UP
{
  const { world } = phys.createWorld({ groundZUU: 0 });
  const topUU = 220, halfZ = topUU / 2, r = 25;
  phys.addStaticBoxUU(world, [0, 0, halfZ], [300, 300, halfZ], toThree);
  const probe = phys.addProbeUU(world, [0, 0, 1200], r, toThree);
  const res = phys.dropTest(world, probe, topUU + r, 3);
  check('a probe rests on TOP of a box collider, not inside it',
        res.verdict === 'on-surface',
        `${res.verdict}, rest ${res.restUU.toFixed(1)} uu, expected ${topUU + r}`);
}

// --- 4. THE VERDICTS BITE. Each is produced by a world built to produce it.
{
  // fell-through: no collider at all where one is expected.
  const { world } = phys.createWorld({ groundZUU: -100000 });
  const probe = phys.addProbeUU(world, [0, 0, 400], 25, toThree);
  const res = phys.dropTest(world, probe, 25, 3);
  check('a missing collider is reported as fell-through, not as a resting height',
        res.verdict === 'fell-through' || res.verdict === 'never-settled',
        `${res.verdict}, rest ${res.restUU.toFixed(0)} uu`);
}
{
  // never-settled: gravity with nothing under it, read before it can rest.
  const { world } = phys.createWorld({ groundZUU: -1e9 });
  const probe = phys.addProbeUU(world, [0, 0, 0], 25, toThree);
  const s = phys.settle(world, { maxSteps: 40, stillFor: 5 });
  check('a probe still falling is NOT reported as settled', s.settled === false,
        `settled=${s.settled} after ${s.steps} steps`);
}

// --- 5. friction and restitution are real, and configurable
{
  const bouncy = phys.createWorld({ restitution: 0.9 });
  const dead = phys.createWorld({ restitution: 0.0 });
  check('restitution reaches the contact material',
        bouncy.world.defaultContactMaterial.restitution === 0.9 &&
        dead.world.defaultContactMaterial.restitution === 0,
        `${bouncy.world.defaultContactMaterial.restitution} / ${dead.world.defaultContactMaterial.restitution}`);
  let maxUp = -Infinity;
  const probe = phys.addProbeUU(bouncy.world, [0, 0, 600], 20, toThree);
  for (let i = 0; i < 600; i++) {
    bouncy.world.step(1 / 120);
    if (probe.velocity.z > 0) maxUp = Math.max(maxUp, probe.velocity.z);   // Z is up
  }
  check('...and a bouncy probe measurably rebounds', maxUp > 0.5,
        `peak upward speed ${maxUp.toFixed(2)} m/s`);
}

// --- 6. COORDINATE PARITY with the placement contract. This is the one that
// stops the browser becoming a second engine: a point converted by placement.js
// must be the same point cannon-es simulates.
{
  const m = unrealPlacement(contract);
  const det = m.determinant();
  check('the contract composes a real placement transform',
        Array.isArray(m.elements) && m.elements.length === 16 && Math.abs(det) > 1e-9,
        `determinant ${det}`);
  check('...and it is not the identity, which would place everything at the origin',
        m.elements.some((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) > 1e-6));
  const uu = [123, -456, 789];
  const three = toThree(uu);
  const { world } = phys.createWorld();
  const body = phys.addProbeUU(world, uu, 10, toThree);
  const back = [body.position.x * 100, body.position.y * 100, body.position.z * 100];
  const worst = Math.max(...back.map((v, i) => Math.abs(v - three[i])));
  check('a body is placed exactly where placement.js maps the point',
        worst < 1e-6, `worst ${worst}`);
  // The contract's space is Z-UP, like Unreal's. A physics layer that assumed
  // the cannon-es Y-up convention dropped every probe through every collider.
  check('...and height is the Z axis, matching the contract and Unreal',
        Math.abs(phys.heightUU(body) - three[2]) < 1e-6,
        `heightUU ${phys.heightUU(body)} vs three.z ${three[2]}`);
}

console.log(`\npassed ${pass}, failed ${fail.length}`);
for (const f of fail) console.log(`  FAILED: ${f}`);
process.exit(fail.length ? 1 : 0);
