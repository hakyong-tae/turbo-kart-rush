# Drift Kart: CrazyGames submission draft

Draft copy and settings for the CrazyGames developer portal. Nothing here has been submitted.
The build it describes is the `crazygames` target of this repository:

```bash
npm run build:crazygames
```

Output: `dist-crazygames/` (upload the folder's contents, `index.html` at the root).

The previous submission (Drift Dash GP, game ID 167958) missed Basic Launch at 8/15 on desktop and
7/15 on mobile. This one has to go in under the new name. Background and what changed:
`docs/superpowers/specs/2026-11-20-drift-kart-crazygames-relaunch.md`.

## Title

Drift Kart

## Description (English)

Drift, boost and battle your way to the front in an eight-kart arcade racer that starts the moment
it loads.

Drift Kart puts you on the grid straight away. Hold a drift through a corner and let go for a
mini-turbo, grab item boxes for shells, bananas, nitro and lightning, and slipstream the kart
ahead to sling past it on the straight. Races are three laps and under two minutes.

Every race you finish opens something: a new circuit, a livery, a trail, an exhaust flame. Coins
from races, daily missions and the daily check-in buy the rest of the garage and seven more
karts. Your progress is saved automatically on your device.

- 16 karts in three weight classes, each with its own handling
- 16 circuits: seaside, desert, ice, lava, neon city, stunt park and more
- Jump ramps and mid-air tricks, ice and mud, moving obstacles
- 5 Grand Prix cups, team races and a daily challenge
- A garage with liveries, underglow, trails, flames, wheel effects and engine sounds
- Keyboard, gamepad and touch controls

## Controls

Keyboard

- W or Up arrow: accelerate
- S or Down arrow: brake and reverse
- A / D or Left / Right arrow: steer
- Space or Shift: hop and drift (hold through a corner, release for a boost)
- E or Ctrl: use item (hold brake to throw it backwards)
- Q: look back
- Esc or P: pause
- M: mute

Gamepad

- Right trigger: accelerate. Left trigger: brake
- Left stick: steer
- A or RB: drift
- X or LB: use item
- Y: look back
- Start: pause

Touch

- The kart accelerates by itself (this can be turned off in Settings)
- Left stick: slide sideways to steer, pull down to brake
- DRIFT button: hold through a corner, release for a boost
- ITEM button: use item

## Category and tags

Category: Driving (Racing).

Suggested tags, six as on comparable kart games: Kart, Racing, Car, Drift, 3D, Mobile.

Alternates if a tag is not offered: Arcade, Cartoon, Action.

## Orientation and devices

- Orientation: Landscape. On a phone held upright the game shows a rotate prompt and pauses.
- Devices: desktop, tablet and mobile. Touch controls appear on touch devices.
- Fullscreen: supported by the portal frame; the game follows the frame's size.

## What this build does not contain

- No in-game purchases and no purchase UI.
- No rewarded-ad buttons. Basic Launch runs without ads; the three rewarded placements the Verse8
  edition has (double coins, mission swap, streak recovery) are hidden, and a check-in streak
  broken by one day can be carried on for free.
- No online multiplayer.
- No account: progress is kept in the browser's local storage.
- The CrazyGames SDK is not integrated yet. See "Before a Full Launch" below.

## Thumbnails and preview video (to be made)

Not part of this change. From 2026-11-23 the thumbnail click-through rate is a fourth scored
metric, so these deserve the same care as the build.

Check the exact sizes and limits in the developer portal before producing anything; the figures
below are the ones the portal asked for when Drift Dash GP was submitted and may have changed.

- Cover images: 16:9 (1920x1080), 2:3 (800x1200) and 1:1 (800x800). No borders, no store badges,
  the title readable at small sizes.
- Preview video: landscape, 15 to 20 seconds, gameplay only (no logos, no menus), under 50 MB.
- What to show: the kart mid-drift with sparks, an item hit, a jump with a trick. The first frame
  matters most: it is what autoplays in the grid.
- The wordmark is "DRIFT" in white italic with "KART" on a yellow number plate. `tools/marketing/`
  has the capture scripts used for the previous store kits; run them against the `crazygames`
  build so the name on screen is the new one.

## Checks made on the build

See the "verification" section at the end of the relaunch spec for what was run and what was not.

- Size: reported by `npm run build:crazygames` (limit 20 MB for the initial download).
- First screen: under 10 seconds on the test machine.
- The strings "VX", "WATCH AD" and "Drift Dash" do not appear in the built files or on screen.
- No request leaves the build's own host, from the first screen to the results screen and through
  every menu (`tools/crazygames-check.mjs` counts requests by host). The three fonts are in the
  build (`src/assets/fonts/`, SIL Open Font License; the licence texts are next to them).

## Before a Full Launch

These were out of scope for the Basic Launch build and are listed so they are not forgotten.

- CrazyGames SDK: loading and gameplay events (`gameplayStart` / `gameplayStop`), the happy-time
  call on a win, and data saving through the SDK's data module so progress follows the account.
- Rewarded and midgame ads through the SDK, which is when the three hidden buttons come back.
