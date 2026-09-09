# Garage + progression design (depth and monetization)

**Problem.** The loop ends at the finish line: there is no reason to run a track twice, and the
only paid product sells "do not watch an ad" while ads already hand out the premium karts. The
paid path and the ad path compete for the same reward, so neither is worth taking.

**Goal.** Give casual players a reason to keep playing without any monthly live-ops, and give them
one purchase worth making. Everything here must be built once and then run unattended.

## Decisions (locked with the owner, 2026-09-09)

| Question | Decision |
|---|---|
| Audience | Casual, ONE Store / Verse8 |
| Live ops | Not possible monthly. No season pass, no rotating shop |
| Free customization | Colours only |
| Paid customization | Patterns and effects (underglow, trail, exhaust flame) |
| Premium kart power | Unchanged. Fennec / Bram / Rosa stay stronger |
| HUD colours | Self and allies blue, rivals red, in both solo and team races |
| Cosmetics storage | Server, so other players can see them |
| Product id | Free to change: nobody has purchased `remove-ads` yet |
| Probability items | None, ever. The ONE Store self-declaration says so |

## 1. Colour split: identity vs friend-or-foe

Two layers that must not be confused.

| Layer | Shows | Colour source |
|---|---|---|
| 3D kart | Who this racer is, and how they dressed their kart | Character colour, overridden by the player's paint |
| HUD identification | Friend or foe | Self and allies blue, everyone else red |

The HUD layer covers the minimap dots and the standings-board chips. Team chevrons above karts
stay a team-mode-only feature; solo races do not get them.

Because the HUD never uses the paint, players can paint a kart any colour without hurting online
readability.

**Knock-on:** team colours become relative to the viewer, so the absolute names have to go. The
results screen must read "우리 팀 / 상대 팀" instead of "레드 / 블루". Locale keys `team.red`,
`team.blue`, `results.teamWin`, `results.teamLose`, `results.firstRule` and the CSS classes
`team-red` / `team-blue` all change meaning from an absolute team to a relative side.
`core/teams.ts` keeps `red` / `blue` internally as the two sides; only presentation flips.

## 2. Cosmetics

```ts
type PatternId = 'none' | 'stripe' | 'twinStripe' | 'rally' | 'flame' | 'checker'
               | 'camo' | 'gradient' | 'split' | 'hazard' | 'circuit' | 'spark';
type TrailId   = 'none' | 'ribbon' | 'sparks' | 'smoke' | 'stars';
type FlameId   = 'none' | 'jet' | 'plasma' | 'ember';

interface KartCosmetics {
  // Free tier: colours. Absent = fall back to the character's own colours.
  body?: number; accent?: number; rim?: number; helmet?: number;
  // Paid tier: patterns and effects.
  pattern?: PatternId; patternColor?: number;
  underglow?: number;
  trail?: TrailId; trailColor?: number;
  flame?: FlameId;
}
```

Everything is a parameter on geometry we already build, so the content cost is close to zero.
Ship at least ten patterns so the store page does not look thin: the player counts entries, not
colour permutations.

The exhaust neon ring already burns on every kart, so its colour stays free. Only the new
effects are gated.

Free players see the locked rows in the garage, greyed out, with a three second live preview when
tapped. That preview is the sales pitch, not a paywall banner.

## 3. Storage and the three places other people see it

Server user state is the source of truth so the garage survives a device change.

| Channel | Carries | Why |
|---|---|---|
| User state key `cosmetics` | The player's own set, returned by `getMyEntitlements()` | Cross-device persistence |
| `RoomPlayer.cos` in room state | A compact copy | Live lobby and online race |
| Record row field `cos` in `tkr_times` | A snapshot at submit time | The records screen becomes a showcase |

The record-row channel matters more than it looks. During a race everyone sees the back of a kart
for a few seconds; on the records screen a player can tap the top time and look at that kart for
as long as they want.

Three showcase surfaces to build: the online lobby list, the winner on the results screen, and the
kart preview on a records row.

Keep the record snapshot small. `_allTimes()` reads up to a thousand rows on every leaderboard
query, so pack the cosmetics into one short string rather than a dozen fields if the payload grows.

## 4. Product

Retire `remove-ads` and register a new product in the creator console.

| Field | Value |
|---|---|
| id | `premium-garage` |
| Price | 100 VX |
| Type | Non-consumable, lifetime limit 1 |
| Grants | Full pattern and effect editor, all eight karts permanently, no ads, an online badge |

Server-side the entitlement flag `adsRemoved` is renamed to `premium`, which is safe because there
are no purchasers to migrate. `$onItemPurchased` keys off the new product id.

Ads keep granting premium-kart race passes exactly as today. The paid product's exclusive value is
the garage, and the garage must never be an ad reward, or the two paths start competing again.

**Docs to update on this change:** `docs/ONESTORE-FORM.md` mentions `remove-ads` in six places and
`docs/VERSE8-CONTEXT.md` in one.

## 5. Free depth, because a garage only sells to someone who is playing

Both of these are built once and need no operation.

**Grand Prix cups.** Three tracks per cup, cumulative points using the existing
`POINTS_BY_PLACE` table from `core/teams.ts`, finish top three to unlock the next cup. Rookie cup
is Sunny / Coral / Dune, Pro cup is Frostbite / Neon / Magma, and a Championship over all six
unlocks after both. This is the structure casual kart racers ship, and the scoring already exists.

**Daily seeded challenge.** The date seeds a track, a condition and a kart-class restriction. One
attempt per day, its own leaderboard. No content has to be authored. Note that `submitTime`
validates `trackId` against a fixed set, so daily runs need either a separate collection or a
relaxed validation branch.

## 6. Order of work

1. Colour layer and relative team labels. Small, and everything else assumes it
2. Grand Prix cups
3. Daily seeded challenge
4. Garage with the free colour tier, stored on the server and mirrored into room state
5. Paid patterns and effects, the product swap, and the three showcase surfaces

Depth ships before the store: a player who has not put hours into a kart does not want to dress it.

## Out of scope

Gacha or any probability item, paid track packs, which would split online matchmaking, season
passes, and a ranked ladder. Ghost replays and time-trial mode were considered and deferred:
they serve a core audience, and this build targets casual players.

## Testing

Unit tests for cup scoring and unlock gating, cosmetics serialisation round-trip, and daily seed
determinism across dates. A garage screenshot tool in the style of `tools/kart-lineup.mjs` to
eyeball every pattern and effect on every body.
