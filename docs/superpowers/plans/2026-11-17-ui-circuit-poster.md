# UI 개편 "서킷 포스터" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drift Dash GP의 모든 화면과 HUD를 스펙 `docs/superpowers/specs/2026-11-17-ui-circuit-poster-design.md`의 "서킷 포스터" 스타일(검정 아스팔트 + 레이스 옐로 하나, 평행사변형·체커·번호판, 선 아이콘)로 다시 입힌다.

**Architecture:** 화면 구조와 흐름은 그대로 두고 표현만 바꾼다. 색·모양은 `src/styles/01-base.css`의 토큰과 `02-components.css`의 공통 부품에 모으고, 화면별 CSS(03~17)는 그 부품을 쓰게 고친다. 이모지·화살표 문자는 새 모듈 `src/ui/icons.ts`의 인라인 SVG로 바꾸고, 번역 문자열에는 아이콘을 넣지 않는다. 게임 규칙, 주행 물리, 3D 카트·트랙, `server.js`는 건드리지 않는다.

**Tech Stack:** TypeScript 7, Vite 8, Three.js 0.185, 순수 DOM + CSS(프레임워크 없음), vitest(jsdom), puppeteer(`tools/mobile-audit.mjs`).

**브랜치:** `ui-circuit-poster` (push 금지). 단계마다 `npm run typecheck && npm test` 통과 후 커밋.

**공통 명령** (셸마다 먼저 실행):

```bash
export PATH="$HOME/.nvm/versions/node/v23.11.0/bin:$PATH"
cd "/Users/hytae/Downloads/Drift Dash GP"
```

---

## 파일 구조

| 파일 | 책임 | 작업 |
|---|---|---|
| `src/styles/01-base.css` | 토큰, 리셋, 캔버스/#ui 레이어 | 토큰 교체 |
| `src/styles/02-components.css` | 공통 부품: `.panel` `.btn` `.chip` `.seg` `.stat` `.plate` `.checker` `.lock` `kbd` `.toast` `.icon` | 재작성 |
| `src/styles/03-screens.css` | 전체 화면 오버레이, 패널 등장 | 수정 |
| `src/styles/04-menu.css` | 로고, 레이서·서킷 카드, 선택 화면 아래 칸 | 재작성 |
| `src/styles/05-loading.css` | 로딩 | 재작성 |
| `src/styles/06-pause-results.css` | 일시정지, 결과, 치명 오류 | 재작성 |
| `src/styles/07-hud.css` | HUD 본체 + 알림(토스트 위치) | 재작성 |
| `src/styles/08-responsive.css` | 낮은 데스크톱 창 | 수정 |
| `src/styles/09-touch-lang.css` | 터치 컨트롤, 한글 타이포 | 재작성 |
| `src/styles/10-verse8-panels.css` | 잠금 시트, 기록, 설정, 온라인 | 재작성 |
| `src/styles/11-phone.css` | 폰 분기점, 썸네일 크기 | 수정 |
| `src/styles/12-hud-widgets.css` | 미러, 드래프트, 차지, 팀 집계 | 색을 토큰으로 |
| `src/styles/13-lobby-gate.css` | 로비 버튼 배치, 회전 안내 | 재작성 |
| `src/styles/14-layout-overrides.css` | HUD 재배치(순위표·미니맵), 화면 층 | 수정 |
| `src/styles/15-garage.css` | 차고, 컵 칩, 오늘의 도전 | 수정 |
| `src/styles/16-item-guide.css`, `17-short-desktop.css` | 아이템 가이드, 낮은 PC 창 | 수정 |
| `src/ui/icons.ts` (신설) + `icons.test.ts` | `icon(name)` → 인라인 SVG | 신설 |
| `src/ui/logo.ts` (신설) | 워드마크 DOM(로비·로딩 공용) | 신설 |
| `src/ui/controlsLegend.ts` (신설) | 조작법 표(설정·첫 로딩 공용) | 신설 |
| `src/ui/dom.ts` | `button()`에 아이콘 인자, `kbd()` | 수정 |
| `src/ui/MainMenu.ts` | 로고, 로비, 카드, 상세 칸 | 수정 |
| `src/ui/SettingsPanel.ts` `LoadingScreen.ts` `ResultsScreen.ts` `PauseMenu.ts` `LockSheet.ts` `LeaderboardPanel.ts` `DailyPanel.ts` `GaragePanel.ts` `OnlinePanel.ts` `ItemGuide.ts` | `.glass` 제거, 아이콘, 구획 | 수정 |
| `src/ui/HUD.ts` `src/ui/hud/*` `src/ui/Minimap.ts` | 미니맵 위치·색, 아이콘 | 수정 |
| `src/ui/TouchControls.ts` `src/game/OrientationGate.ts` | 아이콘 | 수정 |
| `src/game/MenuBackdrop.ts` | 아스팔트 + 출발 그리드 배경 | 수정 |
| `src/game/settingsStore.ts` (+ 테스트) | `tkr.seenControls` | 수정 |
| `src/game/Game.ts` | 음소거 표시 아이콘, 로딩 배경색 (배선만) | 최소 수정 |
| `src/core/locales/{en,ko}.ts`, `src/core/i18n.test.ts` | 이모지·화살표 제거, 키 삭제·추가 | 수정 |
| `src/main.ts`, `src/buildTag.ts`, `src/verse8/{ads,shop}.ts`, `index.html` | `.glass` 제거, 색 | 최소 수정 |
| `tools/mobile-audit.mjs` | PC 1280×720 추가 (완료, `df33e0b`) | 완료 |
| `docs/ARCHITECTURE.md` | 2절 표에 아이콘·토큰 위치 | 수정 |

## 설계 결정 (스펙을 코드로 옮기며 정한 것)

- **기울기.** `--slant: 14px`은 높이 약 66px에서 12도다. 높이가 다른 부품은 각도가 12도 안팎으로 유지되게 부품 안에서 `--slant`를 줄여 쓴다(칩 4px, 세그먼트 8px, 버튼 10px, 시작 버튼 14px).
- **체커.** `repeating-linear-gradient` 두 겹(윗줄·아랫줄)을 `--checker` 변수에 넣고 `.checker`와 패널 머리 띠가 같이 쓴다. 한 칸 크기는 `--sq`(기본 4px).
- **패널 머리 띠.** 패널은 스크롤 컨테이너라 띠를 `position: sticky` 가상 요소로 그려 내용이 그 위로 지나가지 않게 한다. 왼쪽 노란 띠는 `border-left`.
- **포커스.** 버튼은 스펙대로 채움으로 표시한다(`.btn.focused` 노랑 + 왼쪽 갈매기 표시, `.primary.focused`는 흰색). 카드는 `clip-path`를 쓰지 않으므로 흰 `outline`. 세그먼트는 선택 = 노랑, 포커스 = 흰색.
- **이탤릭.** `--display`를 쓰는 규칙마다 `font-style: italic`을 함께 적는다.

---

### Task 1: 토큰, 공통 부품, 아이콘 (스펙 1~4절)

**Files:**
- Modify: `src/styles/01-base.css`, `src/styles/02-components.css`, `src/styles/03-screens.css`
- Create: `src/ui/icons.ts`, `src/ui/icons.test.ts`
- Modify: `src/ui/dom.ts`, `index.html`

- [ ] **Step 1: 아이콘 실패 테스트 작성** — `src/ui/icons.test.ts`

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ICON_NAMES, icon } from './icons';

describe('icons', () => {
  it('every name returns a 24-grid stroke svg that inherits colour', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(23);
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      expect(svg.tagName.toLowerCase()).toBe('svg');
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.classList.contains('icon')).toBe(true);
      expect(svg.childElementCount).toBeGreaterThan(0);
    }
  });

  it('covers the names the spec lists', () => {
    const need = ['trophy', 'wrench', 'gear', 'flag', 'calendar', 'users', 'lock', 'chevron-left', 'chevron-right',
      'spray', 'ad', 'cart', 'sound', 'mute', 'pause', 'play', 'rotate-phone', 'star', 'check', 'close',
      'coin', 'flame', 'target'];
    for (const n of need) expect(ICON_NAMES).toContain(n);
  });

  it('throws on an unknown name', () => {
    // @ts-expect-error deliberately unknown
    expect(() => icon('nope')).toThrow(/unknown icon/i);
  });

  it('adds an extra class when asked', () => {
    expect(icon('star', 'on').classList.contains('on')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/ui/icons.test.ts` → `Cannot find module './icons'`로 FAIL.

- [ ] **Step 3: `src/ui/icons.ts` 구현.** 공개 API:

```ts
export type IconName = /* 'trophy' | 'wrench' | … 스펙의 23개 + 'chevron-up' | 'chevron-down' | 'uturn' */;
export const ICON_NAMES: readonly IconName[];
/** 24x24, stroke 2, currentColor. 없는 이름이면 Error('unknown icon: <name>'). */
export function icon(name: IconName, extraClass?: string): SVGSVGElement;
```

  도형은 `IconName → (path d 문자열 | ['c', cx, cy, r])[]` 표로 두고 `createElementNS`로 만든다. svg 속성: `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon"`.

- [ ] **Step 4: 통과 확인** — `npx vitest run src/ui/icons.test.ts` → PASS.

- [ ] **Step 5: `src/ui/dom.ts`** — `button(label, className, onClick, iconName?)`: 아이콘이 있으면 `<svg class="icon">` + `<span class="btn-label">`을 넣는다. `kbd(parent, text)`와 `kbdIcon(parent, iconName)` 추가.

- [ ] **Step 6: `01-base.css` 토큰 교체.** `:root`는 스펙 1절 표의 값 그대로:

```css
:root {
  --asphalt: #15161a; --panel: #26282f; --panel-hi: #32353e; --line: #3d4049;
  --ink: #ffffff; --ink-dim: #b9bdc7; --ink-faint: #7c8190;
  --yellow: #ffd400; --on-yellow: #15161a; --red: #e8352b;
  --gold: #ffd23f; --silver: #d7dce8; --bronze: #e08a4a;
  --ally: #6fa3ff; --rival: #ff6b74;            /* HUD 아군·상대 (2026-09-09 결정, 값 그대로) */
  --hud-bg: rgba(21, 22, 26, 0.88);              /* 레이스 중 HUD 상자 전용 예외 */
  --slant: 14px; --radius: 2px; --sq: 4px;
  --checker: repeating-linear-gradient(90deg, #fff 0 var(--sq), #15161a var(--sq) calc(var(--sq) * 2)),
             repeating-linear-gradient(90deg, #15161a 0 var(--sq), #fff var(--sq) calc(var(--sq) * 2));
  --display: 'Impact', 'Haettenschweiler', 'Arial Narrow Bold', 'Franklin Gothic Medium', 'Arial Black', system-ui, sans-serif;
  --body: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1); --ease-pop: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

  삭제: `--bg` `--bg-2` `--blue` `--magenta` `--orange` `--green` `--accent-grad` `--glass-*` `--radius-sm`. `html, body, #app` 배경은 `--asphalt`. `index.html`의 `theme-color`와 파비콘 바탕도 `#15161a`, 파비콘 글자는 `#ffd400`.

- [ ] **Step 7: `02-components.css` 재작성** — 스펙 3절 표의 부품을 전부 정의한다. 핵심 규칙:

```css
.btn {
  --slant: 10px;
  clip-path: polygon(var(--slant) 0, 100% 0, calc(100% - var(--slant)) 100%, 0 100%);
  border: 0; border-radius: 0; background: var(--panel-hi); color: var(--ink);
  font-family: var(--display); font-style: italic; min-height: 44px; padding: 0 26px;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
}
.btn:hover { background: var(--line); }
.btn:active { transform: translateY(2px); }
.btn.primary { background: var(--yellow); color: var(--on-yellow); }
.btn.ghost { background: var(--asphalt); box-shadow: inset 0 -2px 0 var(--line); }
.btn.danger { box-shadow: inset 6px 0 0 var(--red); }      /* 번지지 않는 inset 띠 */
.btn.focused { background: var(--yellow); color: var(--on-yellow); }
.btn.primary.focused { background: var(--ink); }
.btn.focused::before { /* 갈매기 표시: clip-path 다각형, currentColor */ }
.panel {
  background: var(--panel); border-left: 6px solid var(--yellow);
  clip-path: polygon(0 0, calc(100% - var(--slant)) 0, 100% var(--slant), 100% 100%, 0 100%);
}
.panel::before { /* position: sticky; top: 0; height: 8px; background: var(--checker) … */ }
.checker { height: calc(var(--sq) * 2); background-image: var(--checker);
  background-size: 100% 50%; background-position: 0 0, 0 100%; background-repeat: no-repeat; }
.plate { background: #fff; color: #111; border: 2px solid #111; font-family: var(--display); font-style: italic; }
.stat-blocks i { width: 9px; height: 9px; background: var(--line); } .stat-blocks i.on { background: var(--yellow); }
```

  `.glass`와 `.pill`은 정의하지 않는다(쓰던 곳은 뒤 Task에서 `.panel`/`.chip`으로 바꾼다. 중간 단계에서 화면이 깨지지 않게 이 Task에서 TS의 `'glass '` 문자열을 한 번에 제거하고 `pill` → `chip`으로 바꾼다).

- [ ] **Step 8: `03-screens.css`** — `panel-in`을 짧은 미끄러짐(위로 14px, 0.3s)으로 바꾸고 `prefers-reduced-motion`에서는 끈다.

- [ ] **Step 9: 검증과 커밋**

```bash
npm run typecheck && npm test
git add -A src/styles/01-base.css src/styles/02-components.css src/styles/03-screens.css src/ui index.html src/main.ts src/verse8/ads.ts src/verse8/shop.ts
git commit -m "UI poster 1/6: tokens, shared parts, line icons"
```

Expected: typecheck 오류 0, 테스트 전부 PASS(기존 123 + 아이콘 4).

---

### Task 2: 로비, 로고, 배경 (스펙 5절, 6절 "로비"·"조작법 안내")

**Files:**
- Create: `src/ui/logo.ts`, `src/ui/controlsLegend.ts`
- Modify: `src/ui/MainMenu.ts`(타이틀 구역), `src/styles/04-menu.css`(로고), `src/styles/13-lobby-gate.css`, `src/styles/14-layout-overrides.css`(로비 부분), `src/game/MenuBackdrop.ts`, `src/game/settingsStore.ts`, `src/ui/SettingsPanel.ts`, `src/ui/LoadingScreen.ts`, `src/styles/05-loading.css`, `src/core/locales/{en,ko}.ts`, `src/core/i18n.test.ts`, `src/buildTag.ts`
- Test: `src/game/settingsStore.test.ts` (신설)

- [ ] **Step 1: `settingsStore` 실패 테스트**

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasSeenControls, markControlsSeen } from './settingsStore';

describe('seen-controls flag', () => {
  beforeEach(() => localStorage.clear());
  it('is false until marked, then true', () => {
    expect(hasSeenControls()).toBe(false);
    markControlsSeen();
    expect(localStorage.getItem('tkr.seenControls')).toBe('1');
    expect(hasSeenControls()).toBe(true);
  });
  it('reads as seen when storage is unreadable, so the legend is skipped rather than repeated', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(hasSeenControls()).toBe(true);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과.** `settingsStore.ts`에 `SEEN_CONTROLS_KEY = 'tkr.seenControls'`, `hasSeenControls()`(읽기 예외면 `true`), `markControlsSeen()`(쓰기 예외 무시).

- [ ] **Step 3: 번역.** `en.ts`·`ko.ts`에서
  - 삭제: `title.version`, `menu.step1`, `menu.step2`, `diff.easy.blurb`, `diff.normal.blurb`, `diff.hard.blurb`, `pause.hint`
  - 이모지·화살표 제거: `menu.paint`, `menu.back`, `menu.continue`, `mute`, `v8.lock.watch`, `v8.lock.buy`, `lb.setNickname`, `lb.button`, `settings.nudge`, `online.quick`
  - `loading.subtitle`에서 `{stars}` 제거(별은 아이콘으로 따로 그린다)
  - 추가: `lobby.race`, `settings.controls`, `legend.touch.stick`, `legend.touch.drift`, `legend.touch.item`, `legend.touch.pause`, `pause.hint.resume`, `pause.hint.move`, `pause.hint.select`, `loading.controls`
  - 값 변경: `results.changeTrack` → "서킷 변경"/"CHANGE CIRCUIT", `results.mainMenu` → "로비"/"LOBBY"
  - `i18n.test.ts`에 "번역 값에 이모지·화살표가 없다" 테스트를 추가한다:

```ts
it('no emoji or arrow glyphs in either language (icons are drawn, not typed)', () => {
  const bad = /[←-⇿⌀-⏿■-⟿⬀-⯿\u{1f000}-\u{1faff}]/u;
  for (const table of [en, ko]) for (const [k, v] of Object.entries(table)) expect(bad.test(v), k).toBe(false);
});
```

- [ ] **Step 4: `logo.ts`** — `buildLogo(parent, { compact?: boolean }): HTMLElement`. 구조: `.logo > .logo-line(.logo-word "DRIFT DASH" + .logo-gp.plate.yellow "GP") + .logo-checker.checker`. `GAME_TITLE`의 마지막 낱말을 번호판에 넣는다.

- [ ] **Step 5: `controlsLegend.ts`** — `buildControlsLegend(parent, touch: boolean): HTMLElement`. 키보드: `kbd`/`kbdIcon`으로 8줄(`legend.*`). 터치: `legend.touch.*` 4줄.

- [ ] **Step 6: `MainMenu.ts` 타이틀 구역.** 조작키 표와 `title.version` 제거(빌드 ID만 `.version`에 남김). 로비: `.lobby-profile`(빈 프로필 바 자리) + `.btn.start.single-toggle` + `.lobby-grid`(오늘의 도전·차고·기록·설정, 아이콘 + 글자, 온라인은 `ONLINE_ENABLED`일 때만). 키보드: 시작 버튼 ↔ 격자(좌우 ±1, 상하 ±2).

- [ ] **Step 7: `SettingsPanel.ts`** — "조작법" 구획(`settings.controls` 제목 + `buildControlsLegend(panel, isTouch)`). **`LoadingScreen.ts`** — 로고, 체커 진행 바, 별 아이콘, `show(def, opts?: { touch: boolean })`에서 `hasSeenControls()`가 `false`면 팁 대신 조작법 표를 보이고 `markControlsSeen()`.

- [ ] **Step 8: `MenuBackdrop.ts`** — `dust`·`stars` Points와 하늘 셰이더·고리 삭제. `FOG_COLOR = 0x15161a`, 바닥은 아스팔트 캔버스 텍스처, 그 위에 출발 그리드 데칼(노란 칸 선, 흰 출발선, 체커 띠). 조명 5개(직사광·스폿·반구·점광 2)는 개수 유지, 점광 색을 흰색·옅은 노랑으로. 환경맵 카드도 흰색·옅은 노랑.

- [ ] **Step 9: CSS** — `04-menu.css` 로고부, `13-lobby-gate.css`, `05-loading.css`, `buildTag.ts` 색(`#7c8190`, 배경 없음).

- [ ] **Step 10: 검증·캡처·커밋**

```bash
npm run typecheck && npm test
node tools/mobile-audit.mjs http://localhost:5199 --out marketing/.audit/ui-poster/wip
git commit -am "UI poster 2/6: lobby, wordmark, asphalt backdrop, controls legend"
```

  `wip/phone-ko-01-title.png`, `pc-ko-01-title.png`, `*-11-loading.png`, `*-02b-settings-bottom.png`을 열어 본다.

---

### Task 3: 레이서·서킷 선택 (스펙 6절)

**Files:** `src/ui/MainMenu.ts`, `src/styles/04-menu.css`, `08-responsive.css`, `11-phone.css`, `17-short-desktop.css`, `15-garage.css`(컵 칩)

- [ ] **Step 1: 레이서 카드** — `buildCharacterCard(c, index)`: 썸네일(바탕 `cssHex(c.color)` 단색) + `.char-row`(`.plate` 번호 `index+1`, 이름) + 체급 `.chip.weight-*`(앞에 8px 색 사각형) + 잠금 `.lock`. 카드의 `card-tag`와 `.stats`는 만들지 않는다.
- [ ] **Step 2: 상세 칸** — `.select-footer.detail`: 이름(크게), 한 줄 설명, `.stat` 5개(`blocks = max(1, round(v*5))`), 버튼 도색(spray)·뒤로(chevron-left)·다음(chevron-right, `.primary`). `setCharacter()`가 스탯 블록의 `on` 클래스를 갱신한다(값이 바뀔 때만).
- [ ] **Step 3: 서킷 카드** — 썸네일 + 테마 `.chip`, 이름, 별 3개(`icon('star')`, 켜짐 = 노랑 채움), 랩 수 `.chip`. 등급 칩·설명 문장 삭제.
- [ ] **Step 4: 아래 줄** — 모드/난이도/그랑프리 = 제목 + `.segmented > .seg`. `diffBlurb`·`cupHint` 삭제. 잠긴 컵을 누르면 `showToast(t('cup.locked', { cup }))`. 컵 칩의 자물쇠·별은 DOM 아이콘.
- [ ] **Step 5: "1/2 단계"·"2/2 단계" 문구 삭제**(`panel-kicker` 줄 제거).
- [ ] **Step 6: 선택 표시** — `.card.selected`: 3px 노란 테두리 + 왼쪽 위 노란 삼각형(`::before`, `clip-path: polygon(0 0, 100% 0, 0 100%)`). `.card.focused`: 흰 `outline`.
- [ ] **Step 7: 검증·캡처·커밋** — `npm run typecheck && npm test`, 캡처 `08-chars`, `09-locksheet`, `10-tracks`, `17`·`18-*focus*` 확인. `git commit -am "UI poster 3/6: racer and circuit select"`

---

### Task 4: 결과, 일시정지, 나머지 패널 (스펙 6절)

**Files:** `src/ui/ResultsScreen.ts`, `PauseMenu.ts`, `LockSheet.ts`, `LeaderboardPanel.ts`, `DailyPanel.ts`, `GaragePanel.ts`, `OnlinePanel.ts`, `ItemGuide.ts`, `src/game/OrientationGate.ts`, `src/game/Game.ts`(음소거 표시), `src/styles/06,10,13,15,16`

- [ ] **Step 1: 결과** — 맨 위 `.results-plate.plate`(내 순위 숫자, 리타이어면 `DNF` + `.red`), 순위표 행 불투명 `--panel`, 내 행 왼쪽 노란 띠, 1~3위 숫자 금·은·동. `.results-rewards`(빈 보상 줄 자리). 버튼: 다시 레이스(`.primary`), 서킷 변경, 로비, 기록(트로피 아이콘 버튼, `aria-label`). 색종이는 노랑·흰색·회색.
- [ ] **Step 2: 일시정지** — `pause.hint`를 `kbd`로 구성(`pause.hint.resume/move/select`).
- [ ] **Step 3: 잠금 시트·기록·오늘의 도전·온라인·차고·아이템 가이드·회전 안내·음소거 표시·알림** — 공통 부품으로 다시 입히고 아이콘 연결(ad, cart, trophy, chevron-right, play, lock, rotate-phone, mute).
- [ ] **Step 4: 검증·캡처·커밋** — `git commit -am "UI poster 4/6: results, pause and the remaining panels"`

---

### Task 5: HUD와 터치 (스펙 6절 "레이스 HUD")

**Files:** `src/ui/HUD.ts`, `src/ui/hud/StandingsBoard.ts`, `src/ui/Minimap.ts`, `src/ui/TouchControls.ts`, `src/styles/07,09,12,14`

- [ ] **Step 1: 왼쪽 열** — `.hud-left`(순위표 + 미니맵을 세로로). `StandingsBoard`에 `setCompact(on)`: 켜지면 상위 3명 + 나(4줄)만 그린다(시그니처에 반영, 프레임당 할당 없음). `HUD.setTouch(on)`이 호출한다.
- [ ] **Step 2: 미니맵** — 인라인 크기 제거(CSS `--map`으로 크기 지정), 도로 채움 `#15161a`.
- [ ] **Step 3: 아이템 칸** — 빈 칸 2px 점선 `--line`, 아이템이 있으면 `--panel` + 노란 테두리. 오버드라이브는 아래쪽 노란 진행 막대(`--od`).
- [ ] **Step 4: 랩·타이머·순위 번호판·속도계·가운데 알림** — 스펙대로. 순위 변동 알림의 삼각 문자는 `chevron-up/down` 아이콘, 역주행은 `uturn` 아이콘.
- [ ] **Step 5: 터치** — 일시정지 버튼 `icon('pause')` 44×44, 버튼·스틱 색.
- [ ] **Step 6: 위젯 색** — `12-hud-widgets.css`의 색을 토큰으로(아군 `--ally`, 상대 `--rival` 유지).
- [ ] **Step 7: 검증·캡처·커밋** — `node tools/mobile-audit.mjs http://localhost:5199 --out marketing/.audit/ui-poster/wip --hud` 후 `*-12-race.png`, `*-hud-*.png` 확인. `git commit -am "UI poster 5/6: race HUD and touch controls"`

---

### Task 6: 정리와 전 화면 캡처 (스펙 8절)

- [ ] **Step 1: 검색 기준(전부 0건이어야 한다)**

```bash
grep -rn "backdrop-filter\|--accent-grad\|--glass-" src/styles
grep -rn "linear-gradient" src/styles | grep -v "checker"          # 서킷 썸네일 외 0건
grep -rnP "[\x{2190}-\x{21ff}\x{2300}-\x{23ff}\x{25a0}-\x{27ff}\x{2b00}-\x{2bff}\x{1f000}-\x{1faff}]" src/ui src/game src/core/locales \
  | grep -vP "^\S+:\d+:\s*(//|\*|/\*)"                              # 주석 제외 0건
```

- [ ] **Step 2: 죽은 CSS·키 정리**, `docs/ARCHITECTURE.md` 2절 표에 줄 추가:

```
| Design tokens / shared parts (button, panel, chip, seg, plate, checker) | `styles/01-base.css`, `styles/02-components.css` |
| An icon | `ui/icons.ts` (`icon(name)`; never an emoji or arrow glyph in a string) |
```

- [ ] **Step 3: 전체 검증** — `npm run typecheck && npm test && npm run build`, `grep -c '"@agent8/gameserver' dist/assets/*.js` → 0.
- [ ] **Step 4: 전 화면 캡처** — `node tools/mobile-audit.mjs http://localhost:5199 --out marketing/.audit/ui-poster/after --hud`. 모든 PNG를 열어 글자 잘림, 겹침(터치 미니맵·순위표·스틱), 포커스 표시, 밝은·어두운 서킷의 HUD 가독성을 확인한다.
- [ ] **Step 5: 스펙 문서 끝에 "구현 중 판단" 절 추가, 대표 캡처 5장을 `docs/screenshots/ui-circuit-poster/`에 복사, 커밋** — `git commit -m "UI poster 6/6: cleanup, architecture map, captures"`

---

## Self-Review

- 스펙 1절 → Task 1 Step 6. 2·3절 → Task 1 Step 7. 4절 → Task 1 Step 1~5, Task 2 Step 3, Task 4·5의 아이콘 연결. 5절 → Task 2 Step 4·8. 6절 로비·조작법 → Task 2, 레이서·서킷 → Task 3, 결과·나머지 → Task 4, HUD → Task 5. 7절 파일 표 → 위 파일 구조 표와 일치. 8절 → Task 6.
- 이름 일관성: `icon()`/`ICON_NAMES`/`IconName`, `buildLogo()`, `buildControlsLegend()`, `hasSeenControls()`/`markControlsSeen()`, `StandingsBoard.setCompact()`, `HUD.setTouch()`.
