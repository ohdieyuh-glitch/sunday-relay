// The browser's walk must be the ENGINE's walk, to the last decimal.
//
// gait.js is a second implementation of WonderlandDogGait.cpp, and two
// implementations of the same arithmetic drift. This is the thing that stops
// them: the C++ binary emits 64 sampled poses, and every number gait.js
// produces is checked against them.
//
// It also checks the OTHER direction, which is the one that actually rots: that
// the committed golden still matches what the C++ emits TODAY. Without that,
// editing the gait in C++ and forgetting to regenerate leaves this suite green
// while the preview shows last week's walk — a test agreeing with a stale
// fixture, which is worse than no test because it is quoted as proof.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import * as gait from './gait.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const GOLDEN = join(HERE, 'gait.golden.json');

let pass = 0;
const fail = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail.push(name); console.log(`  FAIL ${name}${detail ? '\n         ' + detail : ''}`); }
}

// --- the golden must exist. Absence is a FAILURE, not a skip: this file's
// whole job is the comparison, and "no fixture, so nothing compared" has passed
// silently in this project before.
if (!existsSync(GOLDEN)) {
  console.log('  FAIL gait.golden.json is missing — regenerate it from the C++');
  process.exit(1);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
check('the golden table is present and parses', golden.samples?.length === 64,
      `samples ${golden.samples?.length}`);

// --- 1. is the golden still what the C++ says?
const CPP = join(ROOT, 'wonderland', 'Source', 'Wonderland', 'WonderlandDogGait.cpp');
const TEST = join(ROOT, 'wonderland', 'tests', 'cpp', 'WonderlandDogGait.test.cpp');
let compiled = false;
try {
  const bin = join(tmpdir(), `gaitgolden_${process.pid}`);
  execFileSync('g++', ['-std=c++17', '-O1', '-I', dirname(CPP), '-o', bin, CPP, TEST],
               { stdio: 'pipe' });
  const fresh = execFileSync(bin, ['--golden'], { encoding: 'utf8' });
  compiled = true;
  check('the committed golden is what the C++ emits today',
        fresh.trim() === readFileSync(GOLDEN, 'utf8').trim(),
        'the gait changed in C++ without regenerating gait.golden.json');
} catch (e) {
  if (!compiled) {
    console.log('  ..   g++ unavailable — cannot re-derive the golden here');
    console.log('       (parity below still runs against the committed table)');
  }
}

// --- 2. does gait.js agree with it, sample for sample?
const { stride, lift, bob } = golden;
let worstFwd = 0, worstLift = 0, worstBob = 0, worstPitch = 0, worstRoll = 0, stanceMismatch = 0;
let worstSwing = 0, worstStretch = 0;
for (const s of golden.samples) {
  const L = gait.legPose(s.p, stride, lift);
  const B = gait.bodyPose(s.p, bob);
  const W = gait.legSwing(L, golden.legLength);
  worstSwing = Math.max(worstSwing, Math.abs(W.pitchDeg - s.swingPitch));
  worstStretch = Math.max(worstStretch, Math.abs(W.stretch - s.stretch));
  worstFwd = Math.max(worstFwd, Math.abs(L.forward - s.fwd));
  worstLift = Math.max(worstLift, Math.abs(L.lift - s.lift));
  worstBob = Math.max(worstBob, Math.abs(B.bob - s.bob));
  worstPitch = Math.max(worstPitch, Math.abs(B.pitch - s.pitch));
  worstRoll = Math.max(worstRoll, Math.abs(B.roll - s.roll));
  if (L.stance !== s.stance) stanceMismatch++;
}
// The golden prints six decimals, so 1e-5 is the floor the FORMAT allows, not a
// slack tolerance. Angles are degrees and forward is centimetres.
const TOL = 1e-5;
check('paw forward offset matches the engine', worstFwd < TOL, `worst ${worstFwd.toExponential(2)}`);
check('paw lift matches the engine', worstLift < TOL, `worst ${worstLift.toExponential(2)}`);
check('body bob matches the engine', worstBob < TOL, `worst ${worstBob.toExponential(2)}`);
check('body pitch matches the engine', worstPitch < TOL, `worst ${worstPitch.toExponential(2)}`);
check('body roll matches the engine', worstRoll < TOL, `worst ${worstRoll.toExponential(2)}`);
check('the limb swing angle matches the engine', worstSwing < TOL, `worst ${worstSwing.toExponential(2)}`);
check('the limb stretch matches the engine', worstStretch < TOL, `worst ${worstStretch.toExponential(2)}`);
check('every sample agrees on whether the paw is planted', stanceMismatch === 0,
      `${stanceMismatch} of ${golden.samples.length} disagree`);

// --- 2b. the GAIT MODEL, sample for sample. gait.js mirrors GaitForSpeed, and
// the preview picks stride/duty/footfall from it — so a drift here shows the
// browser a different animal from the one Unreal renders.
{
  let worstDuty = 0, worstStride = 0, worstLift = 0, worstBob = 0, worstOff = 0;
  let gaitMismatch = [];
  for (const g of golden.gaits || []) {
    const j = gait.gaitForSpeed(g.speed, golden.legLength);
    worstDuty = Math.max(worstDuty, Math.abs(j.dutyFactor - g.duty));
    worstStride = Math.max(worstStride, Math.abs(j.strideLength - g.stride));
    worstLift = Math.max(worstLift, Math.abs(j.liftHeight - g.lift));
    worstBob = Math.max(worstBob, Math.abs(j.bobHeight - g.bob));
    for (let i = 0; i < 4; i++) {
      worstOff = Math.max(worstOff, Math.abs(j.legOffset[i] - g.offsets[i]));
    }
    if (j.gait !== g.gait) gaitMismatch.push(`${g.speed}: js ${j.gait} vs ${g.gait}`);
  }
  check('the golden carries a gait table', (golden.gaits || []).length >= 8,
        `${(golden.gaits || []).length} samples`);
  check('the chosen GAIT matches the engine at every speed', gaitMismatch.length === 0,
        gaitMismatch.join('; '));
  check('duty factor matches across all gaits', worstDuty < TOL, `worst ${worstDuty.toExponential(2)}`);
  check('stride length matches across all gaits', worstStride < 1e-4, `worst ${worstStride.toExponential(2)}`);
  check('paw lift and body bob match', worstLift < 1e-4 && worstBob < 1e-4,
        `lift ${worstLift.toExponential(2)} bob ${worstBob.toExponential(2)}`);
  check('the blended footfall offsets match', worstOff < TOL, `worst ${worstOff.toExponential(2)}`);
}

// --- 3. the constants the preview reads directly
check('the duty factor matches', Math.abs(gait.WALK_DUTY_FACTOR - golden.dutyFactor) < TOL);
check('the footfall order matches',
      [0, 1, 2, 3].every(i => Math.abs(gait.legPhaseOffset(i) - golden.legPhaseOffset[i]) < TOL),
      `js ${[0,1,2,3].map(i => gait.legPhaseOffset(i))} vs ${golden.legPhaseOffset}`);

// --- 4. foot lock, independently, IN JS. The C++ test proves this of the C++;
// proving it again here means the browser preview cannot show a skate that the
// engine does not have, which is the only way the preview is worth watching.
{
  let worstDrift = 0, samples = 0;
  for (let leg = 0; leg < 4; leg++) {
    const off = gait.legPhaseOffset(leg);
    let anchor = null, prevPhase = -1;
    for (let d = 0; d <= 1200; d += 0.25) {
      const phase = (d / stride + off) % 1;
      const p = gait.legPose(phase, stride, lift);
      if (!p.stance) { anchor = null; prevPhase = phase; continue; }
      const world = gait.worldPawForward(d, off, stride, lift);
      // A new stance begins when the phase wraps past the swing.
      if (anchor === null || phase < prevPhase) { anchor = world; }
      else { worstDrift = Math.max(worstDrift, Math.abs(world - anchor)); samples++; }
      prevPhase = phase;
    }
  }
  check('a planted paw does not move in world space, in JS too',
        worstDrift < 1e-3 && samples > 1000,
        `worst drift ${worstDrift.toExponential(2)} uu over ${samples} planted samples`);
}

// --- 5. at least two paws down at all times — what makes a walk a walk
{
  let worst = 4;
  for (let i = 0; i < 400; i++) {
    const d = (i / 400) * stride;
    let down = 0;
    for (let leg = 0; leg < 4; leg++) {
      if (gait.legPose(d / stride + gait.legPhaseOffset(leg), stride, lift).stance) down++;
    }
    worst = Math.min(worst, down);
  }
  check('at least two paws are planted at every instant', worst >= 2, `worst ${worst}`);
}

console.log(`\npassed ${pass}, failed ${fail.length}`);
for (const f of fail) console.log(`  FAILED: ${f}`);
process.exit(fail.length ? 1 : 0);
