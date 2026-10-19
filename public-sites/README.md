# Public sites — i.Wonder and Wonderland

Two static marketing sites that replace the outdated public pages. Nothing here
is deployed, and nothing here is part of the product build.

| Site | Directory | Replaces | Local preview |
|---|---|---|---|
| **i.Wonder** — the company | `iwonder/` | `aquala-technologies.ohdieyuh.chatgpt.site` | http://127.0.0.1:4311/ |
| **Wonderland** — the flagship, powered by Julius | `wonderland/` | `relayaquala.tech` | http://127.0.0.1:4312/ |

```sh
# from the repository root
PUBLIC_SITE=iwonder    npx vite --config public-sites/vite.config.mts          # dev, :4311
PUBLIC_SITE=wonderland npx vite --config public-sites/vite.config.mts          # dev, :4312
PUBLIC_SITE=iwonder    npx vite build --config public-sites/vite.config.mts    # -> public-sites/dist/iwonder
PUBLIC_SITE=wonderland npx vite build --config public-sites/vite.config.mts    # -> public-sites/dist/wonderland
PUBLIC_SITE=iwonder    npx vite preview --config public-sites/vite.config.mts  # serve the build
npx tsc -p public-sites/tsconfig.json --noEmit                                  # typecheck
npx vitest run public-sites                                                     # canon + structure tests

# review build for a single sandboxed page host (fonts, CSS, JS inlined) -> public-sites/dist/artifact-<site>
PUBLIC_SITE_ARTIFACT=1 PUBLIC_SITE=wonderland npx vite build --config public-sites/vite.config.mts

# lighter alternative for serving a build on a memory-constrained machine
python -m http.server 4311 --bind 127.0.0.1 --directory public-sites/dist/iwonder
python -m http.server 4312 --bind 127.0.0.1 --directory public-sites/dist/wonderland
```

Cross-site links and canonical URLs are injected at build time, so a local
review build can point at the local previews:

| Variable | Default (production) |
|---|---|
| `PUBLIC_SITE_IWONDER_URL` | `https://aquala-technologies.ohdieyuh.chatgpt.site/` — **needs a non-Aquala domain** |
| `PUBLIC_SITE_WONDERLAND_URL` | `https://relayaquala.tech/` |
| `PUBLIC_SITE_APP_URL` | `https://sunday-relay.vercel.app/` (the live Wonderland front door) |

---

## 1. Discovery — who owns what

### The two outdated sites

Neither site has source in this repository, in its git history, in any other
local checkout, or in any of the account's GitHub repositories
(`sunday-relay`, `relay-ship-proof`, `Sunday-Alacraz-`).

Both are **Codex / ChatGPT-hosted generated deployments**:

- served by Cloudflare, rendered by **vinext** (a Vite reimplementation of the
  Next.js App Router — `__VINEXT_RSC_*` payloads, `_vinext_fonts`);
- both carry `<meta name="codex-preview" content="development">`;
- `aquala-technologies.ohdieyuh.chatgpt.site` is a `chatgpt.site` subdomain, and
  `relayaquala.tech` is a custom domain on the same hosting (identical build
  chunks, e.g. `framework-DjPHiq1u.js`, `rolldown-runtime-S-ySWqyJ.js`);
- both use Geist / Geist Mono.

So there was nothing to edit in place. These sites are rebuilt here as portable
static output (plain HTML, CSS, JS) that can be published to any host —
including back into the Codex site project, or behind the same domains on a new
host. **Choosing that host is a founder decision; nothing has been deployed.**

### The Wonderland landing (the quality bar)

`https://sunday-relay.vercel.app` is this repository's own Vite build:
`index.html` → `src/relay/main.tsx` → `RelayWorld` → `src/relay/ui/landing/`.
It arrived in #199 (the 3-D landing) and was rebranded to i.Wonder in #229.

What makes it better than the old sites, measured from its source rather than
guessed at (`docs/relay/LANDING_3D_MECHANICS.md` records the reasoning):

| Quality | How the landing does it |
|---|---|
| The render is the page | One persistent WebGL canvas; chrome is ghost-weight over it; no section owns a background. |
| Restraint in colour | Near-black `#05060a`, cream `#f4efe3`. Accents live **only in the render** (the Dog's gold eyes, one light colour). Exactly one gold hairline on the DOM: the CTA. |
| Typography with counterpoint | Editorial serif display at 0.94 leading against 11px uppercase Fira Code labels and a quiet system sans body. |
| Composition | Corner-anchored chrome (Max Yinger's z-pattern) around a centred, uncontained 3-D subject. No frames, no cards, no dividers. |
| Depth without CSS tricks | No `box-shadow` anywhere; glass chips behind a `@supports` guard; hairline borders; distance fog. |
| Motion | DOM moves by opacity and a few pixels only. Spatial motion lives in WebGL: critically-damped springs, shaped gait, additive pointer look, breathing idle. |
| Light | ACES filmic tone mapping at 1.25 exposure, one cool-neutral key, a restrained rim, fills kept far below the key, contact shadow drawn in a shader. |
| The Relay Dog | Procedural canonical geometry (`relay-dog.ts`), merged per joint — 25 boxes, seven draw calls — held to proportion bands by tests. |
| Honesty | Telemetry shows measured values only; reduced motion holds compositions; no-WebGL turns the semantic document into the visible page. |
| Responsive | Portrait locks the horizontal field of view instead of shrinking the desktop shot; quality tiers degrade effects, never content. |

### What was wrong with the old sites

**aquala-technologies.ohdieyuh.chatgpt.site** — presents *Aquala Technologies*
as the company ("Compound AI Frontier Lab"); the Aquala mark and wordmark
throughout; "© 2026 AQUALA TECHNOLOGIES"; Relay as the "first flagship"; no
Wonderland, no Julius, no i.Wonder anywhere; a decorative clock and fake
coordinates (`40.0000° N`) as telemetry.

**relayaquala.tech** — title "Sunday Relay — Enter Wonderland"; *SUNDAY RELAY*
wordmark; "Built by Aquala Technologies · Part of the Sunday family";
**PSP / Project Settings Preset** used 20+ times (banned); "Ship on Sundays"
marketplace with a **$39** price; **Sunday Alcatraz** named as the Prompt
Architect; Relay (not Julius) described as the coordination layer; unreleased
mechanics presented as product (Battle Pass, Unchained, Clan Wars staking
"credits, cosmetics, or territory", Relay Legends, "King Romulus" skin, cub
puppies); "Coding Agent" / "Reviewer" without *Independent*; no Julius at all;
the **retired side-facing Relay Dog** (`relay-dog-gold-v3.png`) as the hero
identity; a HUD concept image with fabricated numbers; waitlist forms posting
to the Codex host.

---

## 2. Migration plan

### Hierarchy every visitor should leave with

```
i.Wonder Laboratories, Inc. the company — builds multiplayer open-world AI creation platforms, and
                            researches, develops and deploys Compound AI Systems and Compound AI Agents
   ↓
Wonderland                  the flagship multiplayer open-world AI creation platform
   ↓
Julius                      the flagship Compound AI Agent — three persistent architectural tiers:
                              Prompt Architect      Large Language Model
                              Coding Agent          agentic coding system
                              Independent Reviewer  independent agent harness / reviewer runtime
                            and Project Brain, its durable memory and state layer
```

The company site no longer leads with "AI creation infrastructure and persistent
AI-native worlds"; `canon.test.ts` fails if that positioning returns.

### Two sites, one family, deliberately not clones

| | i.Wonder (company) | Wonderland (product) |
|---|---|---|
| Register | Editorial, a lab's thesis | Cinematic, product storytelling |
| 3-D subject | **The persistent world** — a floating voxel island over a grid, structures materialising, presences and signals converging on **Julius**: a governing core above the tower's crown with three permanent tier slots (a ring that holds while the light inside it is replaced). Beneath the world, **Project Brain** — a stack of records that grows as the reader arrives and is read through once complete. No Relay Dog | **The Relay Dog** at hero scale on Wonderland's arcane ring, world fragments in the fog, Julius's three role signals orbiting |
| Render accent | Cool lab light + lavender construction light | Wonderland violet ring light |
| Layout | Scrolling document; the world recedes as the thesis takes over | Fixed stage; the camera and the Dog respond to each chapter |
| Storytelling device | The hierarchy, then the architecture: i.Wonder → Wonderland → Julius → three tiers → Project Brain. The camera climbs to Julius's crown, then descends beneath the world to the record | Chapters: World → Persistent → Julius → Mission → C.A.R.D. → Identity |

### Shared design system (`shared/`)

Adapted, not copied, from the landing: the same void/cream/dim values, the
same serif/mono/sans counterpoint, pill-or-ghost CTAs, glass chips, hairlines,
no shadows, opacity-first DOM motion, the same renderer settings and light rig.

**Reused by import, not duplicated** — so a fix to the Dog lands on all three
surfaces at once:

- `src/relay/ui/landing/three/relay-dog.ts`, `dog-mesh.ts` — canonical Dog geometry (Wonderland only)
- `src/relay/ui/landing/three/dog-rig.ts` — springs, gait, breathing, pointer look (i.Wonder uses only its `springStep`)
- `src/relay/ui/landing/three/materials.ts` — ivory, visor, eye materials
- `src/relay/ui/landing/three/engine.ts` — quality tier and DPR policy
- `src/relay/ui/landing/choreography.ts` — `sampleTrack`, `smoothstep`, `clamp01`

These are pure Three.js / pure TypeScript modules with no React and no product
state. They are consumed read-only; no file under `src/` was modified.

### Content migration

| Old | New |
|---|---|
| Aquala Technologies (company) | **i.Wonder** / **i.Wonder Laboratories, Inc.** |
| Aquala mark, AQUALA wordmark | i.Wonder wordmark (typographic); no Aquala mark |
| Sunday Relay (product) | **Wonderland** (flagship), powered by **Julius** |
| Relay as the coordination layer | **Julius** owns mission authority, orchestration, dependencies, permissions, budgets, Project Brain, synthesis, conflict resolution, verification, termination |
| "multi-agent workspace / coordinated AI workforce" | **Compound AI Agent** |
| Prompt Architect (Sunday Alcatraz) / Coding Agent (Claude Code) / Reviewer | Prompt Architect / Coding Agent / **Independent Reviewer** — persistent architectural tiers that belong to Julius. The company site names providers only as illustrative, replaceable implementations inside a tier's slot (`[data-providers]`); Wonderland names none. Both enforced by `canon.test.ts` |
| Project Brain as "durable memory of a project" | **Project Brain is Julius's durable memory** — a persistent record of the actions, decisions, evidence, state and history accumulated by the Compound AI Agent throughout a mission or project |
| PSP / Project Settings Preset | **C.A.R.D.** |
| Cub puppies / sub-agents | **Multi-Agent Swarm** — temporary, specialised Compound AI Agent clones, only when justified |
| Ship on Sundays, $39 pricing, Battle Pass, Unchained, Clan Wars stakes, Relay Legends, King Romulus | removed (unreleased / speculative) |
| Retired side-facing Relay Dog PNGs | canonical front-facing voxel Relay Dog, rendered live |
| Waitlist forms on the Codex host | "Enter Wonderland" → the live front door; no data collection on these sites |
| Loop engineering copy | kept in spirit: *Completion is earned, not claimed* |

---

## 3. What was built

```
public-sites/
  vite.config.mts          one config, PUBLIC_SITE selects the site; URL placeholders fail the build if unresolved
  tsconfig.json            extends the repo config; not part of `npm run typecheck` yet
  canon.test.ts            forbidden/required terms, scoped vendor names, company positioning, Julius tiers,
                           Project Brain definition, no Dog on i.Wonder, one shot per section (mutation-checked)
  shared/
    tokens.css, base.css   design family of the landing: palette, type, CTAs, chips, nav, sheet, reveals
    chrome.ts              scrolled nav, accessible menu sheet, reveals, aria-current
    fonts/                 Newsreader (OFL, licence included)
    three/stage.ts         renderer + light rig (landing settings; tier/DPR policy imported from the landing)
    three/comet.ts         the landing's signal tracer, generalised to any curve
    three/loop.ts          one rAF loop: hidden-tab pause, on-demand rendering under reduced motion, measured FPS
    three/scroll-rig.ts    section-keyed camera with arrive / hold / depart (+ tests)
  iwonder/                 the company site: index.html, site.css, main.ts, world-plate.ts (+ tests), world-scene.ts
  wonderland/              the product site: index.html, site.css, main.ts, dog-stage.ts, concept art (webp + jpg)
```

No file outside `public-sites/` was modified.

## 4. QA record (2026-09-12)

| Check | Result |
|---|---|
| `npx tsc -p public-sites/tsconfig.json --noEmit` | clean |
| `npx vitest run public-sites` | 80 passed (canon test also verified to FAIL on 8 injected violations) |
| `node scripts/relay-repository-boundary.mjs` with `public-sites/` intent-to-add | PASS (index reverted afterwards) |
| repo tests that enumerate files (`repository-boundary`, `ci-test-accounting`, `executor-boundary`, `production-root-entry`, `relay-ui-boundary`) | 330 passed |
| Both builds | succeed; `public-sites/dist` is gitignored |
| Console errors / failed requests | none, desktop and mobile, both sites |
| Horizontal overflow | none at 375, 390, 834, 1112, 1280, 1440, 1920 |
| Keyboard | first Tab reaches the skip link; menu sheet sets aria-expanded, un-inerts, moves focus, locks scroll, closes on Escape and returns focus, closes on navigation |
| axe-core 4 (1440×900, reduced motion) | 0 violations on both. axe cannot measure contrast over a canvas; text tiers were chosen to clear AA on the void (dim 8.9:1, faint 4.9:1) and copy over the render sits on scrims |
| Reduced motion | reveals visible immediately, no smooth scroll, camera snaps to section compositions, scene renders on demand only |
| No WebGL (`--disable-3d-apis`) | lit CSS fallback, full content, no errors |
| Draw calls / triangles per frame (measured by instrumenting WebGL) | i.Wonder 20 / ≤16k; Wonderland 13–16 / ≤16k |
| Script time per frame (measured, median) | 1.3–2.0 ms |
| Frame rate | only measurable here under SwiftShader software rendering, which says nothing about a real GPU. It did expose one real hotspot — the instanced terrain's hidden walls — now replaced by a visible-faces mesh (14% of the surface, ~5× faster under software rendering) |
| Gzipped JS | three.js chunk 132 KB (lazy, after content); site code 3 KB + 11 KB scene; CSS 5 KB |
| Deprecated copy in shipped HTML/CSS/JS | none. Two non-visible residues, both flagged below |

### Company positioning revision (2026-09-12, continuation session)

What changed on the i.Wonder site only (`iwonder/`, `canon.test.ts`, this README). Nothing under
`wonderland/`, `shared/` or `src/` was modified.

- **Julius section** — the SVG connector (which missed the card centres by ~8px and left a stray pulse
  stub) is replaced by layout-drawn connectors: Julius → three tier plates → **Project Brain** as the
  layer every tier writes into. Each plate states its technology class, its purpose, and a dashed provider
  slot of illustrative implementations; a "Julius is not" trio; slot copy now says the slots belong to Julius.
- **Project Brain section** — canonical definition, "memory and state layer of the agent itself", a
  persistence row closing the record, and its own camera shot (it previously inherited the principles
  shot and rendered over an empty void).
- **Scene** — Relay Dog removed; Julius core + three counter-rotating tier slots above the crown with a
  pulse per branch; Project Brain record stack beneath the world with a write spine; eighth camera shot;
  per-section record presence; portrait distance table.
- **Fixes to earlier regressions** — principles no longer render the world behind their copy; provider
  sequence arrows no longer inherit the active underline; tablet portrait scrim no longer leaves a hard
  edge across the render; the hero hierarchy is no longer a nested `<aside>` landmark (axe).

| Check | Result |
|---|---|
| `npx tsc -p public-sites/tsconfig.json --noEmit` | clean |
| `npx vitest run public-sites` | 92 passed; 7 injected violations each caught by the intended test, files restored byte-identical |
| Build | succeeds; scene chunk 32 KB → 26 KB with the Dog removed |
| Console errors / failed requests | none (desktop, reduced motion, no WebGL, phone) |
| Horizontal overflow | none at 375, 390, 834, 1112, 1280, 1440, 1920 |
| axe-core 4.10 (1440×900, reduced motion) | 0 violations |
| Reduced motion / no WebGL / keyboard | full record written and every reveal shown / lit fallback with all content / skip link first, Project Brain plate reaches `#brain`, menu opens and closes on Escape |

## 5. Needs founder approval

1. **Visual approval** of both sites at the local previews.
2. **i.Wonder production domain.** The only current home is `aquala-technologies.ohdieyuh.chatgpt.site`; its hostname carries "aquala". Canonical/OG URLs default to it until a domain is chosen (`PUBLIC_SITE_IWONDER_URL`).
3. **Hosting.** Output is plain static files. Options: re-publish into the Codex site projects, or point the domains at another static host. No deployment config was added (the boundary scanner forbids it in this repository).
4. **Where this code lives.** It is in the product repository today and imports the canonical Relay Dog modules from `src/relay/ui/landing/three/`. If the sites move to their own repository, those modules should become a shared package rather than a copy.
5. **Wordmark and favicons.** No official i.Wonder mark exists, so the wordmark is typographic ("i.Wonder" in Newsreader) and the favicon is an "i." monogram with a gold period. The Wonderland favicon is the canonical Dog's head.
6. **Display serif.** Newsreader (self-hosted, OFL) instead of the landing's Georgia. Swapping is one token: `--pw-serif`.
7. **Concept art.** `wonderland-realm` (the founder-supplied art-direction reference, already public on the old site) is shown once, captioned "Concept art — not a screenshot". The HUD image and the retired side-facing Dog were not reused.
8. **CTA destinations.** "Enter Wonderland" → `https://sunday-relay.vercel.app/` (the live front door; its hostname still reads "sunday-relay", and that page's own title is "Relay's Wonderland"). The old waitlist forms were not rebuilt — these sites collect no data.
9. **Status language.** Both sites say "in development"; confirm that is the public wording.
9a. **Third-party names on the company site.** Julius's tier plates name illustrative providers (OpenAI GPT / ChatGPT, Anthropic Claude, Claude Code, OpenAI Codex, Devin, Cursor Agent, GitHub Copilot coding agent, Windsurf / Cascade, Hermes Agent, Pi Agent, and others) with a trademark notice in the footer. Confirm the list and the wording before publishing.
10. **Internal identifiers.** The imported canonical material module keeps its original property names (`aqualaBody`, `aqualaLight`, …), which appear minified inside the scene chunk. Not visible to visitors; renaming them is a change to the landing's source and was out of scope.
11. **CI wiring.** When committed, add `tsc -p public-sites/tsconfig.json` to `npm run typecheck` (the tests are already picked up by `npm test`).
