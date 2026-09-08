# Kart bodies — 8 distinct chassis silhouettes

**Problem.** All eight racers share one procedural chassis in `KartModel.ts`; only the paint changes, so players read the roster as a palette swap. **Goal.** Every racer gets its own body silhouette that matches its name, tagline and stat profile, while the game stays a go-kart racer (open wheels, visible seated driver, steering wheel, exhausts) and 100% procedural (no asset files, bundle size flat).

Decision log: free CC0 kits (Kenney Car Kit / Toy Car Kit, Poly Pizza) were rendered side by side with the current kart. None offers eight *kart* bodies that differ: the Kenney karts are one body in five colours with a foreign blocky driver, the Toy Car Kit is closed toy cars (driver hidden). Chosen path: build the bodies procedurally; Kenney pieces may be copied only as individual details if a shape proves hard to model (none are needed in the first pass).

## Design

### Boundaries
- `src/kart/modelUtils.ts` — `Batch`, `makeMesh`, `limbGeometry`, `addVertexColor`, `profileChassis()` (side-profile extrude + width curve, generalised from the old `buildChassisGeometry`). Pure geometry helpers, no character knowledge.
- `src/kart/bodies.ts` — `KartBodySpec` per character id + `getBodySpec(id)` (falls back to `max`). A spec is data plus one `build(kit)` function that adds geometry to the four material batches (`body`, `accent`, `dark`, `chrome`) through a `BodyKit` helper. Specs never touch scene objects.
- `src/kart/KartModel.ts` — `buildKartModel(character)` keeps its signature and `KartModelPartsEx` handles. It owns materials, common parts (floor pan, engine, steering, seat, driver, gloves, wheels, plates, exhausts) and asks the spec for the chassis. Kart.ts / MenuBackdrop / net code are untouched.

### `KartBodySpec`
```ts
interface KartBodySpec {
  wheels: { front: { r: number; w: number }; rear: { r: number; w: number } }; // multipliers on the base wheel radius/width (visual only)
  lift: number;               // raises seat, driver, steering column, gloves (tall chassis)
  engine: boolean;            // show the common rear engine block + air filter
  exhausts: { x: number; y: number; z: number; rx: number; length: number }[]; // rx = -PI/2 gives a vertical stack
  plates: { front: { y: number; z: number }; side: { x: number; y: number; z: number } };
  build(kit: BodyKit): void;  // chassis + spoiler + trim
}
```
Wheel positions, `KART_RADIUS`, physics and the net protocol do not change: a bigger wheel is drawn around the same hub, and `wheelRadii` is scaled so spin speed still matches ground speed.

### The eight silhouettes
| id | class | silhouette | signature pieces |
|---|---|---|---|
| zippy | light, launch | lowest and narrowest; arrowhead nose cone | thin low wing, single centre exhaust, small wheels (0.85) |
| pixel | light, handling | bubble pod with four fender domes | two canopy arches (accent), round tail lights, no spoiler, chubby wheels |
| fennec ★ | light premium | flat desert-buggy tub with nose wedge | dark tube roll cage, two "ear" air intakes (accent), knobby wide tyres |
| max | medium all-rounder | today's cigar body + side pods (baseline) | high wing + end plates, front bumper ring, strips |
| juno | medium, mini-turbo | angular stealth slab, tapered nose, side wedges | zig-zag lightning fins + top bar, four exhausts |
| kai | medium, speed | long flat surf deck with rounded nose | wave side skirts, shark-fin spoiler + two small fins, centre stripe |
| bram ★ | heavy premium | wide low monster chassis with cab hump | armour plates (dark), bull bar, heavy wing on struts, fat wheels (1.25 / 1.3) |
| rosa ★ | heavy premium | tall truck hood + long flatbed, highest seat | chrome grille + slats, chrome bumper, twin vertical exhaust stacks (glow on top), big rear wheels (1.35), engine hidden |

### Rendering budget
Every spec still merges into the same per-material meshes, so a kart stays at roughly the same ~20 draw calls. Extra dark/chrome pieces join the existing dark/chrome batches.

### Testing
- `src/kart/KartModel.test.ts` (jsdom, real three geometry): all eight build; required handles present (`wheels` ×4, `frontWheels` ×2, `exhausts` ≥1, `steeringWheel`, `driverHead`, materials); body-mesh vertex hashes are pairwise distinct; `dispose()` runs; mesh count per kart ≤ 26.
- Visual: `tools/kart-lineup.mjs` renders all eight from the real builder in an isolated scene (same trick as the promo capture) → `marketing/.audit/kart-lineup.png`.
- Existing 75 tests (Kart physics, net sessions build real Karts) must stay green.

### Out of scope
Card swatches on the character select stay 2D helmets; no new characters; no per-body physics.
