import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DOG_BOXES, DOG_PIVOTS, type DogJoint, type DogSurface } from './relay-dog';
import type { DogPose } from './dog-rig';
import type { LandingMaterials } from './materials';

/**
 * The Relay Dog as a Three.js scene graph.
 *
 * Boxes are MERGED PER (joint × surface). The Dog is 25 boxes; left as
 * individual meshes that is 25 draw calls for one character, before the Aquala
 * mark, the tracer and the ground. Merged, it is seven — one per articulated
 * part, plus the visor and eyes — and the articulation is preserved because the
 * merge happens INSIDE each joint's local space.
 *
 * Merging across joints would be faster still and would also weld the head to
 * the shoulders, which is why it is not done.
 */

export type DogMesh = {
  readonly root: THREE.Object3D;
  applyPose(pose: DogPose): void;
  dispose(): void;
};

const SURFACE_MATERIAL = (materials: LandingMaterials, surface: DogSurface): THREE.Material =>
  surface === 'ivory' ? materials.ivory : surface === 'visor' ? materials.visor : materials.eye;

export function buildDogMesh(materials: LandingMaterials): DogMesh {
  const root = new THREE.Object3D();
  const joints = new Map<DogJoint, THREE.Object3D>();
  const owned: THREE.BufferGeometry[] = [];

  const jointNames = Object.keys(DOG_PIVOTS) as DogJoint[];
  for (const joint of jointNames) {
    const pivot = DOG_PIVOTS[joint];
    const node = new THREE.Object3D();
    node.position.set(pivot[0], pivot[1], pivot[2]);
    joints.set(joint, node);
    root.add(node);

    const surfaces: DogSurface[] = ['ivory', 'visor', 'eye'];
    for (const surface of surfaces) {
      const boxes = DOG_BOXES.filter((b) => b.joint === joint && b.surface === surface);
      if (boxes.length === 0) continue;
      const parts = boxes.map((b) => {
        const geometry = new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]);
        // Into the joint's local frame, so rotating the joint rotates the part
        // about the pivot rather than about the model origin.
        geometry.translate(b.center[0] - pivot[0], b.center[1] - pivot[1], b.center[2] - pivot[2]);
        return geometry;
      });
      const merged = mergeGeometries(parts, false);
      parts.forEach((p) => p.dispose());
      if (!merged) continue;
      owned.push(merged);
      const mesh = new THREE.Mesh(merged, SURFACE_MATERIAL(materials, surface));
      mesh.castShadow = surface === 'ivory';
      node.add(mesh);
    }
  }

  const head = joints.get('head')!;
  const armLeft = joints.get('armLeft')!;
  const armRight = joints.get('armRight')!;
  const legLeft = joints.get('legLeft')!;
  const legRight = joints.get('legRight')!;
  const tail = joints.get('tail')!;

  return {
    root,
    applyPose(pose) {
      root.position.set(pose.rootX, pose.rootY, pose.rootZ);
      root.rotation.set(0, pose.rootYaw, pose.rootRoll);
      head.rotation.set(pose.headPitch, pose.headYaw, 0);
      armLeft.rotation.x = pose.armLeftPitch;
      armRight.rotation.x = pose.armRightPitch;
      legLeft.rotation.x = pose.legLeftPitch;
      legRight.rotation.x = pose.legRightPitch;
      tail.rotation.set(pose.tailPitch, pose.tailYaw, 0);
    },
    dispose() {
      owned.forEach((g) => g.dispose());
    },
  };
}
