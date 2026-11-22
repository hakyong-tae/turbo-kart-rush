# Drift Dash GP — Architecture map (for iterating from here)

Read this before changing anything. `CONTRACT.md` is the frozen module contract (what may not
change); this file says **where things live and where to make a given kind of change**.

## 1. Layers

```
src/core        contract types, event bus, balance constants, team rules, i18n   (frozen: add only)
src/kart        Kart physics/visuals + assists (slipstream, magnet) + body specs + model
src/items       ItemManager (boxes, roulette, hazards, use) + itemVisuals (icons, meshes)
src/ai          AIDriver (racing line, hazards, item decisions)
src/track       Centerline LUT, Track builder, track defs (tracks/*.ts)
src/fx          ParticleSystem, SkidMarks, PostFX, RearView (mirror PiP)
src/gfx         quality tiers, resolution governor, environment probe, looks, noise
src/audio       AudioEngine (buses, voices), engine.ts (engine voice), music, sfx, synth
src/game        Game (orchestrator), RaceManager, FollowCamera, MenuBackdrop,
                TeamMarkers, OrientationGate, settingsStore
src/ui          MainMenu (lobby/select), HUD + hud/* widgets, Results, Pause, panels, Touch
src/net         online multiplayer (protocol, sessions, lobby, roster)
src/verse8      platform: embed handshake, gameserver wrapper, ads, shop, entitlements
src/styles      CSS split by concern, imported in order by styles/index.css
server.js       Verse8 server functions (records, entitlements, rooms)
```

Data flows one way: **input → Kart physics (RaceManager ticks karts) → state → renderers/HUD/audio
read state**. Cross-module notifications go through `core/events.ts` (typed bus). Nothing reads
DOM from physics; nothing writes physics from UI except through `Kart.setInput`.

## 2. "I want to change X" → go to

| Change | File(s) |
|---|---|
| A colour, radius or slant (design tokens) | `styles/01-base.css` `:root` — style rules: `docs/superpowers/specs/2026-11-17-ui-circuit-poster-design.md` |
| A shared UI part (panel, button, chip, segmented control, stat blocks, plate, checker, key cap, toast) | `styles/02-components.css` |
| An icon | `ui/icons.ts` (`icon(name)` → inline SVG; never an emoji or arrow glyph in a string) |
| The wordmark / the controls legend | `ui/logo.ts` / `ui/controlsLegend.ts` |
| A tuning number (speed, drift, items, slipstream matrix, start charge, retire time) | `core/balance.ts` (`?b.path=` URL override for live tests) |
| Slipstream rule / bonus | `kart/assists/slipstream.ts` (+ `BALANCE.slipstream`) |
| Magnet tow behaviour | `kart/assists/magnet.ts` |
| Kart handling, collisions, boosts, star | `kart/Kart.ts` |
| A racer's body shape / pipes / wheels | `kart/bodies.ts` (one `KartBodySpec` per id) |
| Stats / premium flag / names | `kart/roster.ts` |
| Add a racer | `kart/roster.ts` (append: order = plate number), `kart/bodies.ts` (`KartBodySpec` + `KART_BODIES`), `core/locales/*` (`char.<id>.tagline`), root `server.js` (`CHARACTERS`, and `PREMIUM` if locked). `serverLists.test.ts` fails until the server list matches |
| Add a circuit | `track/tracks/<name>.ts` + `track/tracks/index.ts`, a cup in `core/cups.ts`, `core/locales/*` (`track.<id>.desc`), root `server.js` (`TRACKS`). `tracks.test.ts` runs the validator on it; then `track-preview`, `track-soak` |
| Put a gimmick on a circuit (ramp, gap, ice / mud / boost strip, roller, tram, set-back walls) | the circuit's definition: `ramps` / `zones` / `movers` / `wallHalfWidthFactors` (types and units in `core/types.ts`; limits in `track/tracks/validate.ts`) |
| A new kind of gimmick | `track/features.ts` (numbers), `track/builders/features.ts` (meshes), `track/Track.ts` (`query`), `kart/Kart.ts` (what it does to a kart), `ai/AIDriver.ts` (what the AI does about it), `validate.ts` |
| Gimmick feel (ice grip, mud drag, trick boost, respawn run-up) | `BALANCE.track` in `core/balance.ts` |
| Add an item | `core/types.ts` (append to `ALL_ITEM_TYPES` — never reorder: net codes), `items/ItemManager.ts` (`requestUse` case), `items/itemVisuals.ts` (icon + mesh), `ai/AIDriver.ts` (`decideItemUse`), `audio/sfx.ts`, `core/locales/*`, `BALANCE.itemTable` |
| Team rules / points table | `core/teams.ts` |
| Race flow, retire rule, standings order | `game/RaceManager.ts` |
| HUD widget (mirror, standings, tally, charge, draft) | `ui/hud/<Widget>.ts`; layout in `styles/12-hud-widgets.css` / `14-layout-overrides.css` |
| HUD core (standings + minimap column, item slot, lap/timer, place plate, speedo, centre flashes) | `ui/HUD.ts`, `styles/07-hud.css`; touch arrangement in `14-layout-overrides.css` |
| Lobby / character / track select | `ui/MainMenu.ts`, `styles/04-menu.css`, `13-lobby-gate.css` |
| Card thumbnails | `ui/kartThumbnails.ts`, `ui/trackThumbnails.ts` |
| Results screen | `ui/ResultsScreen.ts`, `styles/06-pause-results.css` |
| Particles (flames, streaks, smoke) | `fx/ParticleSystem.ts` (`updateKartEmitters`) |
| Engine sound character | `audio/engine.ts` constants at the top (BASE_FREQ, PITCH_*, GEAR_TOPS) |
| Mobile / landscape gate / touch layout | `game/OrientationGate.ts`, `ui/TouchControls.ts`, `styles/09-touch-lang.css`, `11-phone.css` |
| Korean/English strings | `core/locales/en.ts` (keys are the source of truth) + `ko.ts` |
| Verse8: ads, shop, records, nickname | `src/verse8/*`, `server.js`, `docs/VERSE8-CONTEXT.md` |
| Coins: what a race pays, what a garage item costs | root `server.js` (the rule) **and** `core/economy.ts` (what the UI prints); `serverEconomy.test.ts` fails until they match. Ownership gate: `server.js _owns` + `core/cosmetics.ts sanitize(…, owned)` |
| Missions, check-in, levels | root `server.js` (`MISSIONS`, `missionsFor`, `_missionGain`, `claimAttendance`, `levelOf`) **and** the copies in `core/economy.ts`; wording in `ui/progression/text.ts` + `core/locales/*` (`mis.<id>`); counters in `game/RaceStatsTracker.ts`. A new mission = a row in both `MISSIONS` tables, a case in `_missionGain`, a string in both languages |
| Add an earn-only garage item | append to the catalogue in `core/cosmetics.ts` with `earned(...)`, its look in the renderer table (`kart/KartModel.ts`, `fx/ParticleSystem.ts`, `ui/badges.ts`), its price or -1 in **both** `COS_PRICES`, its rule in **both** `LEVEL_REWARDS` / `STREAK_REWARDS` / `SHOWCASE`, a name in both languages |
| Online protocol | `net/protocol.ts` (bump carefully — host and clients must match) |

## 3. Per-frame rules (memory)

- No allocations in `update()` paths: reuse module-level `THREE.Vector3` scratch, preallocated arrays
  (`StandingsBoard.sorted`, `MirrorPanel.rect`), numeric signatures instead of string keys.
- DOM writes only on change (`TextField.set` compares; class toggles guarded by a cached value).
- Particles: fixed pools, `take()` accumulators; never `new` inside emitters.
- Geometry/material caches live in `itemVisuals.ts` and per-kart in `KartModel.ts` (`dispose()` frees).
- Thumbnails are rendered once per session (`kartThumbnails.ts` / `trackThumbnails.ts`) and cached.
- Shader warm-up: `Game.warmShaders()` calls `renderer.compile()` and the loading loop asks each frame whether the
  programs are ready (`pollShaders`). Do not switch to three's `compileAsync`: its own timer outlives the race, and
  disposing a race mid-compile then throws from inside three.

## 4. Verification tools

| Tool | What |
|---|---|
| `npm test` | vitest (physics with real Karts on `net/FakeTrack`, server.js harness, teams, model) |
| `npm run typecheck && npm run build` | must stay clean; `grep -c '"@agent8/gameserver' dist/assets/*.js` → 0 |
| `node tools/mobile-audit.mjs [url] [--out dir] [--hud] [--phone-fonts] [--lang en]` | every screen at phone 844×390 (touch) and PC 1280×720, ko + en, + portrait gate → `marketing/.audit/` (`--hud`: race HUD on bright and dark circuits; `--phone-fonts`: without Impact, as a phone renders it — run this before judging the English UI) |
| `node tools/kart-lineup.mjs` | every kart in the roster rendered from the real builder |
| `python3 tools/track-from-plan.py <centreline.geojson> --length 1120 …` | control points from a real circuit's plan: scale to kart size, push apart what is too close, round what is too tight, fit a spline. Prints a `controlPoints` block with lap positions and writes a plan view. Needs numpy + Pillow; the centreline data is not kept in the repo |
| `node tools/track-preview.mjs [--track id]` | a circuit from above (PNG): walls, road, lap-position labels, void, ramps / gaps, zones, movers, item rows, pads → `marketing/.audit/preview/` |
| `node tools/track-profile.mjs [--track id]` | the lap as text, every 2 %: straight / turn radius and height — for deciding where a ramp or a tram can go |
| `node tools/track-soak.mjs [--track id\|all] [--difficulty hard] [--shots 0.31,0.52]` | a whole race with eight AI karts, fast: finishers, times, respawns, spins (and how many by movers), longest air. `--shots` instead puts the camera kart just before each lap position and takes a picture. Run it after touching a circuit, the kart physics or the AI |
| `node tools/restart-during-load-check.mjs [url]` | a race disposed while its shaders are still compiling must be harmless (exit 0 = pass) |
| `node tools/promo-capture.mjs` | store video + thumbnail |

Headless Chrome needs `--use-gl=angle --use-angle=metal --ignore-gpu-blocklist` for WebGL2.
Drive the game with `window.__turboKartRush.loop(t)` (rAF stub) instead of waiting on timers.
