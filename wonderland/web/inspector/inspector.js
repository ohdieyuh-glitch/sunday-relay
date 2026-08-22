// Wonderland Marble Inspector — browser-side, no GPU box required.
//
// SCOPE, STATED ONCE. Unreal 5.8 remains authoritative for collision,
// navigation, the Relay Dogs, multiplayer, interactions, GVE and the final
// render; Relay remains authoritative for mission execution. Nothing here is
// gameplay. This is an inspection surface for the questions that have actually
// cost this project metered GPU sessions:
//
//   is the shell upside down?          is it flipped 180?
//   is the scale wrong?                is the origin wrong?
//   can the arrival camera SEE it?     do visual and collider register?
//
// Every one of those is answerable from geometry and the placement contract,
// and none of them needs Pixel Streaming to answer.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { unrealPlacement, handedness, forwardFromRotator, verticalFov } from './placement.js';
import { evaluate } from './diagnostics.js';

const CONTRACT_URL = new URLSearchParams(location.search).get('contract')
  || './placement-contract.json';
const ASSET_BASE = new URLSearchParams(location.search).get('assets')
  || '/wonderland/marble/worlds/royal-garden-backdrop/';

const el = (id) => document.getElementById(id);
const status = (msg) => { el('status').textContent = msg; };

const state = {
  contract: null,
  visual: null,
  collider: null,
  camera: null,          // active hero camera description, or null for free orbit
  fovOverride: null,
  measured: { visual: null, collider: null },
};

// ---------------------------------------------------------------- scene
THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);   // Unreal is Z-up

const renderer = new THREE.WebGLRenderer({ canvas: el('view'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0E0B12);

const camera = new THREE.PerspectiveCamera(50, 1, 10, 8_000_000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// The Marble export is KHR_materials_unlit: its lighting is baked into the
// texture. Lights here would be re-lighting an already-lit image, which is the
// same mistake the engine would make. A dim ambient exists only for the
// collider, which has no baked anything.
scene.add(new THREE.AmbientLight(0xffffff, 1.0));

const debugGroup = new THREE.Group();
debugGroup.visible = false;
scene.add(debugGroup);

function resize() {
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  applyFov();
}
new ResizeObserver(resize).observe(renderer.domElement);

function applyFov() {
  const aspect = camera.aspect || (16 / 9);
  const horizontal = state.fovOverride
    ?? state.camera?.fov_horizontal_deg
    ?? 62;
  camera.fov = verticalFov(horizontal, aspect);
  camera.updateProjectionMatrix();
  el('fov-value').textContent = `${horizontal.toFixed(0)}° h`;
  el('fov').value = String(Math.round(horizontal));
}

// ---------------------------------------------------------------- loaders
function makeLoader() {
  const loader = new GLTFLoader();
  // Wired but not required. World Labs' current exports are plain glTF; these
  // are here so a future compressed export loads rather than failing with a
  // message about an extension nobody read.
  try {
    const draco = new DRACOLoader();
    draco.setDecoderPath('/node_modules/three/examples/jsm/libs/draco/');
    loader.setDRACOLoader(draco);
  } catch (e) { console.warn('DRACO unavailable', e); }
  try {
    const ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/');
    ktx2.detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
  } catch (e) { console.warn('KTX2 unavailable', e); }
  try { loader.setMeshoptDecoder(MeshoptDecoder); } catch (e) { console.warn('meshopt unavailable', e); }
  return loader;
}

async function loadGlb(relative) {
  const loader = makeLoader();
  const url = ASSET_BASE + relative;
  status(`loading ${relative}…`);
  const gltf = await loader.loadAsync(url, (p) => {
    if (p.total) status(`loading ${relative} — ${(100 * p.loaded / p.total).toFixed(0)}%`);
  });
  return gltf.scene;
}

// ---------------------------------------------------------------- placement
function place(object, contract) {
  object.applyMatrix4(unrealPlacement(contract));   // glTF -> Unreal cm
  object.applyMatrix4(handedness(contract));        // Unreal -> three.js
  object.updateMatrixWorld(true);
  return object;
}

/** Measured extent and centre, reported back in UNREAL cm for comparison. */
function measureUnreal(object, contract) {
  const box = new THREE.Box3().setFromObject(object);
  if (!isFinite(box.min.x)) return null;
  const inv = handedness(contract);                 // its own inverse
  const lo = box.min.clone().applyMatrix4(inv);
  const hi = box.max.clone().applyMatrix4(inv);
  const min = new THREE.Vector3(Math.min(lo.x, hi.x), Math.min(lo.y, hi.y), Math.min(lo.z, hi.z));
  const max = new THREE.Vector3(Math.max(lo.x, hi.x), Math.max(lo.y, hi.y), Math.max(lo.z, hi.z));
  return {
    min, max,
    extent: new THREE.Vector3().subVectors(max, min),
    centre: new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5),
    box,
  };
}

// ---------------------------------------------------------------- diagnostics
// The verdicts live in diagnostics.js with no DOM, so they can be tested
// against worlds broken on purpose. This renders them and decides nothing.
function checkRow(kind, text, why) {
  const li = document.createElement('li');
  li.className = kind;
  li.textContent = text;
  if (why) {
    const span = document.createElement('span');
    span.className = 'why';
    span.textContent = why;
    li.appendChild(span);
  }
  return li;
}

/**
 * Sample vertices of the visual mesh, in Unreal cm, so the frustum question is
 * answered against geometry rather than against a bounding box. A box has eight
 * corners and a shell has none of its content at them.
 */
function sampleUnrealPoints(object, contract, limit = 40000) {
  const inv = handedness(contract);
  const points = [];
  const meshes = [];
  object.traverse((n) => { if (n.isMesh && n.geometry?.attributes?.position) meshes.push(n); });
  const total = meshes.reduce((a, m) => a + m.geometry.attributes.position.count, 0);
  if (!total) return points;
  const stride = Math.max(1, Math.ceil(total / limit));
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const attr = mesh.geometry.attributes.position;
    mesh.updateMatrixWorld(true);
    for (let i = 0; i < attr.count; i += stride) {
      v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
      points.push(v.clone());
    }
  }
  return points;
}

function diagnose() {
  const list = el('checks');
  list.replaceChildren();
  const c = state.contract;
  const originPlaced = c
    ? new THREE.Vector3(0, 0, 0).applyMatrix4(unrealPlacement(c)).toArray()
    : null;
  const verdicts = evaluate({
    contract: c,
    visual: state.measured.visual && {
      extent: state.measured.visual.extent.toArray(),
      centre: state.measured.visual.centre.toArray(),
    },
    collider: state.measured.collider && {
      extent: state.measured.collider.extent.toArray(),
      centre: state.measured.collider.centre.toArray(),
    },
    originPlaced,
    camera: state.camera,
    frustumFraction: state.camera ? fractionInFrustum(state.camera) : null,
  });
  for (const v of verdicts) list.appendChild(checkRow(v.kind, v.text, v.why));
}

/** Fraction of far sampled points inside the hero camera's frustum. */
function fractionInFrustum(cam) {
  const pts = state.sampled;
  if (!pts || !pts.length) return null;
  const eye = new THREE.Vector3().fromArray(cam.location_cm);
  const fwd = forwardFromRotator(cam.pitch_deg, cam.yaw_deg);
  const worldUp = new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(worldUp, fwd).normalize();
  const up = new THREE.Vector3().crossVectors(fwd, right);
  const halfH = THREE.MathUtils.degToRad(cam.fov_horizontal_deg) * 0.5;
  const tanH = Math.tan(halfH);
  const tanV = tanH * cam.aspect;
  const rel = new THREE.Vector3();
  const dists = pts.map((p) => rel.subVectors(p, eye).length());
  const sorted = [...dists].sort((a, b) => a - b);
  const farCut = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
  let far = 0, inside = 0;
  pts.forEach((p, i) => {
    if (dists[i] < farCut) return;
    far += 1;
    rel.subVectors(p, eye);
    const depth = rel.dot(fwd);
    if (depth <= 1) return;
    if (Math.abs(rel.dot(right) / (depth * tanH)) <= 1 &&
        Math.abs(rel.dot(up) / (depth * tanV)) <= 1) inside += 1;
  });
  return far ? inside / far : null;
}

// ---------------------------------------------------------------- debug layers
function rebuildDebug() {
  debugGroup.clear();
  const c = state.contract;
  if (!c) return;
  const toThree = handedness(c);

  if (el('show-grid').checked) {
    // 100 m grid on the Unreal ground plane, and axes at the anchor so "which
    // way is up" is a thing you can see rather than infer.
    const grid = new THREE.GridHelper(200000, 40, 0x9B7BD4, 0x3A2F47);
    grid.rotation.x = Math.PI / 2;              // GridHelper is XZ; Unreal is XY
    debugGroup.add(grid);
    const axes = new THREE.AxesHelper(30000);
    axes.position.copy(new THREE.Vector3().fromArray(c.placement.origin_cm).applyMatrix4(toThree));
    debugGroup.add(axes);
  }

  if (el('show-bounds').checked) {
    for (const [obj, colour] of [[state.visual, 0xD9B45B], [state.collider, 0x6FA98A]]) {
      if (obj && obj.visible) debugGroup.add(new THREE.Box3Helper(
        new THREE.Box3().setFromObject(obj), new THREE.Color(colour)));
    }
  }

  if (el('show-frustum').checked && state.camera) {
    const cam = state.camera;
    const helperCam = new THREE.PerspectiveCamera(
      verticalFov(cam.fov_horizontal_deg, 16 / 9), 16 / 9, 100, 400000);
    const eye = new THREE.Vector3().fromArray(cam.location_cm).applyMatrix4(toThree);
    const target = new THREE.Vector3().fromArray(cam.location_cm)
      .add(forwardFromRotator(cam.pitch_deg, cam.yaw_deg).multiplyScalar(100000))
      .applyMatrix4(toThree);
    helperCam.position.copy(eye);
    helperCam.up.set(0, 0, 1);
    helperCam.lookAt(target);
    helperCam.updateMatrixWorld(true);
    debugGroup.add(new THREE.CameraHelper(helperCam));
  }

  debugGroup.visible = true;
}

function applyWireframe() {
  const on = el('show-wire').checked;
  for (const root of [state.visual, state.collider]) {
    root?.traverse((n) => {
      if (n.isMesh && n.material) {
        for (const mat of [].concat(n.material)) { mat.wireframe = on; mat.needsUpdate = true; }
      }
    });
  }
}

// ---------------------------------------------------------------- cameras
function useHeroCamera(cam) {
  state.camera = cam;
  state.fovOverride = null;
  controls.enabled = false;
  const c = state.contract;
  const toThree = handedness(c);
  const eye = new THREE.Vector3().fromArray(cam.location_cm).applyMatrix4(toThree);
  const look = new THREE.Vector3().fromArray(cam.location_cm)
    .add(forwardFromRotator(cam.pitch_deg, cam.yaw_deg).multiplyScalar(100000))
    .applyMatrix4(toThree);
  camera.position.copy(eye);
  camera.up.set(0, 0, 1);
  camera.lookAt(look);
  controls.target.copy(look);
  applyFov();
  el('camera').value = String(cam.index);
  for (const b of document.querySelectorAll('button.cam')) b.classList.remove('active');
  el(`cam-${cam.index}`)?.classList.add('active');
  el('cam-free').classList.remove('active');

  const facts = el('camera-facts');
  facts.replaceChildren();
  const rows = [
    ['tag', cam.tag],
    ['label', cam.label],
    ['location cm', cam.location_cm.join(', ')],
    ['pitch / yaw', `${cam.pitch_deg.toFixed(2)}° / ${cam.yaw_deg.toFixed(2)}°`],
    ['FOV horizontal', `${cam.fov_horizontal_deg}°`],
    ['frame elevation', `${cam.frame_elevation_deg[0].toFixed(1)}° … ${cam.frame_elevation_deg[1].toFixed(1)}°`],
    ['skyline sits at', `${state.contract.skyline_elevation_deg}°`],
  ];
  for (const [k, v] of rows) {
    const d = document.createElement('div');
    d.innerHTML = `<dt>${k}</dt><dd>${v}</dd>`;
    facts.appendChild(d);
  }
  rebuildDebug();
  diagnose();
}

function freeOrbit() {
  state.camera = null;
  controls.enabled = true;
  el('camera').value = '';
  for (const b of document.querySelectorAll('button.cam')) b.classList.remove('active');
  el('cam-free').classList.add('active');
  const target = state.visual ? new THREE.Box3().setFromObject(state.visual).getCenter(new THREE.Vector3())
                              : new THREE.Vector3();
  controls.target.copy(target);
  camera.position.copy(target.clone().add(new THREE.Vector3(120000, -160000, 60000)));
  applyFov();
  el('camera-facts').replaceChildren();
  rebuildDebug();
  diagnose();
}

// ---------------------------------------------------------------- boot
async function boot() {
  status('loading placement contract…');
  const contract = await (await fetch(CONTRACT_URL)).json();
  state.contract = contract;

  el('world-name').textContent =
    `${contract.provenance.display_name || 'Marble world'} · ${contract.placement.mode || 'placed'}`;

  const prov = el('provenance');
  prov.replaceChildren();
  const rows = [
    ['world id', contract.provenance.marble_world_id],
    ['operation', contract.provenance.operation_id],
    ['model', contract.provenance.model],
    ['generated', contract.provenance.generated_at],
    ['credits', contract.provenance.credits],
    ['reference', contract.provenance.source_reference],
    ['commercial use', contract.provenance.licence_commercial_use],
    ['triangles', contract.source_mesh.triangles?.toLocaleString?.()],
    ['vertices', contract.source_mesh.vertices?.toLocaleString?.()],
    ['double sided', String(contract.source_mesh.double_sided)],
    ['extensions', (contract.source_mesh.extensions_used || []).join(', ') || '—'],
    ['unreal uu / glTF unit', contract.placement.unreal_units_per_gltf_unit.toFixed(4)],
  ];
  for (const [k, v] of rows) {
    if (v === undefined || v === null) continue;
    const d = document.createElement('div');
    d.innerHTML = `<dt>${k}</dt><dd>${v}</dd>`;
    prov.appendChild(d);
  }

  // Representation picker — only what is actually on disk. An entry for a file
  // that is not there is how a tool reports "loaded" for nothing.
  const rep = el('representation');
  rep.replaceChildren();
  for (const [name, info] of Object.entries(contract.assets)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name} — ${info.representation}${info.present ? '' : ' (NOT on disk)'}`;
    opt.disabled = !info.present;
    if (info.is_source_mesh && info.present) opt.selected = true;
    rep.appendChild(opt);
  }

  const sel = el('camera');
  sel.replaceChildren(new Option('— free orbit —', ''));
  for (const cam of contract.cameras) sel.appendChild(new Option(`${cam.tag} · ${cam.label}`, String(cam.index)));

  wireUi();
  freeOrbit();
  diagnose();

  const chosen = rep.value && !rep.selectedOptions[0]?.disabled ? rep.value : null;
  if (chosen) await loadVisual(chosen);
  else status('No visual mesh on disk. Fetch it with the Marble CLI, then reload — ' +
              'the contract and every camera check above are still valid.');
}

async function loadVisual(name) {
  try {
    if (state.visual) { scene.remove(state.visual); state.visual = null; }
    const obj = place(await loadGlb(state.contract.assets[name].relative_path), state.contract);
    obj.visible = el('show-visual').checked;
    scene.add(obj);
    state.visual = obj;
    state.measured.visual = measureUnreal(obj, state.contract);
    state.sampled = sampleUnrealPoints(obj, state.contract);
    status(`${name} loaded — ${state.sampled.length.toLocaleString()} vertices sampled for framing checks`);
    applyWireframe(); rebuildDebug(); diagnose();
    if (!state.camera) freeOrbit();
  } catch (e) {
    status(`could not load ${name}: ${e.message}`);
    console.error(e);
  }
}

async function loadCollider() {
  const info = state.contract.assets['collider.glb'];
  if (!info?.present) { status('no collider.glb on disk'); el('show-collider').checked = false; return; }
  try {
    const obj = place(await loadGlb(info.relative_path), state.contract);
    obj.traverse((n) => {
      if (n.isMesh) n.material = new THREE.MeshBasicMaterial({
        color: 0x6FA98A, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false });
    });
    scene.add(obj);
    state.collider = obj;
    state.measured.collider = measureUnreal(obj, state.contract);
    status('collider loaded — it is a REFERENCE, not gameplay collision');
    rebuildDebug(); diagnose();
  } catch (e) { status(`could not load the collider: ${e.message}`); }
}

function wireUi() {
  el('camera').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === '') return freeOrbit();
    useHeroCamera(state.contract.cameras.find((c) => String(c.index) === v));
  });
  for (const idx of [0, 6]) {
    el(`cam-${idx}`).addEventListener('click', () => {
      const cam = state.contract.cameras.find((c) => c.index === idx);
      if (cam) useHeroCamera(cam);
      else status(`HeroCam${idx} is not in the generator's table`);
    });
  }
  el('cam-free').addEventListener('click', freeOrbit);
  el('fov').addEventListener('input', (e) => { state.fovOverride = Number(e.target.value); applyFov(); });
  el('representation').addEventListener('change', (e) => loadVisual(e.target.value));
  el('show-visual').addEventListener('change', (e) => {
    if (state.visual) state.visual.visible = e.target.checked; rebuildDebug();
  });
  el('show-collider').addEventListener('change', async (e) => {
    if (e.target.checked && !state.collider) await loadCollider();
    else if (state.collider) state.collider.visible = e.target.checked;
    rebuildDebug();
  });
  for (const id of ['show-bounds', 'show-grid', 'show-frustum']) {
    el(id).addEventListener('change', rebuildDebug);
  }
  el('show-wire').addEventListener('change', applyWireframe);
}

function tick() {
  requestAnimationFrame(tick);
  if (controls.enabled) controls.update();
  renderer.render(scene, camera);
}

resize();
tick();
boot().catch((e) => { status(`failed to start: ${e.message}`); console.error(e); });

// Exposed for the parity test and for poking at from the console. Not an API.
window.__inspector = { state, measureUnreal, fractionInFrustum, THREE };
