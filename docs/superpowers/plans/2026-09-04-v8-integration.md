# Turbo Kart Rush Verse8 연동(스펙 A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verse8 배포 가능 상태 — iframe 핸드셰이크·agent8 서버함수·트랙별 리더보드·프리미엄 카트(리워드 광고 3회권 / VXShop 100 VX, 전부 서버 저장)·설정 화면(닉네임/언어/음소거).

**Architecture:** 모든 Verse8 코드는 신규 워크스트림 F = `src/verse8/**` + 루트 `server.js`. 기존 모듈은 `CharacterDef.premium` 플래그 1개 추가 외 무수정 원칙. 서버 유저스테이트 `{adsRemoved, premiumRaces, nickname, grants:{day,count}}`가 유일한 진실 원천, 클라 `entitlements.ts`는 캐시+구독. 호스트 밖(톱프레임)은 같은 규칙의 메모리 mock으로 전 경로 동작.

**Tech Stack:** TS 7 strict / Vite 8 / vitest 3 / `@agent8/gameserver ^1.10.2`, `@verse8/ads ^0.5.0`, `@verse8/platform ^2.1.0`. 참조 구현: `block-blaster-v8/src/verse8/*.ts`, `block-blaster-v8/server.js`. 스펙: `docs/superpowers/specs/2026-09-04-v8-integration-design.md`.

**공통:**
```bash
export PATH="$HOME/.nvm/versions/node/v23.11.0/bin:$PATH"
cd /Users/hytae/Downloads/turbo-kart-rush   # 브랜치 v8-integration
```
브라우저 검증은 프리뷰 `turbo-kart-rush`(:5178). 패널이 숨겨져 있으면 `window.__turboKartRush.loop(now)`를 동기 펌핑(`await sleep` 금지).

---

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `package.json` | deps 3종 | 1.1 |
| `src/verse8/embed.ts` | 호스트 감지 + GAME_SIZE 핸드셰이크 | 1.2 |
| `src/verse8/server.ts` | agent8 접속 래퍼 + 게임 원격호출 타입 | 1.3 |
| `src/verse8/nickname.ts` | 닉네임 정규화(클라/서버 공용 규칙) | 2.1 |
| `server.js` | 서버 함수 7개 | 2.2 |
| `src/verse8/server.test.ts` | server.js 하네스 테스트 | 2.2 |
| `src/verse8/ads.ts`, `shop.ts` | 리워드 광고 / VXShop | 3.1 |
| `src/verse8/entitlements.ts` (+test) | 서버 권위 캐시 + mock 스토어 + `canRace` | 3.2 |
| `src/core/types.ts`, `src/kart/roster.ts` | `premium?: true` | 3.3 |
| `src/ui/LockSheet.ts`, `src/ui/MainMenu.ts` | 잠금 배지·시트 | 3.4 |
| `src/game/Game.ts` | startRace 소비, race:finish 제출, 패널 배선 | 3.5, 4.2 |
| `src/ui/LeaderboardPanel.ts` | 랭킹 패널 | 4.1 |
| `src/ui/SettingsPanel.ts` | 닉네임/언어/음소거 | 5.1 |
| `src/core/locales/{en,ko}.ts` | 키 ~40개 | 3.4, 4.1, 5.1 |
| `src/main.ts` | 부트 순서 | 1.4 |
| `docs/VERSE8-CONTEXT.md`, `CONTRACT.md`, `NOTES.md` | 문서 | 6.1 |

---

# Part 1 — 플랫폼 기반

### Task 1.1: 의존성

- [ ] **Step 1:**
```bash
npm i @agent8/gameserver@^1.10.2 @verse8/ads@^0.5.0 @verse8/platform@^2.1.0
```
Expected: 설치 성공. (느리면 백그라운드 실행, 다음 Task 파일 작성 병행.)

- [ ] **Step 2:** `npm run typecheck` 클린 유지 확인 후 Commit:
```bash
git add package.json package-lock.json && git commit -m "chore(v8): add agent8 gameserver, verse8 ads/platform SDKs"
```

### Task 1.2: `src/verse8/embed.ts`

- [ ] **Step 1: 작성**
```ts
/**
 * Verse8 iframe helpers. The shell needs a size handshake or the iframe can get a zero
 * viewport on some hosts. Two message shapes have been seen in the wild (GAME_SIZE from
 * block-blaster, GAME_SIZE_RESPONSE + REQUEST_GAME_SIZE from server-survival) — send both.
 */
export function inVerse8Host(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window;
  } catch {
    return true; // cross-origin parent access threw → we ARE embedded
  }
}

function postSize(): void {
  try {
    const width = Math.max(window.innerWidth, document.documentElement.scrollWidth);
    const height = Math.max(window.innerHeight, document.documentElement.scrollHeight);
    window.parent.postMessage({ type: 'GAME_SIZE', width, height }, '*');
    window.parent.postMessage({ type: 'GAME_SIZE_RESPONSE', width, height }, '*');
  } catch {
    /* not embedded */
  }
}

export function initEmbedHandshake(): void {
  if (!inVerse8Host()) return;
  postSize();
  window.addEventListener('load', postSize);
  window.addEventListener('resize', postSize);
  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'REQUEST_GAME_SIZE') postSize();
  });
}
```
- [ ] **Step 2:** Commit `feat(v8): iframe host detection + GAME_SIZE handshake`.

### Task 1.3: `src/verse8/server.ts` (접속 래퍼 + 원격 호출)

- [ ] **Step 1: 작성** — Blast Block `server.ts`의 접속부(`getGameServer`, `connectViaStore`, `ensureConnected`, `isConnected`, `callServer`)를 **그대로** 복사한 뒤, 게임 전용 호출부를 아래로 교체:
```ts
// ── Game-specific calls ──────────────────────────────────────────────────────

export interface TimeRow {
  name: string;
  timeMs: number;
  characterId: string;
  difficulty: string;
  account?: string;
}
export interface TopTimes {
  rows: TimeRow[];
  myRank: number | null;
  myBest: number | null;
}
export interface SubmitResult {
  updated: boolean;
  rank: number | null;
  timeMs: number;
}
export interface Entitlements {
  adsRemoved: boolean;
  premiumRaces: number;
  nickname: string;
}

export function submitTime(
  trackId: string,
  timeMs: number,
  characterId: string,
  difficulty: string,
): Promise<SubmitResult | null> {
  return callServer<SubmitResult | null>('submitTime', [trackId, Math.floor(timeMs), characterId, difficulty], null);
}
export function fetchTopTimes(trackId: string, limit = 20): Promise<TopTimes | null> {
  return callServer<TopTimes | null>('getTopTimes', [trackId, limit], null);
}
export function fetchEntitlements(): Promise<Entitlements | null> {
  return callServer<Entitlements | null>('getMyEntitlements', [], null);
}
export function serverGrantPremiumRaces(): Promise<{ granted: boolean; premiumRaces: number } | null> {
  return callServer('grantPremiumRaces', [], null);
}
export function serverConsumePremiumRace(characterId: string): Promise<{ ok: boolean; premiumRaces: number } | null> {
  return callServer('consumePremiumRace', [characterId], null);
}
export function serverSetNickname(name: string): Promise<{ nickname: string } | null> {
  return callServer('setNickname', [name], null);
}
```
- [ ] **Step 2:** `npm run typecheck` 클린. Commit `feat(v8): agent8 connection wrapper + typed remote calls`.

### Task 1.4: `main.ts` 부트 순서

- [ ] **Step 1:** import 추가 `import { initEmbedHandshake } from './verse8/embed';` — `boot()` 첫 줄(`const app = ...` 앞)에 `initEmbedHandshake();`.
(shop/entitlements 초기화는 Task 3.2에서 추가.)
- [ ] **Step 2:** typecheck, Commit `feat(v8): run embed handshake at boot`.

---

# Part 2 — 서버 함수 + 하네스 테스트

### Task 2.1: `src/verse8/nickname.ts`

- [ ] **Step 1: 테스트** `src/verse8/nickname.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { defaultNickname, normalizeNickname } from './nickname';

describe('nickname', () => {
  it('trims, caps at 12, keeps letters/digits/hangul/space', () => {
    expect(normalizeNickname('  Kart Kid  ')).toBe('Kart Kid');
    expect(normalizeNickname('가나다라마바사아자차카타파하')).toBe('가나다라마바사아자차카타');
    expect(normalizeNickname('a<b>c!!')).toBe('abc');
  });
  it('returns empty for nothing usable', () => {
    expect(normalizeNickname('!!!')).toBe('');
    expect(normalizeNickname(undefined)).toBe('');
  });
  it('blocks a few slurs', () => {
    expect(normalizeNickname('nigger')).toBe('');
  });
  it('default from account tail', () => {
    expect(defaultNickname('0xabcdef1234')).toBe('RACER-1234');
    expect(defaultNickname('')).toBe('RACER');
  });
});
```
- [ ] **Step 2: 구현** (server.js가 같은 규칙을 복제하므로 헤더 주석에 명시)
```ts
/**
 * Nickname rules shared by client and server. server.js duplicates this logic verbatim
 * (no build step there) — keep the two in sync.
 */
const BLOCKED = ['nigger', 'faggot', 'retard', '씨발', '시발', '병신', '좆'];

export function normalizeNickname(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .normalize('NFC')
    .replace(/[^A-Za-z0-9가-힣 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12)
    .trim();
  const low = cleaned.toLowerCase();
  if (BLOCKED.some((w) => low.includes(w))) return '';
  return cleaned;
}

export function defaultNickname(account: string): string {
  const tail = String(account || '').replace(/^0x/i, '').slice(-4).toUpperCase();
  return tail ? `RACER-${tail}` : 'RACER';
}
```
- [ ] **Step 3:** `npm test -- nickname` 4 passed. Commit `feat(v8): shared nickname normalisation`.

### Task 2.2: `server.js` + 하네스 테스트

- [ ] **Step 1: 하네스 테스트 작성** `src/verse8/server.test.ts`
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';

// server.js is a bare `class Server` (platform convention: no exports). Evaluate it with
// fake $global/$sender injected and grab the class from the end of the source.
function loadServer(global: any, sender: any) {
  const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  const factory = new Function('$global', '$sender', `${src}\nreturn Server;`);
  const Server = factory(global, sender);
  return new Server();
}

function fakeGlobal() {
  const collections: Record<string, any[]> = {};
  const users: Record<string, any> = {};
  let nextId = 1;
  const match = (item: any, filters: any[] = []) =>
    filters.every((f) => {
      const v = item[f.field];
      switch (f.operator) {
        case '==': return v === f.value;
        case '<': return v < f.value;
        case '>': return v > f.value;
        default: return true;
      }
    });
  return {
    collections,
    users,
    async getCollectionItems(id: string, q: any = {}) {
      let rows = (collections[id] ?? []).filter((r) => match(r, q.filters));
      if (q.orderBy) for (const o of [...q.orderBy].reverse()) rows.sort((a, b) => (a[o.field] - b[o.field]) * (o.direction === 'desc' ? -1 : 1));
      if (q.limit) rows = rows.slice(0, q.limit);
      return rows;
    },
    async countCollectionItems(id: string, q: any = {}) {
      return (collections[id] ?? []).filter((r) => match(r, q.filters)).length;
    },
    async addCollectionItem(id: string, data: any) {
      const row = { ...data, __id: String(nextId++) };
      (collections[id] ??= []).push(row);
      return row;
    },
    async updateCollectionItem(id: string, rowId: string, data: any) {
      const row = (collections[id] ?? []).find((r) => r.__id === rowId);
      if (row) Object.assign(row, data);
      return row;
    },
    async deleteCollectionItem(id: string, rowId: string) {
      collections[id] = (collections[id] ?? []).filter((r) => r.__id !== rowId);
    },
    async getUserState(account: string) {
      return users[account] ?? null;
    },
    async updateUserState(account: string, patch: any) {
      users[account] = { ...(users[account] ?? {}), ...patch };
      return users[account];
    },
  };
}

describe('server.js', () => {
  let g: ReturnType<typeof fakeGlobal>;
  let me: any;
  beforeEach(() => {
    g = fakeGlobal();
    me = loadServer(g, { account: '0xAAAA1111' });
  });

  it('submitTime keeps one best per account/track and uses the stored nickname', async () => {
    await g.updateUserState('0xAAAA1111', { nickname: 'Kid' });
    const a = await me.submitTime('sunny_circuit', 95000, 'zippy', 'normal');
    expect(a.updated).toBe(true);
    expect(a.rank).toBe(1);
    const slower = await me.submitTime('sunny_circuit', 99000, 'zippy', 'normal');
    expect(slower.updated).toBe(false);
    const faster = await me.submitTime('sunny_circuit', 90000, 'rosa', 'hard');
    expect(faster.updated).toBe(true);
    expect(g.collections.tkr_times).toHaveLength(1);
    expect(g.collections.tkr_times[0]).toMatchObject({ name: 'Kid', timeMs: 90000, characterId: 'rosa' });
  });

  it('submitTime rejects bad input', async () => {
    await expect(me.submitTime('nope', 90000, 'zippy', 'normal')).rejects.toThrow();
    await expect(me.submitTime('sunny_circuit', 1000, 'zippy', 'normal')).rejects.toThrow();
    await expect(me.submitTime('sunny_circuit', 90000, 'mario', 'normal')).rejects.toThrow();
  });

  it('default nickname when none set', async () => {
    await me.submitTime('dune_drift', 100000, 'max', 'easy');
    expect(g.collections.tkr_times[0].name).toBe('RACER-1111');
  });

  it('getTopTimes ranks ascending and reports my rank', async () => {
    const other = loadServer(g, { account: '0xBBBB2222' });
    await other.submitTime('sunny_circuit', 80000, 'bram', 'hard');
    await me.submitTime('sunny_circuit', 90000, 'zippy', 'normal');
    const top = await me.getTopTimes('sunny_circuit', 10);
    expect(top.rows.map((r: any) => r.timeMs)).toEqual([80000, 90000]);
    expect(top.myRank).toBe(2);
    expect(top.myBest).toBe(90000);
  });

  it('setNickname normalises, stores, and renames my rows', async () => {
    await me.submitTime('sunny_circuit', 90000, 'zippy', 'normal');
    const r = await me.setNickname('  Speed<>Demon  ');
    expect(r.nickname).toBe('SpeedDemon');
    expect(g.users['0xAAAA1111'].nickname).toBe('SpeedDemon');
    expect(g.collections.tkr_times[0].name).toBe('SpeedDemon');
    await expect(me.setNickname('!!!')).rejects.toThrow();
  });

  it('entitlements: grant +3 (cap 9, 10/day), consume, purchase', async () => {
    expect(await me.getMyEntitlements()).toEqual({ adsRemoved: false, premiumRaces: 0, nickname: '' });
    for (let i = 0; i < 3; i++) await me.grantPremiumRaces();
    expect((await me.getMyEntitlements()).premiumRaces).toBe(9);
    expect((await me.consumePremiumRace('zippy')).ok).toBe(true); // non-premium: free
    expect((await me.getMyEntitlements()).premiumRaces).toBe(9);
    expect(await me.consumePremiumRace('rosa')).toEqual({ ok: true, premiumRaces: 8 });
    for (let i = 0; i < 7; i++) await me.grantPremiumRaces();
    expect((await me.grantPremiumRaces()).granted).toBe(false); // 11th grant today
    await me.$onItemPurchased({ account: '0xAAAA1111', productId: 'remove-ads', purchaseId: 'p', quantity: 1 });
    expect((await me.getMyEntitlements()).adsRemoved).toBe(true);
    const c = await me.consumePremiumRace('rosa');
    expect(c.ok).toBe(true);
    expect((await me.getMyEntitlements()).premiumRaces).toBe(8); // not consumed once purchased
  });

  it('consumePremiumRace refuses with no races', async () => {
    expect((await me.consumePremiumRace('bram')).ok).toBe(false);
  });
});
```
- [ ] **Step 2: 실패 확인** `npm test -- server.test` → `ENOENT server.js`.
- [ ] **Step 3: `server.js` 작성** (루트)
```js
// Agent8 GameServer functions (Turbo Kart Rush).
//
// Root server.js is the platform's convention: a bare `class Server` — not exported —
// whose methods become remoteFunction endpoints, with $global and $sender injected.
// Plain JS, no build step: this file IS the deployment.
//
// Endpoints:
//   submitTime(trackId, timeMs, characterId, difficulty) — best per (account, track)
//   getTopTimes(trackId, limit)                          — top N + caller rank/best
//   getMyEntitlements()                                  — { adsRemoved, premiumRaces, nickname }
//   grantPremiumRaces()                                  — +3 (cap 9, 10 grants/day) after a rewarded ad
//   consumePremiumRace(characterId)                      — -1 when starting a race with a premium kart
//   setNickname(name)                                    — stored on user state, renames my rows
//   $onItemPurchased({productId})                        — VXShop "remove-ads" → adsRemoved
//
// All purchase / ticket state lives in $global user state (server-authoritative).

const RANKING_ID = 'tkr_times';
const TRACKS = new Set(['sunny_circuit', 'coral_coast', 'dune_drift', 'frostbite_falls', 'neon_nexus', 'magma_ridge']);
const CHARACTERS = new Set(['zippy', 'pixel', 'fennec', 'max', 'juno', 'kai', 'bram', 'rosa']);
const PREMIUM = new Set(['fennec', 'bram', 'rosa']);
const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);
const MIN_TIME_MS = 30000;
const MAX_TIME_MS = 1200000;
const GRANT_SIZE = 3;
const GRANT_CAP = 9;
const GRANTS_PER_DAY = 10;

// Mirror of src/verse8/nickname.ts — keep in sync.
const BLOCKED = ['nigger', 'faggot', 'retard', '씨발', '시발', '병신', '좆'];
function normalizeNickname(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .normalize('NFC')
    .replace(/[^A-Za-z0-9가-힣 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12)
    .trim();
  const low = cleaned.toLowerCase();
  if (BLOCKED.some((w) => low.includes(w))) return '';
  return cleaned;
}
function defaultNickname(account) {
  const tail = String(account || '').replace(/^0x/i, '').slice(-4).toUpperCase();
  return tail ? `RACER-${tail}` : 'RACER';
}
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

class Server {
  async ping() {
    return 'pong';
  }

  async _state() {
    const s = await $global.getUserState($sender.account);
    return s || {};
  }

  async _nickname(state) {
    const n = normalizeNickname(state && state.nickname);
    return n || defaultNickname($sender.account);
  }

  async submitTime(trackId, timeMs, characterId, difficulty) {
    if (!TRACKS.has(trackId)) throw new Error('Unknown track.');
    if (!CHARACTERS.has(characterId)) throw new Error('Unknown character.');
    if (!DIFFICULTIES.has(difficulty)) throw new Error('Unknown difficulty.');
    if (typeof timeMs !== 'number' || !isFinite(timeMs) || timeMs < MIN_TIME_MS || timeMs > MAX_TIME_MS) {
      throw new Error('Time out of range.');
    }
    const state = await this._state();
    const name = await this._nickname(state);
    const candidate = {
      account: $sender.account,
      name,
      trackId,
      timeMs: Math.floor(timeMs),
      characterId,
      difficulty,
      createdAt: Date.now(),
    };
    const mine = await $global.getCollectionItems(RANKING_ID, {
      filters: [
        { field: 'account', operator: '==', value: $sender.account },
        { field: 'trackId', operator: '==', value: trackId },
      ],
    });
    const best = mine.length > 0 ? mine.slice().sort((a, b) => a.timeMs - b.timeMs)[0] : null;
    if (best && candidate.timeMs >= best.timeMs) {
      return { updated: false, rank: await this._rankOf(trackId, best.timeMs), timeMs: best.timeMs };
    }
    for (const row of mine) await $global.deleteCollectionItem(RANKING_ID, row.__id);
    await $global.addCollectionItem(RANKING_ID, candidate);
    return { updated: true, rank: await this._rankOf(trackId, candidate.timeMs), timeMs: candidate.timeMs };
  }

  async _rankOf(trackId, timeMs) {
    const faster = await $global.countCollectionItems(RANKING_ID, {
      filters: [
        { field: 'trackId', operator: '==', value: trackId },
        { field: 'timeMs', operator: '<', value: timeMs },
      ],
    });
    return faster + 1;
  }

  async getTopTimes(trackId, limit) {
    if (!TRACKS.has(trackId)) throw new Error('Unknown track.');
    const n = typeof limit === 'number' && limit > 0 ? Math.min(100, Math.floor(limit)) : 20;
    const rows = await $global.getCollectionItems(RANKING_ID, {
      filters: [{ field: 'trackId', operator: '==', value: trackId }],
      orderBy: [{ field: 'timeMs', direction: 'asc' }],
      limit: n,
    });
    let myRank = null;
    let myBest = null;
    const mine = await $global.getCollectionItems(RANKING_ID, {
      filters: [
        { field: 'account', operator: '==', value: $sender.account },
        { field: 'trackId', operator: '==', value: trackId },
      ],
    });
    if (mine.length > 0) {
      const best = mine.slice().sort((a, b) => a.timeMs - b.timeMs)[0];
      myBest = best.timeMs;
      myRank = await this._rankOf(trackId, best.timeMs);
    }
    return {
      rows: rows.map((r) => ({
        name: r.name,
        timeMs: r.timeMs,
        characterId: r.characterId,
        difficulty: r.difficulty,
        account: r.account,
      })),
      myRank,
      myBest,
    };
  }

  async setNickname(name) {
    const nickname = normalizeNickname(name);
    if (!nickname) throw new Error('Invalid nickname.');
    await $global.updateUserState($sender.account, { nickname });
    const mine = await $global.getCollectionItems(RANKING_ID, {
      filters: [{ field: 'account', operator: '==', value: $sender.account }],
    });
    for (const row of mine) await $global.updateCollectionItem(RANKING_ID, row.__id, { name: nickname });
    return { nickname };
  }

  async getMyEntitlements() {
    const s = await this._state();
    return {
      adsRemoved: !!s.adsRemoved,
      premiumRaces: Number.isFinite(s.premiumRaces) ? Math.max(0, Math.floor(s.premiumRaces)) : 0,
      nickname: normalizeNickname(s.nickname),
    };
  }

  /** Called by the client only after @verse8/ads resolved { status: 'rewarded' } (host-verified). */
  async grantPremiumRaces() {
    const s = await this._state();
    const day = todayKey();
    const grants = s.grants && s.grants.day === day ? s.grants.count : 0;
    const current = Number.isFinite(s.premiumRaces) ? s.premiumRaces : 0;
    if (grants >= GRANTS_PER_DAY) return { granted: false, premiumRaces: current };
    const premiumRaces = Math.min(GRANT_CAP, current + GRANT_SIZE);
    await $global.updateUserState($sender.account, { premiumRaces, grants: { day, count: grants + 1 } });
    return { granted: true, premiumRaces };
  }

  async consumePremiumRace(characterId) {
    const s = await this._state();
    const current = Number.isFinite(s.premiumRaces) ? s.premiumRaces : 0;
    if (!PREMIUM.has(characterId) || s.adsRemoved) return { ok: true, premiumRaces: current };
    if (current <= 0) return { ok: false, premiumRaces: 0 };
    await $global.updateUserState($sender.account, { premiumRaces: current - 1 });
    return { ok: true, premiumRaces: current - 1 };
  }

  /** VXShop hook. "remove-ads" (100 VX, non-consumable) unlocks every kart permanently. */
  async $onItemPurchased({ account, purchaseId, productId, quantity }) {
    if (productId === 'remove-ads') {
      await $global.updateUserState(account, { adsRemoved: true });
    }
    return { success: true };
  }
}
```
- [ ] **Step 4:** `npm test -- server.test` → 7 passed. (`new Function`은 tsconfig 영향 없음; vitest node 환경.)
- [ ] **Step 5:** Commit `feat(v8): server.js — times leaderboard, nickname, premium race tickets, VXShop hook (+harness tests)`.

---

# Part 3 — 프리미엄 카트

### Task 3.1: `ads.ts`, `shop.ts`

- [ ] **Step 1:** `block-blaster-v8/src/verse8/ads.ts`를 복사해 수정: placement 상수를 `export const PLACEMENT_REWARDED_PREMIUM = 'rewarded_premium_kart';`만 남기고, `t(...)` import를 `../core/i18n`으로, mock 문구는 `t('v8.mockAd.title')`, `t('v8.mockAd.reward')`, `t('v8.mockAd.dismiss')`. `document.getElementById('overlay')!` → `document.body`.
- [ ] **Step 2:** `shop.ts` 복사 후 수정: `adsRemoved` 캐시/리스너 제거(→ entitlements.ts가 담당), `onClose`에서 `purchased`면 `refreshEntitlements()`(entitlements.ts) 호출, mock 구매는 `mockStore.purchase()`(Task 3.2) 호출. 문구 `t('v8.shop.*')`. `PRICE_LABEL='100 VX'`, `PRODUCT_REMOVE_ADS='remove-ads'`.
- [ ] **Step 3:** typecheck. Commit `feat(v8): rewarded ads + VXShop wrappers (mock outside host)`.

### Task 3.2: `entitlements.ts` (+ 테스트)

- [ ] **Step 1: 테스트** `src/verse8/entitlements.test.ts`
```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { canRace, getEntitlements, mockStore, _resetForTests, applyEntitlements } from './entitlements';

describe('entitlements (mock store rules)', () => {
  beforeEach(() => _resetForTests());
  it('non-premium karts always race, premium needs tickets', () => {
    expect(canRace('zippy')).toBe(true);
    expect(canRace('rosa')).toBe(false);
  });
  it('grant adds 3 capped at 9; consume decrements only premium', () => {
    mockStore.grant(); mockStore.grant(); mockStore.grant(); mockStore.grant();
    expect(getEntitlements().premiumRaces).toBe(9);
    expect(mockStore.consume('zippy').ok).toBe(true);
    expect(getEntitlements().premiumRaces).toBe(9);
    expect(mockStore.consume('bram')).toEqual({ ok: true, premiumRaces: 8 });
  });
  it('purchase unlocks everything without consuming', () => {
    mockStore.purchase();
    expect(canRace('fennec')).toBe(true);
    expect(mockStore.consume('fennec').ok).toBe(true);
    expect(getEntitlements().premiumRaces).toBe(0);
  });
  it('applyEntitlements notifies subscribers', () => {
    let seen = 0;
    const off = (await import('./entitlements')).onEntitlementsChange(() => seen++);
    applyEntitlements({ adsRemoved: true, premiumRaces: 2, nickname: 'X' });
    expect(seen).toBe(1);
    off();
  });
});
```
(마지막 테스트의 `await import`은 top-level이 아니므로 `it(async () => ...)`로 감싼다.)
- [ ] **Step 2: 구현** `src/verse8/entitlements.ts`
```ts
/**
 * Server-authoritative entitlements cache: { adsRemoved, premiumRaces, nickname }.
 * The gameserver user state is the single source of truth; this module only caches it
 * and exposes subscriptions. Outside a Verse8 host (local dev) an in-memory mock store
 * applies the same rules so every UI path can be exercised.
 */
import { CHARACTERS } from '../kart/roster';
import { inVerse8Host } from './embed';
import {
  fetchEntitlements,
  isConnected,
  serverConsumePremiumRace,
  serverGrantPremiumRaces,
  serverSetNickname,
  type Entitlements,
} from './server';

const PREMIUM_IDS = new Set(CHARACTERS.filter((c) => c.premium).map((c) => c.id));
const GRANT_SIZE = 3;
const GRANT_CAP = 9;

let state: Entitlements & { loaded: boolean } = { adsRemoved: false, premiumRaces: 0, nickname: '', loaded: false };
const listeners = new Set<(e: Entitlements) => void>();

export function isPremium(characterId: string): boolean {
  return PREMIUM_IDS.has(characterId);
}
export function getEntitlements(): Entitlements & { loaded: boolean } {
  return state;
}
export function onEntitlementsChange(fn: (e: Entitlements) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function applyEntitlements(next: Entitlements): void {
  state = { ...next, loaded: true };
  for (const fn of listeners) fn(state);
}
export function canRace(characterId: string): boolean {
  if (!isPremium(characterId)) return true;
  return state.adsRemoved || state.premiumRaces > 0;
}

/** True when server calls should be used (inside the host). Otherwise the mock store rules apply. */
function useServer(): boolean {
  return inVerse8Host();
}

export async function refreshEntitlements(): Promise<void> {
  if (!useServer()) return;
  const e = await fetchEntitlements();
  if (e) applyEntitlements(e);
}

export async function grantPremiumRaces(): Promise<boolean> {
  if (!useServer()) return mockStore.grant();
  const r = await serverGrantPremiumRaces();
  if (!r) return false;
  applyEntitlements({ ...state, premiumRaces: r.premiumRaces });
  return r.granted;
}

export async function consumePremiumRace(characterId: string): Promise<boolean> {
  if (!useServer()) return mockStore.consume(characterId).ok;
  const r = await serverConsumePremiumRace(characterId);
  if (!r) return !isPremium(characterId) || state.adsRemoved; // offline in host: only free karts
  applyEntitlements({ ...state, premiumRaces: r.premiumRaces });
  return r.ok;
}

export async function setNickname(name: string): Promise<string | null> {
  if (!useServer()) {
    applyEntitlements({ ...state, nickname: name });
    return name;
  }
  const r = await serverSetNickname(name);
  if (!r) return null;
  applyEntitlements({ ...state, nickname: r.nickname });
  return r.nickname;
}

export function serverReachable(): boolean {
  return useServer() && isConnected();
}

// ── Local-dev mock store (never reached inside the host) ────────────────────
export const mockStore = {
  grant(): boolean {
    applyEntitlements({ ...state, premiumRaces: Math.min(GRANT_CAP, state.premiumRaces + GRANT_SIZE) });
    return true;
  },
  consume(characterId: string): { ok: boolean; premiumRaces: number } {
    if (!isPremium(characterId) || state.adsRemoved) return { ok: true, premiumRaces: state.premiumRaces };
    if (state.premiumRaces <= 0) return { ok: false, premiumRaces: 0 };
    applyEntitlements({ ...state, premiumRaces: state.premiumRaces - 1 });
    return { ok: true, premiumRaces: state.premiumRaces };
  },
  purchase(): void {
    applyEntitlements({ ...state, adsRemoved: true });
  },
};

export function _resetForTests(): void {
  state = { adsRemoved: false, premiumRaces: 0, nickname: '', loaded: false };
  listeners.clear();
}
```
- [ ] **Step 3:** `main.ts`: `import { initShop } from './verse8/shop'; import { refreshEntitlements } from './verse8/entitlements';` — `game.start()` 뒤에 `initShop(); void refreshEntitlements();`.
- [ ] **Step 4:** `npm test -- entitlements` 통과(Task 3.3의 `premium` 플래그가 있어야 `rosa`가 잠김 → 3.3을 먼저 하거나 함께 커밋). Commit `feat(v8): entitlements cache with server/mock rules`.

### Task 3.3: `CharacterDef.premium`

- [ ] **Step 1:** `src/core/types.ts` `CharacterDef`에 `  /** Contract addition: locked behind a rewarded ad (3 races) or the remove-ads purchase. */\n  premium?: true;` 추가. `roster.ts`의 `fennec`, `bram`, `rosa` 항목에 `premium: true,`.
- [ ] **Step 2:** typecheck + `npm test`. Commit `feat(v8): mark Fennec/Bram/Rosa as premium karts`.

### Task 3.4: MainMenu 잠금 배지 + `LockSheet`

- [ ] **Step 1: i18n 키 추가** (`en.ts`/`ko.ts`)
```
'v8.locked': 'LOCKED' / '잠김'
'v8.ticketsLeft': '📺 ×{n}' / '📺 ×{n}'
'v8.lock.title': 'PREMIUM KART' / '프리미엄 카트'
'v8.lock.body': 'Watch an ad to drive {name} for 3 races, or unlock every kart for good.' / '광고를 보면 {name}(을)를 3레이스 동안 몰 수 있어요. 100 VX로 전 차량을 영구 해금할 수도 있습니다.'
'v8.lock.watch': '📺 WATCH AD · 3 RACES' / '📺 광고 보고 3회 이용'
'v8.lock.buy': '🛒 UNLOCK ALL · 100 VX' / '🛒 전 차량 해금 · 100 VX'
'v8.lock.other': 'PICK ANOTHER KART' / '다른 카트 고르기'
'v8.lock.adFailed': 'No reward this time.' / '이번엔 보상을 받지 못했어요.'
'v8.lock.buyFailed': 'Purchase unavailable right now.' / '지금은 구매할 수 없어요.'
'v8.lock.granted': '+3 premium races!' / '프리미엄 레이스 +3회!'
'v8.mockAd.title': 'Local dev — no ad SDK' / '로컬 개발 — 광고 SDK 없음'
'v8.mockAd.reward': 'Reward' / '보상'
'v8.mockAd.dismiss': 'Dismiss' / '닫기'
'v8.shop.mockTitle': 'Local dev — simulated purchase' / '로컬 개발 — 모의 구매'
'v8.shop.item': 'Unlock all karts' / '전 차량 해금'
'v8.shop.buy': 'Buy — 100 VX' / '구매 — 100 VX'
'v8.shop.close': 'Close' / '닫기'
```
- [ ] **Step 2: `src/ui/LockSheet.ts`** — `glass panel` 하단 시트. `show(character, { onWatch, onBuy, onOther })`, 버튼 3개(`button()` 헬퍼), 잔여권 표시. 광고 진행 중 버튼 disabled. `hide()`, `dispose()`.
- [ ] **Step 3: MainMenu**
  - `buildCharacterCard`: `if (c.premium)` → `el('div','lock-badge', t('v8.locked'), card)`; 카드에 `data-premium="1"`.
  - `refreshLocks()`: `onEntitlementsChange`로 구독. 각 프리미엄 카드에 `classList.toggle('locked', !canRace(c.id))`, 배지 텍스트 = adsRemoved면 제거, 아니면 `premiumRaces>0 ? t('v8.ticketsLeft',{n}) : t('v8.locked')`.
  - `goTo('trackSelect')`로 넘어가는 두 경로(카드 클릭·CONTINUE·confirm)에 가드: `if (!canRace(def.id)) { this.onLockedAttempt?.(def); return; }`. `onLockedAttempt: ((c: CharacterDef) => void) | null` 콜백 노출.
  - CSS: `.char-card.locked .char-swatch { filter: grayscale(.7) brightness(.6) }`, `.lock-badge` 우상단 필.
- [ ] **Step 4: Game 배선** — `buildMainMenu()`에 `menu.onLockedAttempt = (c) => this.lockSheet.show(c, {...})`:
  - `onWatch`: `requestRewardedAd(PLACEMENT_REWARDED_PREMIUM)` → true면 `grantPremiumRaces()` → true면 토스트 `v8.lock.granted` + 시트 닫고 `mainMenu.goTo('trackSelect')`(public 메서드 `proceedFromCharacter()` 추가); false면 토스트 `v8.lock.adFailed`.
  - `onBuy`: `buyRemoveAds()`; false면 토스트 `v8.lock.buyFailed`. 구매 완료는 `onEntitlementsChange`가 배지 갱신.
  - `onOther`: 시트 닫기.
  - `lockSheet`는 `onLangChange()` 재구축 목록에 포함.
- [ ] **Step 5:** 브라우저(톱프레임 mock): 캐릭터 화면에서 Rosa 잠김 배지 → 클릭 → 시트 → 광고 보기 → mock Reward → 배지 `📺 ×3` → 진행. 뒤로 → 구매 → mock Buy → 배지 사라짐. Commit `feat(v8): premium kart lock badges + lock sheet (ad / buy / other)`.

### Task 3.5: 레이스 시작 시 소비

- [ ] **Step 1:** `Game.startRace(settings)`를 `async`로 감싸지 않고, 앞단에 게이트 메서드 추가:
```ts
  private async startRaceGated(settings: RaceSettings): Promise<void> {
    if (isPremium(settings.characterId)) {
      const ok = await consumePremiumRace(settings.characterId);
      if (!ok) {
        const def = getCharacter(settings.characterId);
        this.mainMenu.show('characterSelect');
        this.lockSheet.show(def, this.lockSheetHandlers(def));
        return;
      }
    }
    this.startRace(settings);
  }
```
`menu.onStart = (s) => void this.startRaceGated(s);` 결과 화면 RACE AGAIN·일시정지 RESTART도 `startRaceGated`로.
- [ ] **Step 2:** 브라우저: Rosa 3회권 → 레이스 시작 → 배지 ×2 확인(결과 후 메뉴 복귀 시). Commit `feat(v8): consume a premium race ticket when starting with a premium kart`.

---

# Part 4 — 리더보드

### Task 4.1: `LeaderboardPanel.ts`

- [ ] **Step 1: i18n 키**
```
'lb.title': 'TRACK RECORDS' / '트랙 기록'
'lb.rank': '#' / '순위'  'lb.name': 'RACER' / '레이서'  'lb.time': 'TIME' / '기록'  'lb.kart': 'KART' / '카트'
'lb.you': 'YOU' / '나'  'lb.myBest': 'Your best: {time} (#{rank})' / '내 최고: {time} ({rank}위)'
'lb.noEntry': 'No time set yet.' / '아직 기록이 없어요.'
'lb.empty': 'Be the first to set a time!' / '첫 기록의 주인공이 되세요!'
'lb.offline': 'Leaderboard needs the Verse8 host.' / '랭킹은 Verse8에서 플레이할 때 표시됩니다.'
'lb.loading': 'Loading…' / '불러오는 중…'
'lb.newRank': 'RANK #{rank}!' / '{rank}위!'
'lb.setNickname': 'Set your nickname →' / '닉네임 설정하기 →'
'lb.button': '🏆 RECORDS' / '🏆 기록'
'lb.close': 'CLOSE' / '닫기'
```
- [ ] **Step 2: 컴포넌트** `src/ui/LeaderboardPanel.ts` — `show(trackId, opts?: { highlightSubmit?: SubmitResult })`, 트랙 탭(TRACKS 6개, `t(theme)`), 표 (상위 10: 순위·이름·`formatRaceTime(timeMs/1000)`·카트 이름·난이도), 내 행 `you` 클래스, 하단 내 최고/순위 또는 `lb.noEntry`, `!serverReachable()`이면 `lb.offline` + 로컬 베스트(`localStorage tkr.best.<trackId>`) 표시, `onSetNickname` 콜백 링크(닉네임 비어있을 때만). 로딩 중 `lb.loading`. 요청 중 탭 전환 시 이전 응답 무시(요청 시퀀스 번호).
- [ ] **Step 3:** CSS `.lb-panel`, `.lb-tabs`, `.lb-row.you`. Commit `feat(v8): leaderboard panel UI`.

### Task 4.2: 제출 훅 + 진입점

- [ ] **Step 1: Game** — `race:finish`(isPlayer) 핸들러에서 `onPlayerFinished(r)` 뒤:
```ts
        this.maybeSubmitTime(r, e.time);
```
```ts
  private maybeSubmitTime(r: RaceContext, seconds: number): void {
    if (new URLSearchParams(location.search).has('auto')) return;
    if ([...new URLSearchParams(location.search).keys()].some((k) => k.startsWith('b.'))) return;
    if (r.playerAutoDriverBeforeFinish) return; // set true if auto-driver was attached before finish
    const timeMs = Math.round(seconds * 1000);
    const trackId = r.trackDef.id;
    try {
      const prev = Number(localStorage.getItem(`tkr.best.${trackId}`) ?? Infinity);
      if (timeMs < prev) localStorage.setItem(`tkr.best.${trackId}`, String(timeMs));
    } catch { /* ignore */ }
    if (!serverReachable() && !inVerse8Host()) return;
    void submitTime(trackId, timeMs, r.settings.characterId, r.settings.difficulty).then((res) => {
      if (res && this.race === r) this.lastSubmit = res;
    });
  }
```
`RaceContext`에 `playerAutoDriverBeforeFinish: boolean` 추가(buildRaceInner에서 `?auto=1`로 AIDriver 붙일 때 true).
- [ ] **Step 2: 결과 화면** — `ResultsScreen`에 `onRecords` 콜백 + 버튼 `t('lb.button')`(actions 첫 번째). `Game.enterResults()`에서 `this.lastSubmit?.updated`면 결과 서브헤딩 아래 `t('lb.newRank', {rank})` 배너(ResultsScreen `showRankBanner(text)`), 버튼 클릭 → `leaderboard.show(trackId, { highlightSubmit })`.
- [ ] **Step 3: 타이틀** — MainMenu 타이틀 좌상단 `🏆` 버튼(`onRecords` 콜백) → `leaderboard.show(TRACKS[0].id)`.
- [ ] **Step 4:** 브라우저(톱프레임): 완주 후 결과에 🏆 버튼 → 패널 오프라인 문구 + 로컬 베스트 표시. 콘솔 에러 0. Commit `feat(v8): submit finish time, records button on results/title`.

---

# Part 5 — 설정 화면

### Task 5.1: `SettingsPanel.ts`

- [ ] **Step 1: i18n 키**
```
'settings.title': 'SETTINGS' / '설정'  'settings.nickname': 'NICKNAME' / '닉네임'
'settings.nicknamePh': '1–12 letters, digits, Hangul' / '1~12자 (영문·숫자·한글)'
'settings.nicknameHint': 'Shown on the track records.' / '트랙 기록에 표시되는 이름입니다.'
'settings.language': 'LANGUAGE' / '언어'  'settings.mute': 'MUTE AUDIO' / '음소거'
'settings.save': 'SAVE' / '저장'  'settings.close': 'CLOSE' / '닫기'
'settings.saved': 'Saved.' / '저장했어요.'  'settings.invalid': 'Nickname not allowed.' / '사용할 수 없는 닉네임이에요.'
'settings.offlineSaved': 'Saved on this device. Syncs on Verse8.' / '이 기기에 저장. Verse8 접속 시 동기화됩니다.'
'settings.nudge': 'Set a nickname in ⚙ Settings to show your name on the records.' / '⚙ 설정에서 닉네임을 정하면 기록에 이름이 표시됩니다.'
```
- [ ] **Step 2: 컴포넌트** — `glass panel`: 닉네임 `<input maxlength=12>`(초기값 `getEntitlements().nickname`), 언어 세그먼트 KO/EN(`setLang`), 음소거 체크(`onToggleMute` 콜백 + 현재값), SAVE: `normalizeNickname` 클라 검증 → 빈 값이면 `settings.invalid`; `setNickname()` → 성공 토스트 `settings.saved`(호스트 밖이면 `settings.offlineSaved`). 닫기. `handleInput`: back → 닫기.
- [ ] **Step 3: 타이틀** — 기존 `.lang-toggle` 버튼을 `⚙`로 교체(클래스 `settings-toggle`, 위치 동일) → `onSettings` 콜백. `Game`에 `settingsPanel` 생성/재구축/배선(`onToggleMute: () => this.toggleMute()`; `muted` 현재값 getter는 `this.audio.muted`). 첫 실행(`localStorage tkr.nudged` 없음 && 닉네임 빈 값 && 호스트 안)에 토스트 `settings.nudge` 1회.
- [ ] **Step 4:** 브라우저: ⚙ → 닉네임 "Kart Kid" 저장(mock: 캐시 반영) → 언어 KO/EN 즉시 전환(패널 재구축 후에도 열린 상태 유지: 재구축 전 `wasOpen` 기억) → 음소거 토글로 `.mute-indicator.visible`. Commit `feat(v8): settings panel (nickname / language / mute), title gear replaces lang toggle`.

---

# Part 6 — 문서·검증·마무리

### Task 6.1: 문서

- [ ] **Step 1:** `docs/VERSE8-CONTEXT.md` 작성 — 섹션: ①이 게임은(프로시저럴·에셋 0·MIT) ②깨뜨리면 안 되는 것(`base './'`, `@verse8/ads` 정적 import·package.json 유지, `src/verse8/server.ts` 딥임포트 리터럴, 핸드셰이크, `server.js` 계약·컬렉션 `tkr_times`·유저스테이트 키, `src/core` 프로즌, `balance.ts`, 터치/i18n 구조) ③빌드/검증 명령 ④크리에이터 콘솔 체크리스트(`remove-ads` 100 VX 비소모 Lifetime 1, placement `rewarded_premium_kart`) ⑤배포 절차 + **V8 Agent 프롬프트 블록**.
- [ ] **Step 2:** `CONTRACT.md` additions에 `CharacterDef.premium`, 워크스트림 F 행. `NOTES.md` §2 `verse8/` 트리·§6 3번 완료·§1 배포 링크.
- [ ] **Step 3:** 전체 검증
```bash
npm test && npm run typecheck && npm run build && grep -c '"@agent8/gameserver' dist/assets/*.js
```
Expected: 테스트 전부 통과(~45), 클린, grep 결과 `0`(파일별 0).
- [ ] **Step 4:** Commit `docs(v8): VERSE8-CONTEXT, contract additions, NOTES`.

### Task 6.2: 브라우저 회귀(톱프레임 mock)
- [ ] 캐릭터 잠금→광고→×3→레이스 시작→×2→구매→전체 해금 / 결과 🏆 패널 오프라인 표시 / ⚙ 설정 3항목 / KO·EN 전환 후 새 패널들 한국어 / 모바일 뷰포트에서 시트·패널 레이아웃 / 콘솔 에러 0.

### 이후 (사용자 입력 필요)
- gitlab repo URL + 토큰 수령 → develop 오버레이 push → V8 Agent 프롬프트 첨부 → 호스트에서 실 광고·결제·랭킹·핸드셰이크 확인 → 크리에이터 콘솔 상품/placement 등록.
