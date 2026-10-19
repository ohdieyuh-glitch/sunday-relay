import * as THREE from 'three';
import { springStep } from '../../src/relay/ui/landing/three/dog-rig';
import { createLandingMaterials, LANDING_COLORS } from '../../src/relay/ui/landing/three/materials';
import { createComet, type Comet } from '../shared/three/comet';
import { createFrameLoop } from '../shared/three/loop';
import { createScrollRig, poseTracks, sampleBySection, samplePose, type Pose } from '../shared/three/scroll-rig';
import { addStageLights, createStage } from '../shared/three/stage';
import {
  arcBetween, BRAIN, BUILD_VOXEL, buildTerrainBuffers, generateColumns, GRID_Y, JULIUS_CORE, juliusTierSlots,
  planBrainRecord, planStructures, PRESENCES, SIGNAL_LINKS, undersideAbove, type BrainPlate,
} from './world-plate';

/**
 * THE i.WONDER STAGE — a persistent world, seen from a company's distance.
 *
 * Section by section the camera moves from the whole island (the company), to
 * the plateau where things are being built (Wonderland), up to the tower's
 * crown where Julius and its three tier slots sit (Julius), down beneath the
 * world where Project Brain accumulates its record (Project Brain), then
 * pulls away so the principles and the closing line own the page.
 *
 * Colour ownership follows the landing: the terrain and the structures share
 * the landing's ivory material; lavender is construction light, agent
 * presence and Julius; cream light is people. Gold never enters the render —
 * on this site it exists only as the primary CTA's hairline.
 */

const LAVENDER = 0xb4a2ff;
const LAVENDER_CORE = 0xf3efff;
const CREAM_LIGHT = 0xffe9c2;
const CREAM_CORE = 0xfff8ea;
const GRID = 0x8d86b8;

const DEG = Math.PI / 180;

type Shot = {
  readonly focus: readonly [number, number, number];
  readonly azimuth: number;
  readonly elevation: number;
  readonly distance: number;
  readonly fov: number;
  /** World units to move the subject toward screen-right / screen-up. */
  readonly shiftX: number;
  readonly shiftY: number;
  readonly stage: number;
};

/** One shot per section: hero, thesis, work, wonderland, julius, project brain, principles, closing. */
const LANDSCAPE: readonly Shot[] = [
  { focus: [0, -1.5, 0], azimuth: 38, elevation: 24, distance: 86, fov: 30, shiftX: 16, shiftY: 1.5, stage: 1 },
  { focus: [0, -2, 0], azimuth: 70, elevation: 10, distance: 96, fov: 30, shiftX: 24, shiftY: -4, stage: 0.26 },
  { focus: [0, 0, 0], azimuth: 96, elevation: 50, distance: 88, fov: 32, shiftX: 21, shiftY: 0, stage: 0.4 },
  { focus: [0.3, 3, 0], azimuth: 30, elevation: 24, distance: 58, fov: 32, shiftX: 15, shiftY: 0.5, stage: 0.92 },
  { focus: [-1.75, 9.4, -1.25], azimuth: -28, elevation: 12, distance: 42, fov: 32, shiftX: 12, shiftY: -0.5, stage: 0.92 },
  { focus: [BRAIN.x, -19, BRAIN.z], azimuth: -10, elevation: 9, distance: 34, fov: 32, shiftX: 7, shiftY: 0.6, stage: 0.95 },
  { focus: [0, -3, 0], azimuth: 132, elevation: 34, distance: 124, fov: 30, shiftX: 0, shiftY: -34, stage: 0.16 },
  { focus: [0, -1, 0], azimuth: 208, elevation: 18, distance: 100, fov: 30, shiftX: 0, shiftY: -23, stage: 0.6 },
];

/**
 * Portrait keeps the subject centred and HIGH, with copy beneath it. How far
 * "high" is in world units depends on the aspect — a phone's widened vertical
 * field shows far more height than a tablet's — so the lift is a FRACTION of
 * the visible half-height, resolved per aspect.
 */
const PORTRAIT_LIFT = [0.54, 0.42, 0.5, 0.55, 0.5, 0.46, 0.3, 0.45];
const PORTRAIT_STAGE = [0.95, 0.24, 0.4, 0.55, 0.55, 0.6, 0.16, 0.6];
/**
 * Per-section pull-back in portrait. The hero steps back so Julius's crown clears
 * the navigation; Project Brain steps in, because a narrow frame would otherwise
 * shrink the record to a thumbnail.
 */
const PORTRAIT_DISTANCE = [1.12, 1, 1, 1, 1, 0.74, 1, 1];

function portraitShots(aspect: number): Shot[] {
  // A tablet in portrait is far less tall than a phone: pull back a little and
  // lift less, or the tower crowns clip under the navigation.
  const tablet = Math.min(1, Math.max(0, (aspect - 0.5) / 0.3));
  return LANDSCAPE.map((shot, i) => {
    const distance = shot.distance * PORTRAIT_DISTANCE[i] * 1.02 * (1 + 0.3 * tablet);
    const vfov = 2 * Math.atan(Math.tan((shot.fov * DEG) / 2) / Math.min(1, aspect));
    return {
      ...shot,
      distance,
      shiftX: 0,
      shiftY: PORTRAIT_LIFT[i] * (1 - 0.25 * tablet) * distance * Math.tan(vfov / 2),
      stage: PORTRAIT_STAGE[i],
    };
  });
}

function shotToPose(shot: Shot): Pose {
  const az = shot.azimuth * DEG;
  const el = shot.elevation * DEG;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const focus = new THREE.Vector3(shot.focus[0], shot.focus[1], shot.focus[2]);
  const forward = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  // Translating camera and target together slides the subject across the
  // frame without changing the angle it is seen from.
  const offset = right.multiplyScalar(-shot.shiftX).add(up.multiplyScalar(-shot.shiftY));
  const position = focus.clone().addScaledVector(dir, shot.distance).add(offset);
  const target = focus.clone().add(offset);
  return {
    position: [position.x, position.y, position.z],
    target: [target.x, target.y, target.z],
    fov: shot.fov,
    stage: shot.stage,
  };
}

/**
 * Landscape shots are authored at 16:10. A wider screen shows more world to
 * either side, so the same shift in world units would slide the subject back
 * toward the copy; the shift is scaled with the aspect so the subject keeps its
 * place in the FRAME rather than in the world.
 */
const AUTHORED_ASPECT = 1.6;
let landscapeCache: { aspect: number; tracks: ReturnType<typeof poseTracks> } | null = null;
function landscapeTracks(aspect: number): ReturnType<typeof poseTracks> {
  const key = Math.round(Math.min(2.4, Math.max(1, aspect)) * 100) / 100;
  if (landscapeCache?.aspect !== key) {
    landscapeCache = {
      aspect: key,
      tracks: poseTracks(LANDSCAPE.map((shot) => shotToPose({ ...shot, shiftX: (shot.shiftX * key) / AUTHORED_ASPECT }))),
    };
  }
  return landscapeCache.tracks;
}
let portraitCache: { aspect: number; tracks: ReturnType<typeof poseTracks> } | null = null;
function portraitTracks(aspect: number): ReturnType<typeof poseTracks> {
  const key = Math.round(aspect * 100) / 100;
  if (portraitCache?.aspect !== key) portraitCache = { aspect: key, tracks: poseTracks(portraitShots(key).map(shotToPose)) };
  return portraitCache.tracks;
}

/** Section index at which the pavilion is built: arrival at Julius. */
const JULIUS_SECTION = 4;
/** Section index at which Project Brain writes the rest of its record. */
const BRAIN_SECTION = 5;
/**
 * How present the record is in each section's shot. It always exists, but it
 * lives beneath the world: it should not compete with the hero's island, and it
 * emerges as the camera goes down to it.
 */
const BRAIN_PRESENCE = [0, 0, 0.1, 0.12, 0.3, 1, 0.45, 0.3];

export type WorldScene = { dispose(): void };

export function mountWorldScene(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  sections: readonly HTMLElement[],
  reducedMotion: boolean,
): WorldScene {
  const stage = createStage(canvas, { fogNear: 60, fogFar: 210 });
  const { scene, camera, tier } = stage;
  addStageLights(scene, LAVENDER, 0.42);
  const materials = createLandingMaterials(tier);

  const world = new THREE.Group();
  scene.add(world);

  // ---- terrain: one merged mesh of visible faces ------------------------
  const columns = generateColumns();
  const terrainBuffers = buildTerrainBuffers(columns);
  const terrainGeometry = new THREE.BufferGeometry();
  terrainGeometry.setAttribute('position', new THREE.BufferAttribute(terrainBuffers.positions, 3));
  terrainGeometry.setAttribute('normal', new THREE.BufferAttribute(terrainBuffers.normals, 3));
  terrainGeometry.setAttribute('color', new THREE.BufferAttribute(terrainBuffers.colors, 3));
  const terrainMaterial = createTerrainMaterial();
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  world.add(terrain);
  const matrix = new THREE.Matrix4();

  // ---- structures: solid voxels + a ghost plan --------------------------
  const plan = planStructures();
  const voxelBox = new THREE.BoxGeometry(BUILD_VOXEL * 0.96, BUILD_VOXEL * 0.96, BUILD_VOXEL * 0.96);
  const solids = new THREE.InstancedMesh(voxelBox, materials.ivory, plan.voxels.length);
  const setVoxel = (index: number, scale: number) => {
    const v = plan.voxels[index];
    matrix.makeScale(scale, scale, scale);
    matrix.setPosition(v.x, v.y - (1 - scale) * BUILD_VOXEL * 0.5, v.z);
    solids.setMatrixAt(index, matrix);
  };
  plan.voxels.forEach((_, i) => setVoxel(i, 1));
  solids.instanceMatrix.needsUpdate = true;
  world.add(solids);

  const ghost = buildGhostPlan(plan.voxels);
  world.add(ghost.object);

  const buildLight = new THREE.PointLight(LAVENDER, 0, 7, 2);
  world.add(buildLight);

  const structureEnd = (s: number) => plan.structureStarts[s + 1] ?? plan.voxels.length;
  let built = reducedMotion ? plan.voxels.length : plan.alreadyBuilt;
  let unlocked = reducedMotion ? 2 : 0;
  let pauseUntil = 1.4;
  let buildActivity = 0;
  let buildActivityV = 0;

  // ---- presences, Julius and its tier slots, signals -------------------
  const nodes = buildNodes(presenceNodes());
  world.add(nodes.object);

  // Julius rides with the world, but its tier ring holds its orientation while
  // the world turns beneath it: three slots that drift into line behind one
  // another would say "one", not "three".
  const julius = new THREE.Group();
  julius.position.set(...JULIUS_CORE);
  world.add(julius);
  const slots = juliusTierSlots().map(([x, y, z]) => [x - JULIUS_CORE[0], y - JULIUS_CORE[1], z - JULIUS_CORE[2]] as const);
  // Staggered a third of the cycle apart: one tier changes per beat.
  const slotNodes = buildNodes(slots.map((position, i) => ({ ...SLOT_NODE, position, phase: i * 3 })));
  julius.add(slotNodes.object);

  const comets: Array<{ comet: Comet; period: number; offset: number }> = SIGNAL_LINKS.map(([from, to], i) => {
    const person = PRESENCES[from].kind === 'person';
    const comet = createComet(arcBetween(PRESENCES[from].position, PRESENCES[to].position), {
      closed: false,
      radius: 0.022,
      glow: person ? CREAM_LIGHT : LAVENDER,
      core: person ? CREAM_CORE : LAVENDER_CORE,
      base: 0.055,
      trail: 6,
      tubular: tier === 'low' ? 40 : 72,
      radial: tier === 'low' ? 4 : 6,
    });
    world.add(comet.object);
    return { comet, period: 3.4 + i * 0.7, offset: i * 1.37 };
  });

  // Julius governs every tier: a tether from the core to each slot, with one
  // pulse per branch in turn — the same statement the page's diagram makes.
  const tethers = slots.map((slot) => {
    const comet = createComet(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(...slot)), {
      closed: false,
      radius: 0.016,
      glow: LAVENDER,
      core: LAVENDER_CORE,
      base: 0.09,
      trail: 9,
      tubular: 24,
      radial: tier === 'low' ? 4 : 6,
    });
    julius.add(comet.object);
    return comet;
  });

  // ---- Project Brain, beneath the world ---------------------------------
  const record = planBrainRecord();
  const brain = buildBrainRecord(record);
  world.add(brain.object);
  const spineTop = undersideAbove(BRAIN.x, BRAIN.z, columns) - 0.2;
  const spineBottom = BRAIN.baseY;
  const spine = createComet(
    new THREE.LineCurve3(new THREE.Vector3(BRAIN.x, spineTop, BRAIN.z), new THREE.Vector3(BRAIN.x, spineBottom, BRAIN.z)),
    { closed: false, radius: 0.018, glow: LAVENDER, core: LAVENDER_CORE, base: 0.07, trail: 10, tubular: 32, radial: tier === 'low' ? 4 : 6 },
  );
  world.add(spine.object);
  const brainLight = new THREE.PointLight(LAVENDER, 0, 9, 2);
  world.add(brainLight);
  let written = reducedMotion ? record.length : BRAIN.alreadyWritten;
  let brainUnlocked = reducedMotion;
  let brainPauseUntil = 0;
  let brainCompletedAt = 0;
  let brainActivity = 0;
  let brainActivityV = 0;

  // ---- the infrastructure beneath ---------------------------------------
  const grid = buildGrid();
  scene.add(grid.object);

  // ---- input + layout ---------------------------------------------------
  const rig = createScrollRig(sections);
  const pointer = { x: 0, y: 0, active: false };
  const parallax = { x: 0, y: 0, vx: 0, vy: 0 };
  const loop = createFrameLoop(frame, !reducedMotion);

  const onPointer = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    pointer.active = true;
  };
  const onScroll = () => loop.invalidate();
  const onResize = () => {
    stage.resize();
    rig.measure();
    loop.invalidate();
  };
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  // Web fonts and late layout move section offsets after first paint.
  const layoutObserver = new ResizeObserver(() => {
    rig.measure();
    loop.invalidate();
  });
  layoutObserver.observe(document.body);

  const cam = { p: new THREE.Vector3(), t: new THREE.Vector3(), vp: [0, 0, 0], vt: [0, 0, 0], init: false };
  let firstFrame = true;

  function frame(dt: number, elapsed: number): void {
    const rawT = rig.read();
    const t = reducedMotion ? Math.round(rawT) : rawT;
    const pose = samplePose(stage.portrait ? portraitTracks(stage.width / stage.height) : landscapeTracks(stage.width / stage.height), t);

    // Pointer parallax, sprung so a flick of the mouse drifts, never jerks.
    const px = springStep(parallax.x, pointer.active ? pointer.x : 0, parallax.vx, 0.9, dt);
    const py = springStep(parallax.y, pointer.active ? pointer.y : 0, parallax.vy, 0.9, dt);
    parallax.x = px.value; parallax.vx = px.velocity;
    parallax.y = py.value; parallax.vy = py.velocity;
    const drift = reducedMotion ? 0 : 1.1;

    const goalP = [pose.position[0] + parallax.x * drift, pose.position[1] - parallax.y * drift * 0.6, pose.position[2]];
    const goalT = [pose.target[0], pose.target[1], pose.target[2]];
    if (!cam.init || reducedMotion) {
      cam.p.set(goalP[0], goalP[1], goalP[2]);
      cam.t.set(goalT[0], goalT[1], goalT[2]);
      cam.init = true;
    } else {
      // Scroll arrives in wheel-sized steps; the camera should not.
      for (let axis = 0; axis < 3; axis += 1) {
        const p = springStep(cam.p.getComponent(axis), goalP[axis], cam.vp[axis], 0.42, dt);
        cam.p.setComponent(axis, p.value); cam.vp[axis] = p.velocity;
        const q = springStep(cam.t.getComponent(axis), goalT[axis], cam.vt[axis], 0.42, dt);
        cam.t.setComponent(axis, q.value); cam.vt[axis] = q.velocity;
      }
    }
    camera.position.copy(cam.p);
    camera.lookAt(cam.t);
    stage.setFov(pose.fov);
    host.style.setProperty('--pw-stage-opacity', pose.stage.toFixed(3));

    // The world turns, slowly enough that nobody sees it move — only that it
    // is somewhere else when they look back.
    if (!reducedMotion) world.rotation.y = elapsed * 0.006;
    julius.rotation.y = -world.rotation.y;

    // ---- construction ---------------------------------------------------
    if (!reducedMotion) {
      if (unlocked < 2 && rawT >= JULIUS_SECTION - 0.35 && built >= structureEnd(1)) {
        unlocked = 2;
        pauseUntil = elapsed + 0.6;
      }
      const end = structureEnd(unlocked);
      const building = elapsed > pauseUntil && built < end;
      if (building) {
        const before = Math.ceil(built);
        built = Math.min(end, built + dt * 10.5);
        for (let i = Math.max(0, before - 3); i < Math.ceil(built); i += 1) {
          const p = Math.min(1, Math.max(0, built - i));
          setVoxel(i, 0.35 + 0.65 * (1 - Math.pow(1 - p, 3)));
        }
        solids.instanceMatrix.needsUpdate = true;
        const head = plan.voxels[Math.min(plan.voxels.length - 1, Math.floor(built))];
        buildLight.position.set(head.x, head.y + 0.4, head.z);
      } else if (built >= end && unlocked === 0) {
        unlocked = 1;
        pauseUntil = elapsed + 1.6;
      }
      const activity = springStep(buildActivity, building ? 1 : 0, buildActivityV, 0.5, dt);
      buildActivity = activity.value; buildActivityV = activity.velocity;
    }
    solids.count = Math.ceil(built);
    buildLight.intensity = 7 * buildActivity;
    ghost.setState(built, structureEnd(unlocked));

    // ---- presences, Julius, signals -------------------------------------
    const pointScale = stage.height * stage.dpr * 0.5 / Math.tan((camera.fov * DEG) / 2);
    nodes.update(elapsed, pointScale, reducedMotion);
    slotNodes.update(elapsed, pointScale, reducedMotion);
    for (const { comet, period, offset } of comets) {
      const phase = ((elapsed + offset) % period) / (period * 0.62);
      comet.setHead(reducedMotion ? 2 : phase);
    }
    // One branch at a time, never all three at once.
    const governPeriod = 4.2;
    tethers.forEach((tether, i) => {
      const phase = ((elapsed + governPeriod - i * 1.4) % governPeriod) / 1.1;
      tether.setHead(reducedMotion ? 2 : phase);
    });

    // ---- Project Brain ----------------------------------------------------
    // The rest of the record is written when the reader arrives beneath the
    // world: a pulse runs down the spine from the world above, and the record
    // lands on the stack. Once complete, a read passes through it, top to
    // bottom — every tier reads from the record as well as writing to it.
    let landing = -1;
    let progress = 1;
    if (!reducedMotion) {
      if (!brainUnlocked && rawT >= BRAIN_SECTION - 0.35) {
        brainUnlocked = true;
        brainPauseUntil = elapsed + 0.5;
      }
      const writing = brainUnlocked && elapsed > brainPauseUntil && written < record.length;
      if (writing) {
        written = Math.min(record.length, written + dt / 1.25);
        if (written >= record.length) brainCompletedAt = elapsed;
      }
      if (written < record.length && brainUnlocked) {
        landing = Math.floor(written);
        progress = written - landing;
      }
      const activity = springStep(brainActivity, writing ? 1 : 0, brainActivityV, 0.5, dt);
      brainActivity = activity.value; brainActivityV = activity.velocity;
    }
    // The pulse spends the first 45% of a record's write travelling the spine;
    // the plate settles over the rest.
    const travel = Math.min(1, progress / 0.45);
    const settle = landing < 0 ? 1 : Math.min(1, Math.max(0, (progress - 0.4) / 0.6));
    const complete = written >= record.length;
    const reading = complete && !reducedMotion ? ((elapsed - brainCompletedAt) % 7) / 2.4 : -1;
    brain.setState(complete ? record.length : Math.floor(written), landing, settle, reading);
    const presence = sampleBySection(BRAIN_PRESENCE, t);
    brain.setPresence(presence);
    spine.setPresence(presence);
    if (landing >= 0) {
      const target = record[landing].y + BRAIN.thickness / 2;
      spine.setHead(((spineTop - target) / (spineTop - spineBottom)) * travel);
      brainLight.position.set(BRAIN.x + BRAIN.size * 0.3, target + 1.2, BRAIN.z + BRAIN.size * 0.3);
    } else {
      spine.setHead(2);
    }
    brainLight.intensity = 9 * brainActivity * presence;

    stage.render();
    if (firstFrame) {
      firstFrame = false;
      host.dataset.ready = 'true';
      window.setTimeout(() => { host.dataset.live = 'true'; }, 1500);
    }
  }

  loop.start();

  return {
    dispose() {
      loop.dispose();
      layoutObserver.disconnect();
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      terrainGeometry.dispose();
      voxelBox.dispose();
      solids.dispose();
      ghost.dispose();
      nodes.dispose();
      slotNodes.dispose();
      comets.forEach(({ comet }) => comet.dispose());
      tethers.forEach((tether) => tether.dispose());
      brain.dispose();
      spine.dispose();
      grid.dispose();
      terrainMaterial.dispose();
      materials.dispose();
      stage.dispose();
    },
  };
}

/**
 * The terrain's material: the landing's ivory, with the island's underside
 * falling into shadow by HEIGHT rather than by light. Every light on the stage
 * reaches the columns' sides, so without this the overhang renders as bright as
 * the ground it holds up and the island reads as a slab instead of a floating
 * mass. The darkening happens in linear space before tone mapping and fog, so
 * it composes with both.
 */
function createTerrainMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: LANDING_COLORS.ivory, roughness: 0.86, metalness: 0, vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWorldY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;
        #else
          vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        gl_FragColor.rgb *= mix(0.1, 1.0, smoothstep(-12.0, 0.6, vWorldY));`,
      );
  };
  return material;
}

/**
 * The plan of what has not been built yet, as a lavender wireframe. One line
 * geometry for every voxel; the shader shows only the unbuilt part of the
 * unlocked structures and brightens the edges nearest the build head, so the
 * plan reads as being worked on rather than drawn.
 */
function buildGhostPlan(voxels: ReturnType<typeof planStructures>['voxels']) {
  const h = BUILD_VOXEL * 0.48;
  const corners = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const positions = new Float32Array(voxels.length * 24 * 3);
  const orders = new Float32Array(voxels.length * 24);
  let p = 0;
  let o = 0;
  voxels.forEach((v, index) => {
    for (const [a, b] of edges) {
      for (const c of [corners[a], corners[b]]) {
        positions[p++] = v.x + c[0];
        positions[p++] = v.y + c[1];
        positions[p++] = v.z + c[2];
        orders[o++] = index;
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aOrder', new THREE.BufferAttribute(orders, 1));
  const uniforms = {
    uBuilt: { value: 0 },
    uPlanned: { value: 0 },
    uColor: { value: new THREE.Color(LAVENDER) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aOrder;
      uniform float uBuilt;
      uniform float uPlanned;
      varying float vAlpha;
      void main() {
        float unbuilt = step(uBuilt - 0.001, aOrder);
        float planned = step(aOrder, uPlanned - 0.5);
        float nearHead = exp(-max(aOrder - uBuilt, 0.0) * 0.18);
        vAlpha = unbuilt * planned * (0.16 + 0.6 * nearHead);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        if (vAlpha < 0.01) discard;
        gl_FragColor = vec4(uColor * vAlpha, vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const object = new THREE.LineSegments(geometry, material);
  object.frustumCulled = false;
  return {
    object,
    setState(built: number, planned: number) {
      uniforms.uBuilt.value = built;
      uniforms.uPlanned.value = planned;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * A point of light: people (cream), agents (lavender), Julius's core, and its
 * three tier slots. A slot is drawn as a RING with a light inside it; every few
 * seconds one slot's light goes out and comes back while the ring holds — the
 * tier is permanent, what fills it is not. Julius and its slots hold still;
 * presences hover.
 */
type LightNode = {
  readonly position: readonly [number, number, number];
  readonly color: number;
  readonly size: number;
  readonly ring: number;
  readonly swap: number;
  readonly bob: number;
  readonly phase: number;
};

const SLOT_NODE = { color: LAVENDER, size: 1.55, ring: 1, swap: 1, bob: 0 } as const;

function presenceNodes(): LightNode[] {
  return PRESENCES.map((presence) => {
    if (presence.kind === 'julius') return { position: presence.position, color: LAVENDER_CORE, size: 2.6, ring: 1, swap: 0, bob: 0, phase: 0 };
    const person = presence.kind === 'person';
    return { position: presence.position, color: person ? CREAM_LIGHT : LAVENDER, size: person ? 2.2 : 1.9, ring: 0, swap: 0, bob: 1, phase: presence.phase };
  });
}

/** Every light in a list, in one draw. */
function buildNodes(list: readonly LightNode[]) {

  const count = list.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);
  const rings = new Float32Array(count);
  const swaps = new Float32Array(count);
  const bobs = new Float32Array(count);
  const color = new THREE.Color();
  list.forEach((node, i) => {
    positions.set(node.position, i * 3);
    color.set(node.color);
    colors.set([color.r, color.g, color.b], i * 3);
    phases[i] = node.phase;
    sizes[i] = node.size;
    rings[i] = node.ring;
    swaps[i] = node.swap;
    bobs[i] = node.bob;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aRing', new THREE.BufferAttribute(rings, 1));
  geometry.setAttribute('aSwap', new THREE.BufferAttribute(swaps, 1));
  geometry.setAttribute('aBob', new THREE.BufferAttribute(bobs, 1));
  const uniforms = { uTime: { value: 0 }, uScale: { value: 400 }, uMotion: { value: 1 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aPhase;
      attribute float aSize;
      attribute float aRing;
      attribute float aSwap;
      attribute float aBob;
      uniform float uTime;
      uniform float uScale;
      uniform float uMotion;
      varying vec3 vColor;
      varying float vRing;
      varying float vFill;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 0.8 + aPhase) * 0.22 * aBob;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / -mv.z;
        vColor = aColor;
        vRing = aRing;
        // A nine-second cycle: out over 0.4s, dark for half a second, back over 0.5s.
        float c = mod(uTime + aPhase, 9.0);
        float dip = smoothstep(0.0, 0.4, c) * (1.0 - smoothstep(0.9, 1.4, c));
        vFill = 1.0 - aSwap * dip * 0.92 * uMotion;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vRing;
      varying float vFill;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float halo = smoothstep(0.5, 0.0, d);
        float core = smoothstep(0.12, 0.0, d);
        float ring = smoothstep(0.028, 0.0, abs(d - 0.36)) * vRing;
        float a = halo * halo * mix(0.45, 0.3, vRing) * vFill + core * 1.5 * vFill + ring * 0.7;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const object = new THREE.Points(geometry, material);
  object.frustumCulled = false;
  return {
    object,
    update(time: number, scale: number, reducedMotion: boolean) {
      uniforms.uTime.value = reducedMotion ? 0 : time;
      uniforms.uScale.value = scale;
      uniforms.uMotion.value = reducedMotion ? 0 : 1;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * PROJECT BRAIN as geometry: one instanced mesh of plates in the world's own
 * ivory, and one line set carrying each plate's edges and inscribed marks. A
 * written plate is solid with lavender edges; the plate being written drops
 * onto the stack from above; plates not yet written do not exist — a record is
 * not planned in advance. The newest record is always the brightest, and a
 * read pulse can pass through the whole stack.
 */
function buildBrainRecord(record: readonly BrainPlate[]) {
  // The world's ivory, dimmer than the ground above, so memory reads as the layer beneath the world.
  const material = new THREE.MeshStandardMaterial({ color: LANDING_COLORS.ivory, roughness: 0.8, metalness: 0 });
  const plateColor = material.color.clone().multiplyScalar(0.24);
  material.color.copy(plateColor);
  const half = BRAIN.size / 2;
  const plateBox = new THREE.BoxGeometry(BRAIN.size, BRAIN.thickness, BRAIN.size);
  const plates = new THREE.InstancedMesh(plateBox, material, record.length);
  const m = new THREE.Matrix4();
  const place = (i: number, lift: number, scale: number) => {
    m.makeScale(scale, 1, scale);
    m.setPosition(BRAIN.x, record[i].y + lift, BRAIN.z);
    plates.setMatrixAt(i, m);
  };
  record.forEach((_, i) => place(i, 0, 1));

  // Edges (12 per plate, drawn slightly proud of the faces) + one mark per side.
  const e = half + 0.012;
  const ht = BRAIN.thickness / 2 + 0.012;
  const positions: number[] = [];
  const orders: number[] = [];
  const push = (order: number, a: readonly number[], b: readonly number[]) => {
    positions.push(...a, ...b);
    orders.push(order, order);
  };
  record.forEach((plate, i) => {
    const c = [BRAIN.x, plate.y, BRAIN.z];
    const corner = (sx: number, sy: number, sz: number) => [c[0] + sx * e, c[1] + sy * ht, c[2] + sz * e];
    for (const sy of [-1, 1]) {
      push(i, corner(-1, sy, -1), corner(1, sy, -1));
      push(i, corner(1, sy, -1), corner(1, sy, 1));
      push(i, corner(1, sy, 1), corner(-1, sy, 1));
      push(i, corner(-1, sy, 1), corner(-1, sy, -1));
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) push(i, corner(sx, -1, sz), corner(sx, 1, sz));
    // A mark on each side face, at mid-height, starting near one corner.
    plate.marks.forEach((length, side) => {
      const start = -half + BRAIN.size * 0.12;
      const end = start + BRAIN.size * length;
      const y = plate.y;
      if (side === 0) push(i, [c[0] + start, y, c[2] + e], [c[0] + end, y, c[2] + e]);
      if (side === 1) push(i, [c[0] + e, y, c[2] - start], [c[0] + e, y, c[2] - end]);
      if (side === 2) push(i, [c[0] - start, y, c[2] - e], [c[0] - end, y, c[2] - e]);
      if (side === 3) push(i, [c[0] - e, y, c[2] + start], [c[0] - e, y, c[2] + end]);
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('aOrder', new THREE.BufferAttribute(new Float32Array(orders), 1));
  const step = BRAIN.thickness + BRAIN.gap;
  const uniforms = {
    uWritten: { value: 0 },
    uLanding: { value: -1 },
    uSettle: { value: 1 },
    uRead: { value: -1 },
    uCount: { value: record.length },
    uStep: { value: step },
    uBase: { value: BRAIN.baseY + BRAIN.thickness / 2 },
    uAxis: { value: new THREE.Vector2(BRAIN.x, BRAIN.z) },
    uColor: { value: new THREE.Color(LAVENDER) },
    uPresence: { value: 1 },
  };
  const lines = new THREE.LineSegments(geometry, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aOrder;
      uniform float uWritten;
      uniform float uLanding;
      uniform float uSettle;
      uniform float uRead;
      uniform float uCount;
      uniform float uStep;
      uniform float uBase;
      uniform vec2 uAxis;
      varying float vAlpha;
      void main() {
        float written = step(aOrder, uWritten - 0.5);
        float isLanding = 1.0 - step(0.5, abs(aOrder - uLanding));
        float ease = 1.0 - pow(1.0 - uSettle, 3.0);
        // The landing plate drops onto the stack and grows to full size.
        vec3 centre = vec3(uAxis.x, uBase + aOrder * uStep, uAxis.y);
        vec3 landed = centre + (position - centre) * vec3(0.72 + 0.28 * ease, 1.0, 0.72 + 0.28 * ease) + vec3(0.0, (1.0 - ease) * 1.6, 0.0);
        vec3 p = mix(position, landed, isLanding);
        // Newest is brightest; older records hold a steady, lower light.
        float newest = exp(-max(uWritten - 1.0 - aOrder, 0.0) * 0.55);
        float read = uRead < 0.0 ? 0.0 : exp(-abs((uCount - 1.0 - aOrder) - uRead * uCount) * 1.4);
        vAlpha = written * (0.34 + 0.55 * newest + 0.6 * read) + isLanding * ease;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uPresence;
      varying float vAlpha;
      void main() {
        float a = vAlpha * uPresence;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  lines.frustumCulled = false;

  const object = new THREE.Group();
  object.add(plates, lines);
  let lastLanding = -1;
  return {
    object,
    /** `written` whole plates stand; `landing` (or -1) is settling at `settle` 0..1; `read` 0..1 sweeps top to bottom, or -1. */
    setState(written: number, landing: number, settle: number, read: number) {
      // A plate that has finished landing sits exactly in place, whatever the last frame's settle was.
      if (lastLanding >= 0 && lastLanding !== landing) {
        place(lastLanding, 0, 1);
        plates.instanceMatrix.needsUpdate = true;
      }
      lastLanding = landing;
      if (landing >= 0) {
        const ease = 1 - Math.pow(1 - settle, 3);
        place(landing, (1 - ease) * 1.6, 0.72 + 0.28 * ease);
        plates.instanceMatrix.needsUpdate = true;
      }
      // A record does not exist until its pulse has delivered it.
      plates.count = landing >= 0 ? landing + (settle > 0 ? 1 : 0) : written;
      uniforms.uWritten.value = written;
      uniforms.uLanding.value = landing;
      uniforms.uSettle.value = settle;
      uniforms.uRead.value = read;
    },
    /** 0 hides the record from a shot, 1 shows it fully; the plates darken into the void rather than fading. */
    setPresence(presence: number) {
      uniforms.uPresence.value = presence;
      material.color.copy(plateColor).multiplyScalar(presence);
      object.visible = presence > 0.01;
    },
    dispose() {
      plateBox.dispose();
      plates.dispose();
      material.dispose();
      geometry.dispose();
      (lines.material as THREE.Material).dispose();
    },
  };
}

function buildGrid() {
  const geometry = new THREE.PlaneGeometry(640, 640, 1, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(GRID) } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec3 vWorld;
      void main() {
        vec2 cell = vWorld.xz / 4.0;
        vec2 g = abs(fract(cell - 0.5) - 0.5) / fwidth(cell);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float r = length(vWorld.xz);
        float fade = 1.0 - smoothstep(22.0, 150.0, r);
        float pool = exp(-(r * r) / (2.0 * 17.0 * 17.0));
        float a = line * fade * 0.12 + pool * 0.05;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const object = new THREE.Mesh(geometry, material);
  object.rotation.x = -Math.PI / 2;
  object.position.y = GRID_Y;
  return {
    object,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
