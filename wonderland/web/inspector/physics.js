// Browser-side 3D physics for the Wonderland inspector — cannon-es.
//
// WHAT THIS IS FOR, AND WHAT IT IS NOT
//
// Unreal is the authority. Every collision that matters to a player happens
// there, and nothing in this file is allowed to become a second opinion about
// it. What this IS is a way to ask cheap questions before renting a GPU:
//
//   * is the collider actually where the visual is?
//   * does a body dropped on the plaza land on the plaza, or fall through it?
//   * is anything resting INSIDE geometry rather than on it?
//   * does the ground sit at the height the placement contract claims?
//
// Every one of those has cost this project an L4 session at least once, and
// every one of them is answerable in a few milliseconds of JavaScript.
//
// cannon-es and NOT Matter.js: Matter is a 2D engine, and a 2D answer to a 3D
// placement question is worse than no answer because it looks like one.
//
// PLACEMENT COMES FROM THE CONTRACT. This file does not convert Unreal units,
// flip a handedness or decide where the ground is — placement.js already reads
// all of that out of the generator, and a second derivation is exactly how the
// browser and the engine drift apart. Physics bodies are built from numbers
// this module is HANDED.
import * as CANNON from 'cannon-es';

/** Unreal centimetres -> metres. cannon-es is tuned for SI: a world built in
 *  centimetres with g = -980 integrates badly at ordinary timesteps, and the
 *  symptom is jitter that looks like a collider bug and is not. */
export const UU_PER_M = 100;

/**
 * A physics world matching Wonderland's scale and gravity.
 * @param {{gravityUU?: number, groundZUU?: number}} opts
 */
export function createWorld(opts = {}) {
  // Z IS UP HERE, NOT Y.
  //
  // cannon-es examples are Y-up, and this file was written that way first —
  // gravity on -Y, the ground plane rotated to face +Y, heights read off .y.
  // Every probe then fell straight through every collider, because the
  // inspector's three.js space is Z-UP: placement-contract.json's
  // ue_to_three_rows is [[1,0,0],[0,-1,0],[0,0,1]], which flips the handedness
  // and NOTHING ELSE. Unreal is Z-up and so is the scene that mirrors it.
  //
  // Following the engine's convention instead of the library's also removes
  // work: CANNON.Plane's own normal is +Z, so the ground needs no rotation at
  // all, and a height is just .z in both spaces.
  const gravityUU = opts.gravityUU ?? 980;      // UE's own default
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, 0, -gravityUU / UU_PER_M),
  });
  // NAIVE, DELIBERATELY. SAPBroadphase was here first and a probe fell straight
  // through a box collider that was unquestionably in its path — SAP wants its
  // axis sorted over the bodies present, and everything in this world is added
  // after it is installed. A preview whose whole job is to notice a missing
  // collider must not have a broadphase that can invent one, and Wonderland's
  // colliders number in the handful, so O(n^2) over them costs nothing.
  world.broadphase = new CANNON.NaiveBroadphase();
  world.allowSleep = true;
  // A resting body that never sleeps keeps jittering by a fraction of a
  // millimetre, which reads on screen as exactly the thing being debugged.
  world.defaultContactMaterial.friction = opts.friction ?? 0.4;
  world.defaultContactMaterial.restitution = opts.restitution ?? 0.05;

  const groundZUU = opts.groundZUU ?? 0;
  const ground = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
  });
  // No rotation: CANNON.Plane's normal is +Z and +Z is up.
  ground.position.set(0, 0, groundZUU / UU_PER_M);
  world.addBody(ground);

  return { world, ground, groundZUU, gravityUU };
}

/**
 * A static box collider, from Unreal-space centre and half-extent.
 * Both are in UNREAL units and Unreal axes; the caller converts nothing.
 */
export function addStaticBoxUU(world, centreUU, halfExtentUU, ueToThreeFn) {
  const c = ueToThreeFn(centreUU);
  const h = ueToThreeFn(halfExtentUU).map(Math.abs);
  const body = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(h[0] / UU_PER_M, h[1] / UU_PER_M, h[2] / UU_PER_M)),
  });
  body.position.set(c[0] / UU_PER_M, c[1] / UU_PER_M, c[2] / UU_PER_M);
  world.addBody(body);
  return body;
}

/** A dynamic probe body — the thing you drop to find out what is really there. */
export function addProbeUU(world, atUU, radiusUU = 30, ueToThreeFn) {
  const p = ueToThreeFn(atUU);
  const body = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Sphere(radiusUU / UU_PER_M),
  });
  body.position.set(p[0] / UU_PER_M, p[1] / UU_PER_M, p[2] / UU_PER_M);
  world.addBody(body);
  return body;
}

/**
 * Step until everything stops moving, or give up.
 *
 * RETURNS WHETHER IT SETTLED. A probe that is still moving after the budget has
 * not "landed at" wherever it happens to be — it is falling through the world,
 * and reporting its position as a resting height is how a missing collider gets
 * recorded as a good one.
 */
export function settle(world, { dt = 1 / 120, maxSteps = 2400, stillFor = 30 } = {}) {
  let still = 0;
  for (let i = 0; i < maxSteps; i++) {
    world.step(dt);
    const moving = world.bodies.some(
      b => b.mass > 0 && b.velocity.length() > 1e-3);
    still = moving ? 0 : still + 1;
    if (still >= stillFor) return { settled: true, steps: i + 1 };
  }
  return { settled: false, steps: maxSteps };
}

/** A body's height back in UNREAL units, so results are comparable with the
 *  generator, the world proof and the sidecars without a second conversion. */
export function heightUU(body) {
  return body.position.z * UU_PER_M;   // Z is up — see createWorld
}

/**
 * The question this file exists to answer: does a probe dropped above `atUU`
 * come to rest ON the expected surface?
 *
 * @returns {{settled:boolean, restUU:number, expectedUU:number, deltaUU:number,
 *            verdict:'on-surface'|'fell-through'|'inside-geometry'|'never-settled'}}
 */
export function dropTest(world, probe, expectedRestUU, tolUU = 2) {
  const s = settle(world);
  const restUU = heightUU(probe);
  const deltaUU = restUU - expectedRestUU;
  let verdict;
  if (!s.settled) verdict = 'never-settled';
  else if (deltaUU < -tolUU * 5) verdict = 'fell-through';
  else if (deltaUU < -tolUU) verdict = 'inside-geometry';
  else verdict = Math.abs(deltaUU) <= tolUU ? 'on-surface' : 'fell-through';
  return { settled: s.settled, steps: s.steps, restUU, expectedUU: expectedRestUU, deltaUU, verdict };
}
