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
- No account of its own: progress is kept in the browser's local storage and, through the
  CrazyGames SDK's data module, with the player's CrazyGames account (see "CrazyGames SDK").

## CrazyGames SDK

Integrated on 2026-11-22 (HTML5 SDK v3, an `async` script tag for
`https://sdk.crazygames.com/crazygames-sdk-v3.js` in the page's `<head>`, written by the build).
The rest is in `src/platform/crazygames.ts`; the Verse8 build carries none of it.

- **On the submission form, switch on the Data Module ("Progress Save")**. Without it the SDK's
  data calls fail (`dataModuleDisabled`); the game then keeps saving to local storage only, which
  works but does not follow the account.
- Events sent: `loadingStart` / `loadingStop` around start-up, `gameplayStart` when a race goes to
  its grid, when the player resumes from pause, and for each next race; `gameplayStop` at the
  results screen, on a pause the player asked for, and back in the menus. A pause caused by the
  window losing focus is not reported (the documentation says not to). `happytime` on a first
  place and on winning a cup.
- Data: the player's record (one JSON string under `tkr.local.user`, a few kB; the limit is 1 MB)
  is written to the data module on every change. At start the copy that is further along (races
  run, then coins and XP) is used, so neither side overwrites the other's progress.
- The portal's mute switch (`game.settings.muteAudio`) mutes the game over the player's own setting.
- Device type from the SDK (`mobile` / `tablet`) switches touch controls on; the SDK's locale
  picks Korean or English until the player chooses a language.
- No ad calls. Basic Launch has ads off; see "Before a Full Launch".
- If the SDK does not load, is slow, or reports itself disabled (a host that is not CrazyGames),
  the game plays the same without it. The first race waits for the account record for at most
  0.4 seconds; an SDK later than that still brings the account's record in.
- A build without the SDK, should QA object to it: `CG_SDK=0 npm run build:crazygames`.
- Checked with `tools/crazygames-sdk-check.mjs` (a stand-in SDK that records what it is told).
  **Not checked on crazygames.com itself**: the real SDK only runs fully inside the portal, so the
  QA tool there (developer portal preview) is the first real test.

## Covers and preview videos

From 2026-11-23 the thumbnail click-through rate is a fourth scored metric, so these deserve the
same care as the build.

Made on 2026-11-20 from the `crazygames` edition and kept in this folder. Sizes, how they were
checked against the portal's cover requirements, and the commands that remake them are in
[ASSETS.md](ASSETS.md); the scripts are `tools/marketing/crazygames-*`.

- `cover_landscape_1920x1080.png` (16:9), `cover_portrait_800x1200.png` (2:3) and
  `cover_square_800x800.png` (1:1): one piece of key art, a race moment re-shot from a low camera
  beside the kart, with the game's own DRIFT KART wordmark as the only text. Committed.
- `preview_landscape_1920x1080.mp4` and `preview_portrait_1080x1620.mp4`: 17.8 seconds, 30 fps,
  no audio, 36 MB each (the limit is 50 MB). Each opens on its cover for 0.4 seconds, then six
  circuits of real gameplay with the HUD hidden. Not committed (`.gitignore`, as with the other
  large master video): they are files in this folder only.

Nothing has been uploaded. Check the sizes and limits in the developer portal once more at upload
time; ASSETS.md records what the requirements page said on 2026-11-20.

## Checks made on the build

See the "verification" section at the end of the relaunch spec for what was run and what was not.

- Size: reported by `npm run build:crazygames` (limit 20 MB for the initial download).
- First screen: under 10 seconds on the test machine.
- The strings "VX", "WATCH AD" and "Drift Dash" do not appear in the built files or on screen.
- The only request that leaves the build's own host is the one for the CrazyGames SDK script,
  from the first screen to the results screen and through every menu (`tools/crazygames-check.mjs`
  counts requests by host; with `CG_SDK=0` there is none). The three fonts are in the
  build (`src/assets/fonts/`, SIL Open Font License; the licence texts are next to them).

## Before a Full Launch

These were out of scope for the Basic Launch build and are listed so they are not forgotten.

- Rewarded and midgame ads through the SDK (`SDK.ad.requestAd`), which is when the three hidden
  buttons come back. The events, data saving and settings are already in (see "CrazyGames SDK").
- SDK user module (sign-in prompt, account name on the kart) and invite links, if online play is
  ever brought to this edition.
