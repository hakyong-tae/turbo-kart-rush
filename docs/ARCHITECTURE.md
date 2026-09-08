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
src/fx          ParticleSystem, PostFX, RearView (mirror PiP)
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
| A tuning number (speed, drift, items, slipstream matrix, start charge, retire time) | `core/balance.ts` (`?b.path=` URL override for live tests) |
| Slipstream rule / bonus | `kart/assists/slipstream.ts` (+ `BALANCE.slipstream`) |
| Magnet tow behaviour | `kart/assists/magnet.ts` |
| Kart handling, collisions, boosts, star | `kart/Kart.ts` |
| A racer's body shape / pipes / wheels | `kart/bodies.ts` (one `KartBodySpec` per id) |
| Stats / premium flag / names | `kart/roster.ts` |
| Add an item | `core/types.ts` (append to `ALL_ITEM_TYPES` — never reorder: net codes), `items/ItemManager.ts` (`requestUse` case), `items/itemVisuals.ts` (icon + mesh), `ai/AIDriver.ts` (`decideItemUse`), `audio/sfx.ts`, `core/locales/*`, `BALANCE.itemTable` |
| Team rules / points table | `core/teams.ts` |
| Race flow, retire rule, standings order | `game/RaceManager.ts` |
| HUD widget (mirror, standings, tally, charge, draft) | `ui/hud/<Widget>.ts`; layout in `styles/12-hud-widgets.css` / `14-layout-overrides.css` |
| HUD core (item slot, lap/timer, place, speedo, centre flashes) | `ui/HUD.ts`, `styles/07-hud.css` |
| Lobby / character / track select | `ui/MainMenu.ts`, `styles/04-menu.css`, `13-lobby-gate.css` |
| Card thumbnails | `ui/kartThumbnails.ts`, `ui/trackThumbnails.ts` |
| Results screen | `ui/ResultsScreen.ts`, `styles/06-pause-results.css` |
| Particles (flames, streaks, smoke) | `fx/ParticleSystem.ts` (`updateKartEmitters`) |
| Engine sound character | `audio/engine.ts` constants at the top (BASE_FREQ, PITCH_*, GEAR_TOPS) |
| Mobile / landscape gate / touch layout | `game/OrientationGate.ts`, `ui/TouchControls.ts`, `styles/09-touch-lang.css`, `11-phone.css` |
| Korean/English strings | `core/locales/en.ts` (keys are the source of truth) + `ko.ts` |
| Verse8: ads, shop, records, nickname | `src/verse8/*`, `server.js`, `docs/VERSE8-CONTEXT.md` |
| Online protocol | `net/protocol.ts` (bump carefully — host and clients must match) |

## 3. Per-frame rules (memory)

- No allocations in `update()` paths: reuse module-level `THREE.Vector3` scratch, preallocated arrays
  (`StandingsBoard.sorted`, `MirrorPanel.rect`), numeric signatures instead of string keys.
- DOM writes only on change (`TextField.set` compares; class toggles guarded by a cached value).
- Particles: fixed pools, `take()` accumulators; never `new` inside emitters.
- Geometry/material caches live in `itemVisuals.ts` and per-kart in `KartModel.ts` (`dispose()` frees).
- Thumbnails are rendered once per session (`kartThumbnails.ts` / `trackThumbnails.ts`) and cached.

## 4. Verification tools

| Tool | What |
|---|---|
| `npm test` | vitest (physics with real Karts on `net/FakeTrack`, server.js harness, teams, model) |
| `npm run typecheck && npm run build` | must stay clean; `grep -c '"@agent8/gameserver' dist/assets/*.js` → 0 |
| `node tools/mobile-audit.mjs` | landscape phone screens + portrait gate → `marketing/.audit/` |
| `node tools/kart-lineup.mjs` | all eight karts rendered from the real builder |
| `node tools/promo-capture.mjs` | store video + thumbnail |

Headless Chrome needs `--use-gl=angle --use-angle=metal --ignore-gpu-blocklist` for WebGL2.
Drive the game with `window.__turboKartRush.loop(t)` (rAF stub) instead of waiting on timers.
