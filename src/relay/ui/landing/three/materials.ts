import * as THREE from 'three';

/**
 * THE LANDING'S MATERIAL SET, and the one rule that governs it.
 *
 * Both references ration colour to near-zero and let the RENDER carry every
 * chromatic accent — Reference B is explicit that its pink "is never used on UI
 * chrome … appears only as the soft edge-light on cubes". Relay adopts that
 * rule with two accents under strict ownership:
 *
 *   AQUALA owns baby-blue. It is light, glass and signal. Never a UI colour.
 *   RELAY owns gold. It is the Dog's eyes and its rim. Never body copy.
 *
 * Everything else is cream on near-black.
 */

export type QualityTier = 'high' | 'medium' | 'low';

export const LANDING_COLORS = Object.freeze({
  void: 0x05060a,
  ivory: 0xfbf4e2,
  cream: 0xf4efe3,
  visor: 0x07080a,
  gold: 0xd8a83c,
  goldDim: 0xa8792a,
  aqualaBody: 0xfaf8f3,
  aqualaLight: 0x9fd8f5,
  aqualaCore: 0xdff2ff,
});

/** Everything this module allocates, so the engine can dispose it in one call. */
export type LandingMaterials = {
  readonly ivory: THREE.Material;
  readonly visor: THREE.Material;
  readonly eye: THREE.Material;
  readonly aquala: THREE.Material;
  dispose(): void;
};

export function createLandingMaterials(tier: QualityTier): LandingMaterials {
  // Warm ivory, slightly matte. Enough specular response to show the block
  // facets — a fully matte body loses every edge and the Dog reads as a
  // silhouette rather than a solid.
  const ivory = new THREE.MeshStandardMaterial({
    color: LANDING_COLORS.ivory,
    roughness: 0.55,
    metalness: 0.02,
  });

  // Deep black with a tight specular. The reference visor catches one hard
  // highlight; a pure matte black would read as a hole cut in the head.
  const visor = new THREE.MeshStandardMaterial({
    color: LANDING_COLORS.visor,
    roughness: 0.26,
    metalness: 0.15,
  });

  // RESTRAINED emissive. `emissiveIntensity` above ~1.6 with bloom on turns the
  // eyes into two white blobs and takes the gold with them — the founder's
  // "restrained emissive glow", not a torch.
  const eye = new THREE.MeshStandardMaterial({
    color: LANDING_COLORS.gold,
    emissive: new THREE.Color(LANDING_COLORS.goldDim),
    emissiveIntensity: 1.15,
    roughness: 0.35,
    metalness: 0.25,
  });

  // The Aquala mark is a physical digital object: translucent body, internal
  // glow, rim light. Transmission is a per-pixel refraction pass and is the
  // single most expensive thing on this page, so only the top tier pays for it.
  const aquala =
    tier === 'high'
      ? new THREE.MeshPhysicalMaterial({
          color: LANDING_COLORS.aqualaBody,
          roughness: 0.14,
          metalness: 0,
          transmission: 0.68,
          thickness: 0.55,
          ior: 1.36,
          clearcoat: 0.7,
          clearcoatRoughness: 0.2,
          emissive: new THREE.Color(LANDING_COLORS.aqualaLight),
          emissiveIntensity: 0.22,
          transparent: true,
        })
      : new THREE.MeshStandardMaterial({
          // The graceful degradation keeps the READ — ivory body, blue internal
          // glow — and drops only the refraction. Falling back to an opaque
          // material instead would change what the logo IS on a phone.
          color: LANDING_COLORS.aqualaBody,
          roughness: 0.22,
          metalness: 0.05,
          emissive: new THREE.Color(LANDING_COLORS.aqualaLight),
          emissiveIntensity: 0.3,
          transparent: true,
          opacity: 0.9,
        });

  return {
    ivory,
    visor,
    eye,
    aquala,
    dispose() {
      ivory.dispose();
      visor.dispose();
      eye.dispose();
      aquala.dispose();
    },
  };
}
