/**
 * SELECTABLE STAGE BACKDROPS — the catalog, as a pure projection.
 *
 * A backdrop is scenery. It carries no product meaning, gates nothing, and
 * cannot change what any surface reports — the same rule the Relay Dog motion
 * system holds itself to. A user choosing the Space Station does not put Relay
 * in space; it puts a picture behind the actors.
 *
 * WHY A CATALOG RATHER THAN A STRING. `backdrop === 'jungle'` scattered across
 * components is how a fifth backdrop arrives with four places that do not know
 * about it. One closed list, one resolver, and an unknown id resolves to NONE
 * rather than to a default — because a stored preference naming a backdrop this
 * build does not have is a fact about an older build, not an instruction to
 * show something else.
 *
 * NO EXTERNAL ASSETS. Every backdrop is drawn in CSS and inline SVG, for the
 * same reason the Relay Dog is: an image URL is a network request, a licence
 * question and a thing that can 404 into a blank stage.
 * `relay-stage-backdrop.css` and the components beside it contain the whole of
 * every scene.
 */

export const RELAY_BACKDROP_IDS = ['none', 'jungle', 'space_station'] as const;
export type RelayBackdropId = (typeof RELAY_BACKDROP_IDS)[number];

export interface RelayBackdropEntry {
  readonly id: RelayBackdropId;
  readonly label: string;
  /** One sentence, shown next to the choice. Says what it IS, not how it feels. */
  readonly description: string;
  /**
   * True when the scene animates at all. A backdrop that does not move is
   * unaffected by reduced motion, and saying so lets a picker be honest about
   * which choices that setting changes.
   */
  readonly animated: boolean;
}

export const RELAY_BACKDROPS: readonly RelayBackdropEntry[] = Object.freeze([
  Object.freeze({
    id: 'none' as const,
    label: 'None',
    description: 'No scene behind the actors. The stage shows the page beneath it.',
    animated: false,
  }),
  Object.freeze({
    id: 'jungle' as const,
    label: 'Jungle',
    description: 'Layered canopy, undergrowth and a light shaft, drawn in CSS and SVG.',
    animated: true,
  }),
  Object.freeze({
    id: 'space_station' as const,
    label: 'Space Station',
    description: 'A station interior with a window onto open space: stars, a planet limb and its terminator.',
    animated: true,
  }),
]);

const BY_ID: ReadonlyMap<string, RelayBackdropEntry> = new Map(
  RELAY_BACKDROPS.map((entry) => [entry.id, entry]),
);

/**
 * Resolve a stored or supplied id.
 *
 * An UNKNOWN id resolves to `none`, never to `jungle`. A preference naming a
 * backdrop this build does not have describes an older build, and substituting
 * a different scene would be the surface deciding something the user did not.
 */
export function resolveBackdrop(id: unknown): RelayBackdropEntry {
  const entry = typeof id === 'string' ? BY_ID.get(id) : undefined;
  return entry ?? BY_ID.get('none')!;
}

export const isKnownBackdrop = (id: unknown): id is RelayBackdropId =>
  typeof id === 'string' && BY_ID.has(id);

/**
 * What a picker renders.
 *
 * `changesWithReducedMotion` exists so the picker can say which choices a
 * reduced-motion setting actually affects, rather than implying it changes all
 * of them or none.
 */
export interface RelayBackdropChoice extends RelayBackdropEntry {
  readonly selected: boolean;
  readonly changesWithReducedMotion: boolean;
}

export function projectBackdropChoices(input: {
  readonly selected: unknown;
  readonly reducedMotion: boolean;
}): readonly RelayBackdropChoice[] {
  const active = resolveBackdrop(input.selected);
  return RELAY_BACKDROPS.map((entry) => ({
    ...entry,
    selected: entry.id === active.id,
    changesWithReducedMotion: entry.animated && input.reducedMotion,
  }));
}
