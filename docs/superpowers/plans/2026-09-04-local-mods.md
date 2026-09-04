# Turbo Kart Rush 로컬 개조 1차 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원작 카트레이서에 모바일 터치 조작, 트랙 2개(beach/volcano), 밸런스 상수 단일 파일(`balance.ts`), ko/en i18n을 추가한다. 게임 수치·동작은 바꾸지 않는다.

**Architecture:** `CONTRACT.md`의 모듈 격리를 유지한다. 새 코드는 `src/core`(타입·balance·i18n 파일 **추가**만), `src/ui/TouchControls.ts`, `src/kart/InputManager.ts`(터치 병합), `src/track/tracks/*`(데이터), 그리고 기존 UI 파일의 문자열 → `t()` 치환이다. 모든 단계는 `npm test` + `npm run typecheck` + `npm run build` 클린을 유지한다.

**Tech Stack:** TypeScript 7 (strict), Vite 8, Three.js 0.185, vitest + jsdom (신규). Node: `~/.nvm/versions/node/v23.11.0/bin`. 스펙: `docs/superpowers/specs/2026-09-04-local-mods-design.md`.

**작업 환경 공통:**
```bash
export PATH="$HOME/.nvm/versions/node/v23.11.0/bin:$PATH"
cd /Users/hytae/Downloads/turbo-kart-rush   # 브랜치 local-mods
```
브라우저 검증은 `.claude/launch.json`의 `turbo-kart-rush`(포트 5178) 프리뷰를 쓴다. 디버그 핸들 `window.__turboKartRush`.

---

## 파일 구조

| 파일 | 역할 | Part |
|---|---|---|
| `vitest.config.ts`, `package.json` | 테스트 인프라 | 1 |
| `src/core/types.ts` | `TouchInputSource` 인터페이스 **추가** | 1 |
| `src/ui/touchMath.ts` | 스틱 벡터 → 축 값 순수 함수 (`stickToAxes`) | 1 |
| `src/ui/TouchControls.ts` | DOM 오버레이(스틱·DRIFT·ITEM·⏸), `TouchInputSource` 구현 | 1 |
| `src/kart/InputManager.ts` | `attachTouch()` + 병합 + item/pause edge | 1 |
| `src/game/Game.ts` | TouchControls 생성·attach·레이스 상태 표시 | 1 |
| `src/style.css` | `.touch-*` 스타일, `.track-grid` 3×2, `html[lang=ko]` 타이포 | 1,2,4 |
| `src/track/tracks/coralCoast.ts`, `magmaRidge.ts` | 새 트랙 데이터 | 2 |
| `src/track/tracks/index.ts` | TRACKS 6개 | 2 |
| `src/core/balance.ts` | `BALANCE` 객체 + URL 오버라이드 | 3 |
| `src/kart/Kart.ts`, `src/items/ItemManager.ts`, `src/ai/AIDriver.ts`, `src/game/RaceManager.ts` | 로컬 const → `BALANCE` 참조 | 3 |
| `src/main.ts` | 오버라이드 적용 + `window.__balance` | 3 |
| `src/core/locales/en.ts`, `ko.ts`, `src/core/i18n.ts` | 리소스·`t()`·언어 감지 | 4 |
| `src/core/events.ts` | `'ui:langChange'` **추가** | 4 |
| `src/ui/MainMenu.ts`, `HUD.ts`, `LoadingScreen.ts`, `ResultsScreen.ts`, `PauseMenu.ts`, `src/main.ts`, `src/game/Game.ts` | 문자열 → `t()` | 4 |
| `CONTRACT.md`, `NOTES.md` | Contract additions, §4 표 갱신 | 3,4 |

---

# Part 1 — 터치 조작

### Task 1.1: vitest 인프라

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/core/math.test.ts` (스모크)

- [ ] **Step 1: 의존성 설치**

```bash
npm i -D vitest jsdom
```
Expected: `added N packages`, 에러 없음. (vitest 4.x는 vite 8과 호환. 설치 실패 시 `npm i -D vitest@^4 jsdom@^26`.)

- [ ] **Step 2: 스크립트 추가**

`package.json`의 `"scripts"`에 추가:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: vitest.config.ts 생성**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: 스모크 테스트 작성**

`src/core/math.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { clamp, ordinal } from './math';

describe('math', () => {
  it('clamp', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-1, 0, 1)).toBe(0);
  });
  it('ordinal', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(11)).toBe('11th');
  });
});
```

- [ ] **Step 5: 실행**

Run: `npm test`
Expected: `Test Files 1 passed`, `Tests 2 passed`.

Run: `npm run typecheck`
Expected: 출력 없이 종료(클린). (테스트 파일이 `src/` 안이라 tsc가 함께 검사한다. `vitest` 타입은 패키지에서 온다.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/core/math.test.ts
git commit -m "test: add vitest + jsdom infrastructure with math smoke test"
```

---

### Task 1.2: `stickToAxes` 순수 함수 + `TouchInputSource` 타입

**Files:**
- Modify: `src/core/types.ts` (InputState 뒤, `createEmptyInput` 앞)
- Create: `src/ui/touchMath.ts`
- Test: `src/ui/touchMath.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/ui/touchMath.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { stickToAxes } from './touchMath';

const R = 60;
const DZ = 0.12;

describe('stickToAxes', () => {
  it('12 o\'clock = full throttle, no steer', () => {
    const a = stickToAxes(0, -R, R, DZ);
    expect(a.throttle).toBeCloseTo(1);
    expect(a.brake).toBe(0);
    expect(a.steer).toBeCloseTo(0);
  });
  it('6 o\'clock = full brake', () => {
    const a = stickToAxes(0, R, R, DZ);
    expect(a.brake).toBeCloseTo(1);
    expect(a.throttle).toBe(0);
  });
  it('11 o\'clock = throttle + steer left', () => {
    const a = stickToAxes(-R * 0.5, -R * 0.866, R, DZ);
    expect(a.throttle).toBeGreaterThan(0.8);
    expect(a.steer).toBeLessThan(-0.4);
    expect(a.brake).toBe(0);
  });
  it('inside deadzone = zero', () => {
    const a = stickToAxes(3, -3, R, DZ);
    expect(a).toEqual({ steer: 0, throttle: 0, brake: 0 });
  });
  it('beyond radius saturates', () => {
    const a = stickToAxes(-500, -500, R, DZ);
    expect(a.steer).toBeCloseTo(-Math.SQRT1_2, 1);
    expect(a.throttle).toBeCloseTo(Math.SQRT1_2, 1);
    expect(Math.hypot(a.steer, a.throttle)).toBeLessThanOrEqual(1.0001);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- touchMath`
Expected: FAIL — `Cannot find module './touchMath'`.

- [ ] **Step 3: 구현**

`src/ui/touchMath.ts`:
```ts
/**
 * Pure maths for the virtual stick. Screen space: +x right, +y DOWN, so
 * "12 o'clock" is dy < 0. Output is normalised so |(steer, throttle|brake)| <= 1.
 */
export interface StickAxes {
  steer: number; // -1..1
  throttle: number; // 0..1
  brake: number; // 0..1
}

export function stickToAxes(dx: number, dy: number, radius: number, deadzone: number): StickAxes {
  const len = Math.hypot(dx, dy);
  if (radius <= 0 || len <= deadzone * radius) return { steer: 0, throttle: 0, brake: 0 };
  // Rescale so the deadzone edge maps to 0 and the radius maps to 1, then clamp.
  const mag = Math.min(1, (len - deadzone * radius) / (radius * (1 - deadzone)));
  const nx = (dx / len) * mag;
  const ny = (dy / len) * mag;
  return {
    steer: Math.max(-1, Math.min(1, nx)),
    throttle: ny < 0 ? Math.min(1, -ny) : 0,
    brake: ny > 0 ? Math.min(1, ny) : 0,
  };
}
```

- [ ] **Step 4: 타입 추가**

`src/core/types.ts`에서 `export function createEmptyInput()` 바로 위에 추가:
```ts
/**
 * Contract addition (touch controls). A DOM-side virtual controller exposes its held
 * state here; `InputManager` merges it with keyboard/gamepad and derives edges.
 */
export interface TouchInputSource {
  readonly steer: number; // -1..1
  readonly throttle: number; // 0..1
  readonly brake: number; // 0..1
  readonly drift: boolean; // held
  readonly item: boolean; // held (InputManager turns this into the useItem edge)
  readonly pause: boolean; // held (InputManager turns this into the pause edge)
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm test -- touchMath`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add src/ui/touchMath.ts src/ui/touchMath.test.ts src/core/types.ts
git commit -m "feat(touch): stickToAxes pure mapping + TouchInputSource contract type"
```

---

### Task 1.3: InputManager 터치 병합

**Files:**
- Modify: `src/kart/InputManager.ts`
- Test: `src/kart/InputManager.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/kart/InputManager.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { TouchInputSource } from '../core/types';
import { InputManager } from './InputManager';

function touch(over: Partial<TouchInputSource> = {}): TouchInputSource & { set(o: Partial<TouchInputSource>): void } {
  const s = { steer: 0, throttle: 0, brake: 0, drift: false, item: false, pause: false, ...over };
  return Object.assign(s, {
    set(o: Partial<TouchInputSource>) {
      Object.assign(s, o);
    },
  });
}

describe('InputManager touch merge', () => {
  it('passes touch axes through when nothing else is held', () => {
    const im = new InputManager();
    im.attachTouch(touch({ steer: -0.6, throttle: 0.9, brake: 0, drift: true }));
    const s = im.update();
    expect(s.steer).toBeCloseTo(-0.6);
    expect(s.throttle).toBeCloseTo(0.9);
    expect(s.drift).toBe(true);
    im.dispose();
  });

  it('keyboard throttle wins over weaker touch throttle (max merge)', () => {
    const im = new InputManager();
    im.attachTouch(touch({ throttle: 0.5 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(im.update().throttle).toBe(1);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    im.dispose();
  });

  it('item held across two frames produces exactly one useItem edge', () => {
    const im = new InputManager();
    const t = touch();
    im.attachTouch(t);
    t.set({ item: true });
    expect(im.update().useItem).toBe(true);
    expect(im.update().useItem).toBe(false);
    expect(im.update().useItemHeld).toBe(true);
    t.set({ item: false });
    expect(im.update().useItemHeld).toBe(false);
    im.dispose();
  });

  it('pause held produces one edge', () => {
    const im = new InputManager();
    const t = touch({ pause: true });
    im.attachTouch(t);
    expect(im.update().pause).toBe(true);
    expect(im.update().pause).toBe(false);
    im.dispose();
  });

  it('detaching touch clears its contribution', () => {
    const im = new InputManager();
    im.attachTouch(touch({ throttle: 1 }));
    expect(im.update().throttle).toBe(1);
    im.attachTouch(null);
    expect(im.update().throttle).toBe(0);
    im.dispose();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- InputManager`
Expected: FAIL — `im.attachTouch is not a function`.

- [ ] **Step 3: 구현**

`src/kart/InputManager.ts` 수정.

(a) import 줄 교체:
```ts
import { createEmptyInput, type InputState, type TouchInputSource } from '../core/types';
```

(b) 필드 추가 (`private disposed = false;` 아래):
```ts
  private touch: TouchInputSource | null = null;
  private prevTouchItem = false;
  private prevTouchPause = false;
```

(c) `get hasGamepad()` 아래에 메서드 추가:
```ts
  /** Attach (or detach with null) a virtual touch controller. Its values are merged in update(). */
  attachTouch(source: TouchInputSource | null): void {
    this.touch = source;
    this.prevTouchItem = false;
    this.prevTouchPause = false;
  }
```

(d) `update()`의 `// --- compose ---` 블록을 다음으로 교체:
```ts
    // --- touch ---------------------------------------------------------------
    const tc = this.touch;
    const tcThrottle = tc ? clamp(tc.throttle, 0, 1) : 0;
    const tcBrake = tc ? clamp(tc.brake, 0, 1) : 0;
    const tcSteer = tc ? clamp(tc.steer, -1, 1) : 0;
    const tcDrift = tc ? tc.drift : false;
    const tcItem = tc ? tc.item : false;
    const tcPause = tc ? tc.pause : false;
    const tcItemEdge = tcItem && !this.prevTouchItem;
    const tcPauseEdge = tcPause && !this.prevTouchPause;
    this.prevTouchItem = tcItem;
    this.prevTouchPause = tcPause;

    // --- compose -----------------------------------------------------------------
    s.throttle = Math.max(kbThrottle, padThrottle, tcThrottle);
    s.brake = Math.max(kbBrake, padBrake, tcBrake);
    const digitalSteer = clamp(this.keyboardSteer + padSteer, -1, 1);
    s.steer = Math.abs(tcSteer) > Math.abs(digitalSteer) ? tcSteer : digitalSteer;
    s.drift = this.anyHeld(KEY_DRIFT) || buttons[PAD_A] || buttons[PAD_RB] || tcDrift;
    s.useItemHeld = this.anyHeld(KEY_ITEM) || buttons[PAD_X] || buttons[PAD_LB] || tcItem;
    s.lookBack = this.anyHeld(KEY_LOOKBACK) || buttons[PAD_Y];

    s.useItem = this.anyPressed(KEY_ITEM) || padEdge(PAD_X) || padEdge(PAD_LB) || tcItemEdge;
    s.pause = this.anyPressed(KEY_PAUSE) || padEdge(PAD_START) || tcPauseEdge;
```
(그 아래 `s.confirm = ...`부터는 그대로 둔다.)

(e) `dispose()` 끝에 `this.touch = null;` 추가.

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: 모든 테스트 passed (math 2 + touchMath 5 + InputManager 5).

Run: `npm run typecheck`
Expected: 클린.

- [ ] **Step 5: Commit**

```bash
git add src/kart/InputManager.ts src/kart/InputManager.test.ts
git commit -m "feat(touch): InputManager.attachTouch merges a TouchInputSource with edge derivation"
```

---

### Task 1.4: TouchControls DOM 오버레이 + CSS

**Files:**
- Create: `src/ui/TouchControls.ts`
- Modify: `src/style.css` (파일 끝에 추가)

- [ ] **Step 1: TouchControls.ts 작성**

```ts
/**
 * Virtual touch controller: floating stick on the left half (12 o'clock = throttle,
 * 6 o'clock = brake, x = steer), DRIFT / ITEM buttons on the right, pause top-left.
 * Pure DOM; exposes held state via TouchInputSource for InputManager to merge.
 */
import type { TouchInputSource } from '../core/types';
import { el } from './dom';
import { stickToAxes } from './touchMath';

const STICK_RADIUS = 60;
const STICK_DEADZONE = 0.12;

export class TouchControls implements TouchInputSource {
  steer = 0;
  throttle = 0;
  brake = 0;
  drift = false;
  item = false;
  pause = false;

  private readonly rootNode: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly driftBtn: HTMLElement;
  private readonly itemBtn: HTMLElement;
  private readonly pauseBtn: HTMLElement;
  private stickPointer: number | null = null;
  private baseX = 0;
  private baseY = 0;
  private readonly buttonPointers = new Map<number, 'drift' | 'item' | 'pause'>();
  private enabled = false;

  constructor(root: HTMLElement) {
    this.rootNode = el('div', 'touch-controls', undefined, root);

    const zone = el('div', 'touch-stick-zone', undefined, this.rootNode);
    this.stick = el('div', 'touch-stick hidden', undefined, zone);
    el('div', 'touch-stick-ring', undefined, this.stick);
    this.knob = el('div', 'touch-knob', undefined, this.stick);

    this.itemBtn = el('button', 'touch-btn touch-item', 'ITEM', this.rootNode);
    this.driftBtn = el('button', 'touch-btn touch-drift', 'DRIFT', this.rootNode);
    this.pauseBtn = el('button', 'touch-pause', '❚❚', this.rootNode);
    for (const b of [this.itemBtn, this.driftBtn, this.pauseBtn]) (b as HTMLButtonElement).type = 'button';

    zone.addEventListener('pointerdown', this.onStickDown);
    zone.addEventListener('pointermove', this.onStickMove);
    zone.addEventListener('pointerup', this.onStickUp);
    zone.addEventListener('pointercancel', this.onStickUp);
    zone.addEventListener('lostpointercapture', this.onStickUp);

    this.bindButton(this.driftBtn, 'drift');
    this.bindButton(this.itemBtn, 'item');
    this.bindButton(this.pauseBtn, 'pause');

    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.onVisibility);

    // Show only on touch-capable devices. `pointer: coarse` catches phones/tablets up front;
    // the one-shot touchstart catches hybrids whose primary pointer is fine.
    if (window.matchMedia?.('(pointer: coarse)').matches) this.setEnabled(true);
    window.addEventListener('touchstart', this.onFirstTouch, { passive: true, once: true });
  }

  /** Whether the device looks touch-capable (controls become visible during races). */
  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.rootNode.classList.toggle('enabled', on);
  }

  dispose(): void {
    window.removeEventListener('blur', this.releaseAll);
    window.removeEventListener('touchstart', this.onFirstTouch);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.rootNode.remove();
  }

  // ------------------------------------------------------------------ stick

  private readonly onStickDown = (e: PointerEvent): void => {
    if (this.stickPointer !== null) return;
    e.preventDefault();
    this.stickPointer = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.baseX = e.clientX;
    this.baseY = e.clientY;
    this.stick.style.left = `${this.baseX}px`;
    this.stick.style.top = `${this.baseY}px`;
    this.stick.classList.remove('hidden');
    this.applyStick(0, 0);
  };

  private readonly onStickMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    e.preventDefault();
    this.applyStick(e.clientX - this.baseX, e.clientY - this.baseY);
  };

  private readonly onStickUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickPointer) return;
    this.resetStick();
  };

  private applyStick(dx: number, dy: number): void {
    const a = stickToAxes(dx, dy, STICK_RADIUS, STICK_DEADZONE);
    this.steer = a.steer;
    this.throttle = a.throttle;
    this.brake = a.brake;
    const len = Math.hypot(dx, dy);
    const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
    this.knob.style.transform = `translate(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px)`;
  }

  private resetStick(): void {
    this.stickPointer = null;
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.stick.classList.add('hidden');
    this.knob.style.transform = '';
  }

  // ---------------------------------------------------------------- buttons

  private bindButton(node: HTMLElement, key: 'drift' | 'item' | 'pause'): void {
    const down = (e: PointerEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      node.setPointerCapture(e.pointerId);
      this.buttonPointers.set(e.pointerId, key);
      this.setButton(key, true);
    };
    const up = (e: PointerEvent): void => {
      if (this.buttonPointers.get(e.pointerId) !== key) return;
      this.buttonPointers.delete(e.pointerId);
      this.setButton(key, false);
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('lostpointercapture', up);
    // Buttons must not trigger the browser's synthetic click on title screens etc.
    node.addEventListener('click', (e) => e.stopPropagation());
  }

  private setButton(key: 'drift' | 'item' | 'pause', held: boolean): void {
    this[key] = held;
    const node = key === 'drift' ? this.driftBtn : key === 'item' ? this.itemBtn : this.pauseBtn;
    node.classList.toggle('held', held);
  }

  private readonly releaseAll = (): void => {
    this.resetStick();
    this.buttonPointers.clear();
    this.setButton('drift', false);
    this.setButton('item', false);
    this.setButton('pause', false);
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.releaseAll();
  };

  private readonly onFirstTouch = (): void => this.setEnabled(true);
}
```

- [ ] **Step 2: CSS 추가** (`src/style.css` 끝)

```css
/* ----------------------------------------------------------------------------
   Touch controls (visible only on touch devices while racing)
   --------------------------------------------------------------------------- */

.touch-controls {
  position: absolute;
  inset: 0;
  display: none;
  pointer-events: none;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  z-index: 20;
}
#ui[data-state='racing'] .touch-controls.enabled,
#ui[data-state='countdown'] .touch-controls.enabled,
#ui[data-state='finished'] .touch-controls.enabled {
  display: block;
}

.touch-stick-zone {
  position: absolute;
  left: 0;
  top: 18%;
  bottom: 0;
  width: 45%;
  pointer-events: auto;
  touch-action: none;
}

.touch-stick {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
}
.touch-stick-ring {
  position: absolute;
  left: -60px;
  top: -60px;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35);
  background: rgba(16, 17, 38, 0.35);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
}
.touch-knob {
  position: absolute;
  left: -26px;
  top: -26px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #ffffff 0%, var(--blue) 60%, var(--magenta) 100%);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
}

.touch-btn {
  position: absolute;
  right: calc(18px + env(safe-area-inset-right, 0px));
  pointer-events: auto;
  touch-action: none;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-radius: 50%;
  background: rgba(16, 17, 38, 0.55);
  color: var(--ink);
  font-family: var(--display);
  font-size: 15px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 80ms var(--ease-out), background 80ms;
}
.touch-btn.held {
  transform: scale(0.92);
  background: rgba(55, 168, 255, 0.55);
}
.touch-drift {
  bottom: calc(22px + env(safe-area-inset-bottom, 0px));
  width: 104px;
  height: 104px;
  font-size: 18px;
}
.touch-item {
  bottom: calc(146px + env(safe-area-inset-bottom, 0px));
  right: calc(52px + env(safe-area-inset-right, 0px));
  width: 78px;
  height: 78px;
}

.touch-pause {
  position: absolute;
  left: calc(12px + env(safe-area-inset-left, 0px));
  top: calc(12px + env(safe-area-inset-top, 0px));
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(16, 17, 38, 0.55);
  color: var(--ink);
  font-size: 14px;
  pointer-events: auto;
  touch-action: none;
  cursor: pointer;
}
.touch-pause.held {
  background: rgba(55, 168, 255, 0.55);
}
```

**주의:** HUD의 아이템 슬롯이 좌상단(`.hud-item`)에 있다. ⏸ 버튼과 겹치면 `.touch-pause`의 `left`를 `calc(96px + env(safe-area-inset-left, 0px))`로 옮긴다(Task 1.5 브라우저 확인에서 판단).

- [ ] **Step 3: 타입체크**

Run: `npm run typecheck`
Expected: 클린. (아직 아무 데서도 import하지 않으므로 빌드 출력엔 포함 안 됨.)

- [ ] **Step 4: Commit**

```bash
git add src/ui/TouchControls.ts src/style.css
git commit -m "feat(touch): TouchControls DOM overlay (floating stick, DRIFT/ITEM, pause) + styles"
```

---

### Task 1.5: Game 배선 + 브라우저 검증

**Files:**
- Modify: `src/game/Game.ts`

- [ ] **Step 1: import 추가**

`src/game/Game.ts` import 블록에 (다른 `../ui/*` import 옆):
```ts
import { TouchControls } from '../ui/TouchControls';
```

- [ ] **Step 2: 필드 + 생성 + attach**

필드 선언부(`private readonly uiRoot: HTMLElement;` 아래)에:
```ts
  private readonly touch: TouchControls;
```

생성자의 `this.muteIndicator = el('div', 'mute-indicator', '🔇 MUTED', this.uiRoot);` 바로 아래에:
```ts
    this.touch = new TouchControls(this.uiRoot);
    this.input.attachTouch(this.touch);
```

- [ ] **Step 3: dispose**

`dispose()`에서 `this.input.dispose();` 바로 위에:
```ts
    this.input.attachTouch(null);
    this.touch.dispose();
```

- [ ] **Step 4: 타입체크 + 빌드**

Run: `npm run typecheck && npm run build`
Expected: 둘 다 클린. `dist/` 생성.

- [ ] **Step 5: 브라우저 검증 (모바일 뷰포트)**

1. 프리뷰 `turbo-kart-rush` 시작(이미 떠 있으면 reload).
2. `resize_window` preset `mobile` (375×812) → 페이지 reload (모바일 프리셋이 터치 에뮬레이션을 켬 → `pointer: coarse` 매치).
3. 타이틀 탭 → 캐릭터 탭 → CONTINUE → START RACE. 로딩 후 카운트다운.
4. `read_page`로 `.touch-controls.enabled`가 존재하고 DRIFT/ITEM/⏸ 버튼이 있는지 확인.
5. `javascript_tool`: `getComputedStyle(document.querySelector('.touch-controls')).display` → `"block"`.
6. 왼쪽 하단(예: 90, 620)에서 위로 드래그(`left_click_drag` 90,620 → 90,540) 후 `window.__turboKartRush.touch.throttle` 값이 > 0.5 였는지 확인하기 어려우면, `javascript_tool`로 합성 포인터 이벤트를 쏘아 확인:
   ```js
   const z = document.querySelector('.touch-stick-zone');
   const ev = (t, x, y) => z.dispatchEvent(new PointerEvent(t, { pointerId: 7, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: true }));
   ev('pointerdown', 90, 620); ev('pointermove', 60, 560);
   const g = window.__turboKartRush; ({ throttle: g.touch.throttle, steer: g.touch.steer })
   ```
   Expected: throttle ≈ 1, steer ≈ −0.5. 이어서 `ev('pointerup', 60, 560)` 후 둘 다 0.
7. 스크린샷으로 스틱 링/노브·버튼 배치 확인. ⏸가 HUD 아이템 슬롯과 겹치면 Task 1.4 주의사항대로 CSS 조정.
8. `resize_window` preset `desktop` + reload → 데스크톱에서는 `.touch-controls`가 `display: none`인지 확인.
9. 콘솔 에러 0건 확인.

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.ts src/style.css
git commit -m "feat(touch): wire TouchControls into Game/InputManager, visible during races on touch devices"
```

---

# Part 2 — 새 트랙 2개

빌더 지원 현황(변경 없음): `beach` 지형 프리셋 hills 10(완만) + 타이어 배리어 + 장식/랜드마크는 grassland 기본값(나무·풍차·풍선). `volcano` 지형 hills 30(험준) + 사암 배리어 + 장식/랜드마크는 desert 분기(선인장·메사). 시각 차별화는 `palette`/`environment`로 낸다.

### Task 2.1: 트랙 검증 테스트 + Coral Coast

**Files:**
- Test: `src/track/tracks/tracks.test.ts`
- Create: `src/track/tracks/coralCoast.ts`

- [ ] **Step 1: 실패 테스트**

`src/track/tracks/tracks.test.ts`:
```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { TrackDefinition } from '../../core/types';
import { coralCoast } from './coralCoast';
import { magmaRidge } from './magmaRidge';
import { validateTrackDefinition } from './validate';

function lengthOf(def: TrackDefinition): number {
  const pts = def.controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  curve.arcLengthDivisions = 1000;
  return curve.getLength();
}

describe.each([
  ['coral_coast', coralCoast, 'beach', 2],
  ['magma_ridge', magmaRidge, 'volcano', 3],
] as const)('%s', (id, def, theme, difficulty) => {
  it('has the expected identity', () => {
    expect(def.id).toBe(id);
    expect(def.theme).toBe(theme);
    expect(def.difficulty).toBe(difficulty);
    expect(def.laps).toBe(3);
  });
  it('passes the geometry validator', () => {
    expect(validateTrackDefinition(def)).toEqual([]);
  });
  it('is 900..1400 m long', () => {
    const L = lengthOf(def);
    expect(L).toBeGreaterThan(900);
    expect(L).toBeLessThan(1400);
  });
  it('places item rows and pads inside [0,1) with 4 rows / 3 pads', () => {
    expect(def.itemBoxRows).toHaveLength(4);
    expect(def.boostPads).toHaveLength(3);
    for (const t of [...def.itemBoxRows, ...def.boostPads]) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- tracks`
Expected: FAIL — `Cannot find module './coralCoast'`.

- [ ] **Step 3: coralCoast.ts 작성**

(좌표는 `validate.ts` 알고리즘으로 사전 검증됨: 길이 1157 m, 최소 반경 10.7 m, 근접비 0.98, 고도차 2.5 m.)

```ts
import type { TrackDefinition } from '../../core/types';

/**
 * Coral Coast - sunny seaside boulevard.
 * Shoreline start straight -> right sweep off the beach -> sandy S-bend -> back right toward
 * the pier -> long pier straight -> stadium U-turn -> small dune hump -> twisty inland return ->
 * final left back onto the shoreline. Wide sand run-offs tempt you to cut, but sand is slow.
 * ~1150 m.
 */
export const coralCoast: TrackDefinition = {
  id: 'coral_coast',
  name: 'Coral Coast',
  theme: 'beach',
  laps: 3,
  description: 'Seaside sweepers, a flat-out pier straight and soft sand that swallows anyone who cuts the corner.',
  difficulty: 2,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line, shoreline straight
    { x: 0, y: 0, z: -75 },
    { x: 0, y: 0.5, z: -150 },
    { x: 14, y: 1, z: -188 }, // right sweep off the beach
    { x: 50, y: 1.5, z: -212 },
    { x: 96, y: 1.5, z: -212 }, // beach S-bend
    { x: 132, y: 1, z: -186 },
    { x: 150, y: 0.5, z: -148 },
    { x: 178, y: 0.5, z: -116 }, // S: back right toward the pier
    { x: 214, y: 0.5, z: -92 },
    { x: 232, y: 0.5, z: -52 },
    { x: 232, y: 0.5, z: 30 }, // pier straight
    { x: 232, y: 0.5, z: 96 },
    { x: 210, y: 0.5, z: 132 }, // stadium U-turn
    { x: 168, y: 0.5, z: 132 },
    { x: 146, y: 1, z: 96 },
    { x: 146, y: 2.5, z: 44 }, // dune hump
    { x: 128, y: 1, z: 10 }, // twisty inland return
    { x: 92, y: 0.5, z: 0 },
    { x: 62, y: 0.5, z: 30 },
    { x: 50, y: 0, z: 72 },
    { x: 28, y: 0, z: 104 }, // final left onto the shoreline
    { x: -2, y: 0, z: 84 },
  ],
  halfWidth: 8.5,
  halfWidths: [9, 9, 9, 8.5, 8.5, 8.5, 8.5, 8.5, 8.5, 8.5, 9, 9, 9, 9, 9, 8.5, 8, 8, 8, 8, 8.5, 9, 9],
  wallHalfWidthFactor: 1.7,
  itemBoxRows: [0.1, 0.36, 0.56, 0.8],
  boostPads: [0.27, 0.5, 0.9],
  environment: {
    skyTop: 0x1f7fd6,
    skyHorizon: 0xa8e4ff,
    skyBottom: 0xf2fbff,
    fogColor: 0xd6f1ff,
    fogDensity: 0.0014,
    sunColor: 0xfff6dc,
    sunIntensity: 2.8,
    sunDirection: { x: -0.35, y: 0.82, z: 0.45 },
    ambientSky: 0xa9dcff,
    ambientGround: 0xc9b58a,
    ambientIntensity: 0.95,
  },
  palette: {
    road: 0x5b5a5e,
    roadStripe: 0xfaf6e6,
    curb: 0xff6f61,
    curbAlt: 0xfffdf5,
    offroad: 0xe8d3a0,
    wall: 0x3a3a40,
    ground: 0xdcc48f,
  },
};
```

- [ ] **Step 4: 부분 통과 확인**

Run: `npm test -- tracks`
Expected: 여전히 FAIL — 이제 `Cannot find module './magmaRidge'`. (coralCoast 자체 import는 성공.)

---

### Task 2.2: Magma Ridge

**Files:**
- Create: `src/track/tracks/magmaRidge.ts`

- [ ] **Step 1: magmaRidge.ts 작성**

(사전 검증: 길이 1392 m, 최소 반경 13.6 m, 근접비 1.02, 고도차 14.1 m. 컨트롤포인트 t값: 용암 둑길 1 = cp12(t≈0.39)~cp13(0.48), 둑길 2 = cp16(0.578)~cp17(0.708).)

```ts
import type { TrackDefinition } from '../../core/types';

/**
 * Magma Ridge - volcanic caldera rim.
 * Valley start straight -> long climbing right sweeper -> ridge crest jump (14 m up) ->
 * plunging descent into a left hairpin -> lava causeway with NO barriers (void!) ->
 * 180 degree sweep -> long straight over a second lava bridge (void) -> flowing S-bend ->
 * hairpin descent back to the valley -> final straight. ~1400 m.
 */
export const magmaRidge: TrackDefinition = {
  id: 'magma_ridge',
  name: 'Magma Ridge',
  theme: 'volcano',
  laps: 3,
  description: 'Climb the caldera, jump the ridge, then thread two lava bridges with nothing to stop you falling in.',
  difficulty: 3,
  controlPoints: [
    { x: 0, y: 0, z: 0 }, // 0 finish line, valley straight
    { x: 0, y: 0, z: -90 },
    { x: 0, y: 1, z: -170 },
    { x: 20, y: 3, z: -214 }, // climbing right sweeper
    { x: 64, y: 6, z: -236 },
    { x: 116, y: 9, z: -236 },
    { x: 150, y: 12, z: -206 }, // ridge crest (jump)
    { x: 158, y: 14, z: -160 },
    { x: 150, y: 10, z: -118 }, // plunging descent
    { x: 168, y: 7, z: -96 }, // hairpin (left)
    { x: 194, y: 7, z: -96 },
    { x: 206, y: 6, z: -120 },
    { x: 214, y: 4, z: -190 }, // lava causeway 1 (void)
    { x: 250, y: 3, z: -230 },
    { x: 296, y: 3, z: -196 }, // 180 degree sweep
    { x: 296, y: 3, z: -120 },
    { x: 296, y: 3, z: -30 }, // long straight, lava bridge 2 (void)
    { x: 296, y: 2, z: 60 },
    { x: 272, y: 1.5, z: 98 }, // S-bend
    { x: 224, y: 1.5, z: 98 },
    { x: 176, y: 1, z: 66 },
    { x: 128, y: 0.5, z: 66 },
    { x: 96, y: 0, z: 96 }, // hairpin descent to the valley
    { x: 60, y: 0, z: 96 },
    { x: 30, y: 0, z: 70 },
    { x: 0, y: 0, z: 40 }, // onto the final straight
  ],
  halfWidth: 8,
  halfWidths: [8.5, 8.5, 8.5, 8, 8, 8, 8, 8.5, 8, 8.5, 8.5, 8, 7, 7, 8, 8, 7, 7.5, 8, 8, 8, 8, 8.5, 8.5, 8.5, 8.5],
  wallHalfWidthFactor: 1.35,
  itemBoxRows: [0.09, 0.28, 0.54, 0.8],
  boostPads: [0.24, 0.52, 0.86],
  voidRanges: [
    [0.4, 0.47],
    [0.6, 0.68],
  ],
  environment: {
    skyTop: 0x1a0b12,
    skyHorizon: 0xff6a2a,
    skyBottom: 0xffb27a,
    fogColor: 0xc4471f,
    fogDensity: 0.0028,
    sunColor: 0xffa060,
    sunIntensity: 1.9,
    sunDirection: { x: 0.62, y: 0.3, z: -0.72 },
    ambientSky: 0xff8a50,
    ambientGround: 0x3a1a12,
    ambientIntensity: 0.8,
  },
  palette: {
    road: 0x3a3236,
    roadStripe: 0xffd27a,
    curb: 0xff4a1f,
    curbAlt: 0x2a2224,
    offroad: 0x4a2c24,
    wall: 0x5a3a30,
    ground: 0x2c1a16,
  },
};
```

- [ ] **Step 2: 통과 확인**

Run: `npm test -- tracks`
Expected: 8 passed (2 트랙 × 4).

- [ ] **Step 3: Commit**

```bash
git add src/track/tracks/coralCoast.ts src/track/tracks/magmaRidge.ts src/track/tracks/tracks.test.ts
git commit -m "feat(track): add Coral Coast (beach, 2 stars) and Magma Ridge (volcano, 3 stars, lava voids)"
```

---

### Task 2.3: 트랙 목록 등록 + 선택 UI 3×2

**Files:**
- Modify: `src/track/tracks/index.ts`
- Modify: `src/style.css:592-594`

- [ ] **Step 1: index.ts 교체**

```ts
import type { TrackDefinition } from '../../core/types';
import { sunnyCircuit } from './sunnyCircuit';
import { coralCoast } from './coralCoast';
import { duneDrift } from './duneDrift';
import { frostbiteFalls } from './frostbiteFalls';
import { neonNexus } from './neonNexus';
import { magmaRidge } from './magmaRidge';
import { validateAllTracks } from './validate';

export { sunnyCircuit, coralCoast, duneDrift, frostbiteFalls, neonNexus, magmaRidge };

/** The six race tracks, in menu order (easy -> hard). */
export const TRACKS: TrackDefinition[] = [sunnyCircuit, coralCoast, duneDrift, frostbiteFalls, neonNexus, magmaRidge];

/** Look up a track by id; falls back to the first track for unknown ids. */
export function getTrackDef(id: string): TrackDefinition {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

if (import.meta.env.DEV) {
  validateAllTracks(TRACKS);
}
```

- [ ] **Step 2: CSS 그리드**

`src/style.css`의
```css
.track-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
```
를
```css
.track-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
@media (max-width: 700px) {
  .track-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```
로 교체. 카드가 세로로 넘치면 `.track-card .card-tag`에 `display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;`을 추가한다.

- [ ] **Step 3: 타입체크·빌드**

Run: `npm run typecheck && npm run build && npm test`
Expected: 모두 클린/통과.

- [ ] **Step 4: 브라우저 검증**

1. 프리뷰 reload → 콘솔에 `[track]` 경고가 **없어야** 한다(DEV 검증 통과).
2. 트랙 선택 화면 스크린샷: 카드 6개 3×2, 순서 Sunny·Coral·Dune·Frostbite·Neon·Magma, 별 개수 1·2·2·2·3·3.
3. Coral Coast 선택 → START → 로딩 완료 → 1랩 주행(`?auto=1`로 AI 자동주행 가능: `http://localhost:5178/?auto=1`). 모래(오프로드) 색·바다색 안개·타이어 배리어 확인. 콘솔 에러 0.
4. Magma Ridge 동일. 용암 둑길 구간(t 0.40~0.47, 0.60~0.68)에서 도로 밖이 void인지: 미니맵/화면에서 배리어가 없는지 확인. `?auto=1`로 AI가 완주하는지(void 리스폰이 있어도 됨) 확인.
5. 필요하면 `itemBoxRows`/`boostPads`를 코너 직전이 아닌 직선에 오도록 ±0.02 조정(테스트 범위 내).

- [ ] **Step 5: Commit**

```bash
git add src/track/tracks/index.ts src/style.css
git commit -m "feat(track): register 6 tracks, track select 3x2 grid"
```

---

# Part 3 — `balance.ts`

### Task 3.1: balance.ts + URL 오버라이드 (테스트 우선)

**Files:**
- Create: `src/core/balance.ts`
- Test: `src/core/balance.test.ts`

- [ ] **Step 1: 실패 테스트**

`src/core/balance.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BALANCE, applyBalanceOverrides, createDefaultBalance } from './balance';

describe('balance', () => {
  it('defaults match the original tuning', () => {
    expect(BALANCE.kart.accelBase).toBe(9);
    expect(BALANCE.drift.boostDurations).toEqual([0, 0.7, 1.2, 1.8]);
    expect(BALANCE.items.greenSpeed).toBe(34);
    expect(BALANCE.itemTable[0].banana).toBe(35);
    expect(BALANCE.ai.profiles.hard.releaseStage).toBe(3);
    expect(BALANCE.race.finishGraceSeconds).toBe(12);
  });

  it('applies numeric overrides from b.<path> params', () => {
    const b = createDefaultBalance();
    const warnings = applyBalanceOverrides(b, new URLSearchParams('b.kart.accelBase=11&b.ai.profiles.easy.noise=0.2'));
    expect(warnings).toEqual([]);
    expect(b.kart.accelBase).toBe(11);
    expect(b.ai.profiles.easy.noise).toBe(0.2);
  });

  it('ignores unknown paths, non-numeric targets and bad values, reporting each', () => {
    const b = createDefaultBalance();
    const warnings = applyBalanceOverrides(
      b,
      new URLSearchParams('b.kart.nope=1&b.ai.profiles.easy.usesMushrooms=1&b.kart.accelBase=abc&unrelated=5'),
    );
    expect(b.kart.accelBase).toBe(9);
    expect(b.ai.profiles.easy.usesMushrooms).toBe(false);
    expect(warnings).toHaveLength(3);
  });

  it('does not mutate the shared BALANCE when a copy is edited', () => {
    const b = createDefaultBalance();
    b.kart.accelBase = 99;
    expect(BALANCE.kart.accelBase).toBe(9);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- balance`
Expected: FAIL — `Cannot find module './balance'`.

- [ ] **Step 3: balance.ts 작성**

```ts
/**
 * Contract addition: every "feel" tuning constant in one place. Values are the ORIGINAL
 * tuning copied verbatim from Kart.ts / ItemManager.ts / AIDriver.ts / RaceManager.ts.
 *
 * Runtime override: `?b.kart.accelBase=11&b.ai.profiles.easy.noise=0.2` (numbers only) via
 * `applyBalanceOverrides`, or edit `window.__balance` in the console. Modules read these
 * properties every frame, so most edits apply immediately. Exceptions (captured once):
 *   - ai.profiles.*  -> captured in the AIDriver constructor: applies from the next race.
 *   - itemTable      -> read per roulette: immediate.
 */
import type { Difficulty, ItemType } from './types';

export interface DifficultyProfile {
  /** Steering noise amplitude (rad). */
  noise: number;
  /** Reaction delay range (s) before responding to hazards / items. */
  reactionMin: number;
  reactionMax: number;
  /** Corner curvature (|turn| rad over the lookahead) above which the AI drifts. */
  driftThreshold: number;
  /** Mini-turbo stage at which the AI releases a drift. */
  releaseStage: 1 | 2 | 3;
  /** Lateral acceleration (m/s^2) the AI is willing to carry before braking. */
  brakeLatAccel: number;
  /** Throttle used while easing through tight corners. */
  easeThrottle: number;
  usesMushrooms: boolean;
  /** Seconds before GO the AI floors it (rocket-start timing). */
  startThrottleBeforeGo: number;
  /** Rubber-band: topSpeed factor = clamp(base + amp * tanh(gapMetres / scale), min, max). */
  rubber: { base: number; amp: number; scale: number; min: number; max: number };
}

export type ItemWeightRow = Partial<Record<ItemType, number>>;

export interface Balance {
  kart: {
    /** m/s^2 at (0.5 + acceleration stat) = 1. Medium kart 0 -> 95% top in ~2.5 s. */
    accelBase: number;
    /** Proportional approach toward target speed (1/s). */
    accelApproach: number;
    /** Acceleration cap / approach while boosting (~95% of boosted top in ~0.3 s). */
    boostAccel: number;
    boostApproach: number;
    /** Deceleration when above top speed (m/s^2) and its approach rate. */
    overSpeedDecelMax: number;
    overSpeedApproach: number;
    brakeDecel: number;
    coastDecel: number;
    /** Reverse top speed as a fraction of forward top speed; reverse acceleration. */
    reverseFraction: number;
    reverseAccel: number;
    /** Full-lock yaw rate (rad/s) before handling/speed scaling. */
    steerRate: number;
    driftSteerRate: number;
    hopVelocity: number;
    lateralGripRoad: number;
    lateralGripOffroad: number;
    wallRestitution: number;
  };
  drift: {
    /** Seconds after a hop before a held drift engages. */
    hopDriftDelay: number;
    /** Min speed (fraction of top) to start / keep a drift. */
    minSpeed: number;
    keepSpeed: number;
    /** Max angle (rad) the velocity lags the heading while drifting. */
    slipMax: number;
    /** Top-speed multiplier while drifting. */
    speedFactor: number;
    /** Drift seconds needed to reach stage 1/2/3. */
    stageThresholds: number[];
    /** Boost seconds released per stage [none, 1, 2, 3]. */
    boostDurations: number[];
    boostStrength: number;
  };
  status: {
    spinDuration: number;
    /** Top-speed multipliers. */
    offroadFactor: number;
    shrunkFactor: number;
    starFactor: number;
    squishFactor: number;
  };
  items: {
    /** Projectile speeds (m/s) and lifetimes (s). */
    greenSpeed: number;
    redSpeed: number;
    blueSpeed: number;
    greenLife: number;
    redLife: number;
    bananaLife: number;
    bombFuse: number;
    explosionRadius: number;
    /** Seconds before another lightning can be rolled. */
    lightningCooldown: number;
    /** Min seconds between golden mushroom bursts. */
    goldenMinSpacing: number;
    /** Seconds a freshly thrown hazard ignores its owner. */
    ownerGrace: number;
  };
  /** Place-weighted roulette table, index = place - 1. */
  itemTable: ItemWeightRow[];
  ai: {
    profiles: Record<Difficulty, DifficultyProfile>;
    /** PD steering gains. */
    kP: number;
    kD: number;
    /** Racing-line lookahead (m), clamped from speed * 0.9. */
    lookaheadMin: number;
    lookaheadMax: number;
    hazardLookahead: number;
    boxSeekDistance: number;
  };
  race: {
    /** Rocket start: throttle within this many seconds after GO = strong boost, weak window = small boost. */
    startBoostWindow: number;
    startBoostWeakWindow: number;
    /** Holding throttle this long before GO = spin out. */
    startSpinoutHold: number;
    wrongWaySeconds: number;
    stuckSeconds: number;
    /** After the player finishes, keep simulating AI for at most this long. */
    finishGraceSeconds: number;
  };
}

export function createDefaultBalance(): Balance {
  return {
    kart: {
      accelBase: 9.0,
      accelApproach: 2.2,
      boostAccel: 45,
      boostApproach: 7,
      overSpeedDecelMax: 10,
      overSpeedApproach: 2.0,
      brakeDecel: 16,
      coastDecel: 4.5,
      reverseFraction: 0.35,
      reverseAccel: 5,
      steerRate: 1.9,
      driftSteerRate: 1.9,
      hopVelocity: 4.5,
      lateralGripRoad: 8,
      lateralGripOffroad: 4,
      wallRestitution: 0.3,
    },
    drift: {
      hopDriftDelay: 0.15,
      minSpeed: 0.45,
      keepSpeed: 0.3,
      slipMax: 0.49,
      speedFactor: 0.965,
      stageThresholds: [1.0, 2.0, 3.2],
      boostDurations: [0, 0.7, 1.2, 1.8],
      boostStrength: 0.4,
    },
    status: {
      spinDuration: 1.1,
      offroadFactor: 0.55,
      shrunkFactor: 0.65,
      starFactor: 1.2,
      squishFactor: 0.5,
    },
    items: {
      greenSpeed: 34,
      redSpeed: 30,
      blueSpeed: 45,
      greenLife: 9,
      redLife: 8,
      bananaLife: 40,
      bombFuse: 2.5,
      explosionRadius: 4,
      lightningCooldown: 20,
      goldenMinSpacing: 0.25,
      ownerGrace: 0.35,
    },
    itemTable: [
      // 1st
      { banana: 35, green_shell: 35, triple_banana: 10, bob_omb: 5, red_shell: 15 },
      // 2nd
      { banana: 22, green_shell: 26, red_shell: 22, triple_green_shell: 12, mushroom: 10, bob_omb: 8 },
      // 3rd
      { banana: 16, green_shell: 22, red_shell: 26, triple_green_shell: 14, mushroom: 14, bob_omb: 8 },
      // 4th
      { red_shell: 26, triple_red_shell: 14, mushroom: 26, triple_mushroom: 14, bob_omb: 12, star: 8 },
      // 5th
      { red_shell: 22, triple_red_shell: 16, mushroom: 22, triple_mushroom: 18, bob_omb: 12, star: 10 },
      // 6th
      { triple_mushroom: 28, star: 20, red_shell: 15, lightning: 10, golden_mushroom: 22, triple_red_shell: 5 },
      // 7th
      { star: 22, lightning: 13, golden_mushroom: 24, blue_shell: 12, triple_mushroom: 19, triple_red_shell: 10 },
      // 8th
      { star: 22, lightning: 17, golden_mushroom: 22, blue_shell: 16, triple_mushroom: 15, triple_red_shell: 8 },
    ],
    ai: {
      profiles: {
        easy: {
          noise: 0.09,
          reactionMin: 1.0,
          reactionMax: 1.5,
          driftThreshold: 0.45,
          releaseStage: 1,
          brakeLatAccel: 34,
          easeThrottle: 0.6,
          usesMushrooms: false,
          startThrottleBeforeGo: 0.55,
          rubber: { base: 0.86, amp: 0.06, scale: 120, min: 0.82, max: 0.96 },
        },
        normal: {
          noise: 0.045,
          reactionMin: 0.6,
          reactionMax: 1.0,
          driftThreshold: 0.35,
          releaseStage: 2,
          brakeLatAccel: 46,
          easeThrottle: 0.65,
          usesMushrooms: true,
          startThrottleBeforeGo: 0.45,
          rubber: { base: 0.94, amp: 0.05, scale: 100, min: 0.9, max: 1.0 },
        },
        hard: {
          noise: 0.015,
          reactionMin: 0.4,
          reactionMax: 0.6,
          driftThreshold: 0.3,
          releaseStage: 3,
          brakeLatAccel: 62,
          easeThrottle: 0.75,
          usesMushrooms: true,
          startThrottleBeforeGo: 0.3,
          rubber: { base: 0.985, amp: 0.02, scale: 150, min: 0.97, max: 1.0 },
        },
      },
      kP: 2.2,
      kD: 0.15,
      lookaheadMin: 8,
      lookaheadMax: 30,
      hazardLookahead: 25,
      boxSeekDistance: 60,
    },
    race: {
      startBoostWindow: 0.6,
      startBoostWeakWindow: 1.2,
      startSpinoutHold: 2.6,
      wrongWaySeconds: 1.2,
      stuckSeconds: 6,
      finishGraceSeconds: 12,
    },
  };
}

/** The live tuning object every subsystem reads from. */
export const BALANCE: Balance = createDefaultBalance();

/**
 * Apply `b.<dot.path>=<number>` query params onto `target`. Only existing numeric leaves are
 * changed. Returns human-readable warnings for anything skipped.
 */
export function applyBalanceOverrides(target: Balance, params: URLSearchParams): string[] {
  const warnings: string[] = [];
  params.forEach((raw, key) => {
    if (!key.startsWith('b.')) return;
    const path = key.slice(2).split('.');
    let node: unknown = target;
    for (let i = 0; i < path.length - 1; i++) {
      if (node === null || typeof node !== 'object' || !(path[i] in (node as object))) {
        warnings.push(`${key}: unknown path`);
        return;
      }
      node = (node as Record<string, unknown>)[path[i]];
    }
    const leaf = path[path.length - 1];
    if (node === null || typeof node !== 'object' || typeof (node as Record<string, unknown>)[leaf] !== 'number') {
      warnings.push(`${key}: not a numeric balance value`);
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      warnings.push(`${key}: '${raw}' is not a number`);
      return;
    }
    (node as Record<string, number>)[leaf] = value;
  });
  return warnings;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- balance`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/balance.ts src/core/balance.test.ts
git commit -m "feat(balance): single BALANCE tuning object with URL overrides (values unchanged)"
```

---

### Task 3.2: Kart.ts → BALANCE 참조

**Files:**
- Modify: `src/kart/Kart.ts:28-69`

- [ ] **Step 1: import 추가**

```ts
import { BALANCE } from '../core/balance';
```

- [ ] **Step 2: 상수 블록 교체**

`// --- tuning ---` 아래의 다음 선언들을 **삭제**한다: `ACCEL_BASE, ACCEL_APPROACH, BOOST_ACCEL, BOOST_APPROACH, OVER_SPEED_DECEL_MAX, OVER_SPEED_APPROACH, BRAKE_DECEL, COAST_DECEL, REVERSE_FRACTION, REVERSE_ACCEL, STEER_RATE, DRIFT_STEER_RATE, HOP_VELOCITY, HOP_DRIFT_DELAY, DRIFT_MIN_SPEED, DRIFT_KEEP_SPEED, DRIFT_SLIP_MAX, DRIFT_SPEED_FACTOR, DRIFT_STAGE_THRESHOLDS, DRIFT_BOOST_DURATIONS, DRIFT_BOOST_STRENGTH, SPIN_DURATION, LATERAL_GRIP_ROAD, LATERAL_GRIP_OFFROAD, WALL_RESTITUTION, OFFROAD_FACTOR, SHRUNK_FACTOR, STAR_FACTOR, SQUISH_FACTOR`.

**남기는 것**: `WALL_MARGIN`, `GROUND_STICK`, `GROUND_LAUNCH_VY`, `ACCENT_EMISSIVE`, `DRIFT_STAGE_COLORS` (시각/물리 안정성 상수).

그 자리에 짧은 별칭 두 개를 둔다:
```ts
// Tuning lives in src/core/balance.ts (read every frame so console edits apply live).
const B = BALANCE;
```

- [ ] **Step 3: 사용처 치환**

파일 전체에서 아래 매핑으로 치환한다 (sed 가능; 단어 경계 주의):

| 기존 | 신규 |
|---|---|
| `ACCEL_BASE` | `B.kart.accelBase` |
| `ACCEL_APPROACH` | `B.kart.accelApproach` |
| `BOOST_ACCEL` | `B.kart.boostAccel` |
| `BOOST_APPROACH` | `B.kart.boostApproach` |
| `OVER_SPEED_DECEL_MAX` | `B.kart.overSpeedDecelMax` |
| `OVER_SPEED_APPROACH` | `B.kart.overSpeedApproach` |
| `BRAKE_DECEL` | `B.kart.brakeDecel` |
| `COAST_DECEL` | `B.kart.coastDecel` |
| `REVERSE_FRACTION` | `B.kart.reverseFraction` |
| `REVERSE_ACCEL` | `B.kart.reverseAccel` |
| `DRIFT_STEER_RATE` | `B.kart.driftSteerRate` |
| `STEER_RATE` | `B.kart.steerRate` |
| `HOP_VELOCITY` | `B.kart.hopVelocity` |
| `HOP_DRIFT_DELAY` | `B.drift.hopDriftDelay` |
| `DRIFT_MIN_SPEED` | `B.drift.minSpeed` |
| `DRIFT_KEEP_SPEED` | `B.drift.keepSpeed` |
| `DRIFT_SLIP_MAX` | `B.drift.slipMax` |
| `DRIFT_SPEED_FACTOR` | `B.drift.speedFactor` |
| `DRIFT_STAGE_THRESHOLDS` | `B.drift.stageThresholds` |
| `DRIFT_BOOST_DURATIONS` | `B.drift.boostDurations` |
| `DRIFT_BOOST_STRENGTH` | `B.drift.boostStrength` |
| `SPIN_DURATION` | `B.status.spinDuration` |
| `LATERAL_GRIP_ROAD` | `B.kart.lateralGripRoad` |
| `LATERAL_GRIP_OFFROAD` | `B.kart.lateralGripOffroad` |
| `WALL_RESTITUTION` | `B.kart.wallRestitution` |
| `OFFROAD_FACTOR` | `B.status.offroadFactor` |
| `SHRUNK_FACTOR` | `B.status.shrunkFactor` |
| `STAR_FACTOR` | `B.status.starFactor` |
| `SQUISH_FACTOR` | `B.status.squishFactor` |

`DRIFT_STEER_RATE`를 `STEER_RATE`보다 **먼저** 치환할 것(부분 문자열). sed 예:
```bash
sed -i '' -E \
 -e 's/\bDRIFT_STEER_RATE\b/B.kart.driftSteerRate/g' \
 -e 's/\bSTEER_RATE\b/B.kart.steerRate/g' \
 -e 's/\bACCEL_BASE\b/B.kart.accelBase/g' \
 -e 's/\bACCEL_APPROACH\b/B.kart.accelApproach/g' \
 -e 's/\bBOOST_ACCEL\b/B.kart.boostAccel/g' \
 -e 's/\bBOOST_APPROACH\b/B.kart.boostApproach/g' \
 -e 's/\bOVER_SPEED_DECEL_MAX\b/B.kart.overSpeedDecelMax/g' \
 -e 's/\bOVER_SPEED_APPROACH\b/B.kart.overSpeedApproach/g' \
 -e 's/\bBRAKE_DECEL\b/B.kart.brakeDecel/g' \
 -e 's/\bCOAST_DECEL\b/B.kart.coastDecel/g' \
 -e 's/\bREVERSE_FRACTION\b/B.kart.reverseFraction/g' \
 -e 's/\bREVERSE_ACCEL\b/B.kart.reverseAccel/g' \
 -e 's/\bHOP_VELOCITY\b/B.kart.hopVelocity/g' \
 -e 's/\bHOP_DRIFT_DELAY\b/B.drift.hopDriftDelay/g' \
 -e 's/\bDRIFT_MIN_SPEED\b/B.drift.minSpeed/g' \
 -e 's/\bDRIFT_KEEP_SPEED\b/B.drift.keepSpeed/g' \
 -e 's/\bDRIFT_SLIP_MAX\b/B.drift.slipMax/g' \
 -e 's/\bDRIFT_SPEED_FACTOR\b/B.drift.speedFactor/g' \
 -e 's/\bDRIFT_STAGE_THRESHOLDS\b/B.drift.stageThresholds/g' \
 -e 's/\bDRIFT_BOOST_DURATIONS\b/B.drift.boostDurations/g' \
 -e 's/\bDRIFT_BOOST_STRENGTH\b/B.drift.boostStrength/g' \
 -e 's/\bSPIN_DURATION\b/B.status.spinDuration/g' \
 -e 's/\bLATERAL_GRIP_ROAD\b/B.kart.lateralGripRoad/g' \
 -e 's/\bLATERAL_GRIP_OFFROAD\b/B.kart.lateralGripOffroad/g' \
 -e 's/\bWALL_RESTITUTION\b/B.kart.wallRestitution/g' \
 -e 's/\bOFFROAD_FACTOR\b/B.status.offroadFactor/g' \
 -e 's/\bSHRUNK_FACTOR\b/B.status.shrunkFactor/g' \
 -e 's/\bSTAR_FACTOR\b/B.status.starFactor/g' \
 -e 's/\bSQUISH_FACTOR\b/B.status.squishFactor/g' \
 src/kart/Kart.ts
```
sed는 삭제한 `const` 선언 줄도 치환하므로(`const B.kart.accelBase = 9.0;` 같은 깨진 줄), **Step 2의 삭제를 sed 이후에** 하거나 실행 후 `grep -n "^const B\." src/kart/Kart.ts`로 잔여 줄을 지운다.

- [ ] **Step 4: 검증**

Run: `grep -nE "\b(ACCEL_BASE|STEER_RATE|OFFROAD_FACTOR|DRIFT_BOOST_STRENGTH)\b" src/kart/Kart.ts`
Expected: 출력 없음.

Run: `npm run typecheck && npm test`
Expected: 클린 / 통과.

- [ ] **Step 5: Commit**

```bash
git add src/kart/Kart.ts
git commit -m "refactor(balance): Kart.ts reads handling constants from BALANCE"
```

---

### Task 3.3: ItemManager / AIDriver / RaceManager → BALANCE

**Files:**
- Modify: `src/items/ItemManager.ts:28-49,108-127`
- Modify: `src/ai/AIDriver.ts:29-92`, speedFactor 메서드
- Modify: `src/game/RaceManager.ts:14-26`

- [ ] **Step 1: ItemManager**

import 추가: `import { BALANCE } from '../core/balance';` 그리고 `const B = BALANCE;`를 스크래치 상수 위에 둔다.

삭제: `OWNER_GRACE, LIGHTNING_COOLDOWN, GOLDEN_MIN_SPACING, GREEN_SPEED, RED_SPEED, BLUE_SPEED, GREEN_LIFE, RED_LIFE, BANANA_LIFE, BOMB_FUSE, EXPLOSION_RADIUS` 선언과 `type WeightRow`, `const ITEM_TABLE` 블록(주석 포함).
남김: `MAX_HAZARDS, BOX_*, ROULETTE_TICKS, SHELL_HEIGHT, ORBIT_*, TICK_INTERVALS`.

치환:
```bash
sed -i '' -E \
 -e 's/\bOWNER_GRACE\b/B.items.ownerGrace/g' \
 -e 's/\bLIGHTNING_COOLDOWN\b/B.items.lightningCooldown/g' \
 -e 's/\bGOLDEN_MIN_SPACING\b/B.items.goldenMinSpacing/g' \
 -e 's/\bGREEN_SPEED\b/B.items.greenSpeed/g' \
 -e 's/\bRED_SPEED\b/B.items.redSpeed/g' \
 -e 's/\bBLUE_SPEED\b/B.items.blueSpeed/g' \
 -e 's/\bGREEN_LIFE\b/B.items.greenLife/g' \
 -e 's/\bRED_LIFE\b/B.items.redLife/g' \
 -e 's/\bBANANA_LIFE\b/B.items.bananaLife/g' \
 -e 's/\bBOMB_FUSE\b/B.items.bombFuse/g' \
 -e 's/\bEXPLOSION_RADIUS\b/B.items.explosionRadius/g' \
 -e 's/\bITEM_TABLE\b/B.itemTable/g' \
 src/items/ItemManager.ts
```
이후 `grep -n "^const B\.\|^type WeightRow" src/items/ItemManager.ts`로 깨진 선언 줄을 제거. `WeightRow` 타입을 다른 곳에서 쓰면 `import type { ItemWeightRow } from '../core/balance'`로 대체.

- [ ] **Step 2: AIDriver**

import 추가: `import { BALANCE, type DifficultyProfile } from '../core/balance';`, `const B = BALANCE;`.

삭제: `K_P, K_D, LOOKAHEAD_MIN, LOOKAHEAD_MAX, HAZARD_LOOKAHEAD, BOX_SEEK_DISTANCE` 선언, `interface DifficultyProfile` 블록, `const PROFILES` 블록.
남김: `HAZARD_LATERAL, DODGE_CLEARANCE, STUCK_SECONDS, REVERSE_SECONDS, RECOVER_COOLDOWN`.

치환:
```bash
sed -i '' -E \
 -e 's/\bK_P\b/B.ai.kP/g' \
 -e 's/\bK_D\b/B.ai.kD/g' \
 -e 's/\bLOOKAHEAD_MIN\b/B.ai.lookaheadMin/g' \
 -e 's/\bLOOKAHEAD_MAX\b/B.ai.lookaheadMax/g' \
 -e 's/\bHAZARD_LOOKAHEAD\b/B.ai.hazardLookahead/g' \
 -e 's/\bBOX_SEEK_DISTANCE\b/B.ai.boxSeekDistance/g' \
 -e 's/\bPROFILES\[/B.ai.profiles[/g' \
 src/ai/AIDriver.ts
```

`speedFactor` 메서드를 다음으로 교체:
```ts
  private speedFactor(gap: number): number {
    const r = this.profile.rubber;
    return clamp(r.base + r.amp * Math.tanh(gap / r.scale), r.min, r.max);
  }
```
(원본의 easy/normal/hard 분기 값을 `rubber`로 그대로 옮긴 것이므로 동작 동일.)

- [ ] **Step 3: RaceManager**

import 추가: `import { BALANCE } from '../core/balance';`, `const B = BALANCE;`.

삭제: `START_BOOST_WINDOW, START_BOOST_WEAK_WINDOW, START_SPINOUT_HOLD, WRONG_WAY_SECONDS, STUCK_SECONDS, FINISH_GRACE_SECONDS`.
남김: `PLAYER_GRID_SLOT, COUNTDOWN_STEPS, WRONG_WAY_SPEED, VOID_SECONDS, STUCK_SPEED, RESPAWN_FREEZE_SECONDS, PLACE_DEBOUNCE_SECONDS, CHECKPOINT_WINDOW_SECTORS`.

```bash
sed -i '' -E \
 -e 's/\bSTART_BOOST_WINDOW\b/B.race.startBoostWindow/g' \
 -e 's/\bSTART_BOOST_WEAK_WINDOW\b/B.race.startBoostWeakWindow/g' \
 -e 's/\bSTART_SPINOUT_HOLD\b/B.race.startSpinoutHold/g' \
 -e 's/\bWRONG_WAY_SECONDS\b/B.race.wrongWaySeconds/g' \
 -e 's/\bSTUCK_SECONDS\b/B.race.stuckSeconds/g' \
 -e 's/\bFINISH_GRACE_SECONDS\b/B.race.finishGraceSeconds/g' \
 src/game/RaceManager.ts
```
`grep -n "^const B\." src/game/RaceManager.ts`로 깨진 선언 제거. **주의:** `START_BOOST_WINDOW`가 `START_BOOST_WEAK_WINDOW`의 부분 문자열이 아니므로(`\b` 경계) 순서 무관.

- [ ] **Step 4: 검증**

Run: `npm run typecheck && npm test && npm run build`
Expected: 모두 클린.

브라우저: reload 후 Sunny Circuit 1랩 — 체감 동일. 그 다음 `http://localhost:5178/?b.kart.accelBase=30&b.status.offroadFactor=1` 로 열어 가속이 확연히 빠르고 오프로드 감속이 없는지 확인. 콘솔 `window.__balance.kart.steerRate = 4` 후 조향이 즉시 예민해지는지 확인(Task 3.4 후).

- [ ] **Step 5: Commit**

```bash
git add src/items/ItemManager.ts src/ai/AIDriver.ts src/game/RaceManager.ts
git commit -m "refactor(balance): ItemManager/AIDriver/RaceManager read tuning from BALANCE"
```

---

### Task 3.4: 부트 적용 + 문서

**Files:**
- Modify: `src/main.ts`
- Modify: `CONTRACT.md` (Contract additions), `NOTES.md` §4

- [ ] **Step 1: main.ts**

import 추가:
```ts
import { BALANCE, applyBalanceOverrides } from './core/balance';
```
`boot()` 안, `const game = new Game(app);` **앞**에:
```ts
  const balanceWarnings = applyBalanceOverrides(BALANCE, new URLSearchParams(location.search));
  for (const w of balanceWarnings) console.warn('[balance]', w);
  (window as unknown as { __balance?: typeof BALANCE }).__balance = BALANCE;
```

- [ ] **Step 2: CONTRACT.md**

마지막 `## Contract additions` 섹션의 `(None yet. ...)` 줄을 다음으로 교체:
```markdown
- **(local-mods)** `src/core/balance.ts` — `BALANCE` tuning object. Kart/ItemManager/AIDriver/RaceManager read their feel constants from here instead of module-level consts. Values unchanged. URL override `?b.<path>=<number>`; `window.__balance`.
- **(local-mods)** `src/core/types.ts` — `TouchInputSource` interface. `InputManager.attachTouch()` merges a DOM virtual controller (`src/ui/TouchControls.ts`).
- **(local-mods)** `src/core/i18n.ts` + `src/core/locales/{en,ko}.ts` — `t(key)` string table; `events.ts` gains `'ui:langChange'`.
```

- [ ] **Step 3: NOTES.md §4**

표의 "카트 핸들링 / 아이템 확률표 / 아이템 파라미터 / AI 난이도 / 레이스 규칙" 행의 위치를 `src/core/balance.ts` (`BALANCE.kart` / `.itemTable` / `.items` / `.ai` / `.race`)로 바꾸고, 표 위에 한 줄 추가:
```markdown
> **26-09-04부터** 느낌 상수는 전부 `src/core/balance.ts`의 `BALANCE`에 모여 있다. `?b.kart.accelBase=11` 식 URL 오버라이드, 콘솔 `__balance` 실시간 수정 가능(AI 프로필은 다음 레이스부터).
```

- [ ] **Step 4: 검증 + Commit**

Run: `npm run typecheck && npm run build`
브라우저: `?b.kart.accelBase=abc` → 콘솔 `[balance] b.kart.accelBase: 'abc' is not a number` 경고 1건, 게임 정상.

```bash
git add src/main.ts CONTRACT.md NOTES.md
git commit -m "feat(balance): apply URL overrides at boot, expose window.__balance, document contract additions"
```

---

# Part 4 — 한국어 (ko/en)

### Task 4.1: 리소스 테이블 + i18n 코어 (테스트 우선)

**Files:**
- Create: `src/core/locales/en.ts`, `src/core/locales/ko.ts`, `src/core/i18n.ts`
- Modify: `src/core/events.ts` (`'ui:langChange': {}` 추가)
- Test: `src/core/i18n.test.ts`

- [ ] **Step 1: 실패 테스트**

`src/core/i18n.test.ts`:
```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { detectLang, getLang, localOrdinal, setLang, t } from './i18n';
import { en } from './locales/en';
import { ko } from './locales/ko';

describe('i18n', () => {
  beforeEach(() => {
    localStorage.clear();
    setLang('en');
  });

  it('ko and en have identical key sets', () => {
    expect(Object.keys(ko).sort()).toEqual(Object.keys(en).sort());
  });

  it('t() returns the current language string and substitutes params', () => {
    expect(t('menu.laps', { n: 3 })).toBe('3 LAPS');
    setLang('ko');
    expect(t('menu.laps', { n: 3 })).toBe('3랩');
  });

  it('t() falls back to the key for unknown keys', () => {
    // @ts-expect-error deliberately unknown key
    expect(t('nope.missing')).toBe('nope.missing');
  });

  it('detectLang prefers stored value, then navigator, then en', () => {
    expect(detectLang('fr-FR', null)).toBe('en');
    expect(detectLang('ko-KR', null)).toBe('ko');
    expect(detectLang('ko-KR', 'en')).toBe('en');
    expect(detectLang('en-US', 'ko')).toBe('ko');
    expect(detectLang('en-US', 'zz')).toBe('en');
  });

  it('setLang persists and updates <html lang>', () => {
    setLang('ko');
    expect(getLang()).toBe('ko');
    expect(localStorage.getItem('tkr.lang')).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');
  });

  it('localOrdinal', () => {
    expect(localOrdinal(1)).toBe('1st');
    setLang('ko');
    expect(localOrdinal(1)).toBe('1위');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- i18n`
Expected: FAIL — `Cannot find module './i18n'`.

- [ ] **Step 3: en.ts**

```ts
/** English strings — the source of truth for keys. Add a key here first, then to ko.ts. */
export const en = {
  // title
  'title.sub': 'ARCADE GRAND PRIX',
  'title.pressStart': 'PRESS ENTER / CLICK TO START',
  'title.tapStart': 'TAP TO START',
  'title.version': 'v1.1 · Three.js · 100% procedural · gamepad & touch',
  'title.lang': 'KO | EN',
  'legend.throttle': 'Throttle',
  'legend.brake': 'Brake / Reverse',
  'legend.steer': 'Steer',
  'legend.drift': 'Hop · Drift',
  'legend.item': 'Use item (hold BRAKE to throw back)',
  'legend.lookBack': 'Look back',
  'legend.pause': 'Pause',
  'legend.mute': 'Mute',
  // menus
  'menu.step1': 'STEP 1 / 2',
  'menu.step2': 'STEP 2 / 2',
  'menu.chooseRacer': 'CHOOSE YOUR RACER',
  'menu.pickCircuit': 'PICK A CIRCUIT',
  'menu.back': '← BACK',
  'menu.continue': 'CONTINUE →',
  'menu.startRace': 'START RACE',
  'menu.difficulty': 'DIFFICULTY',
  'menu.laps': '{n} LAPS',
  'menu.weightClass': 'Weight class',
  'diff.easy': 'EASY',
  'diff.normal': 'NORMAL',
  'diff.hard': 'HARD',
  'diff.easy.blurb': 'Relaxed rivals, generous rubber-banding.',
  'diff.normal.blurb': 'The classic Grand Prix challenge.',
  'diff.hard.blurb': 'Ruthless AI, near-perfect lines, no mercy.',
  'weight.light': 'LIGHT',
  'weight.medium': 'MEDIUM',
  'weight.heavy': 'HEAVY',
  'stat.speed': 'SPD',
  'stat.acceleration': 'ACC',
  'stat.handling': 'HND',
  'stat.weight': 'WGT',
  'stat.miniTurbo': 'MT',
  'tier.rookie': 'ROOKIE',
  'tier.pro': 'PRO',
  'tier.expert': 'EXPERT',
  'theme.grassland': 'GRASSLAND',
  'theme.desert': 'DESERT',
  'theme.snow': 'SNOW',
  'theme.beach': 'BEACH',
  'theme.volcano': 'VOLCANO',
  'theme.neon': 'NEON',
  // hud
  'hud.lap': 'LAP',
  'hud.go': 'GO!',
  'hud.finalLap': 'FINAL LAP!',
  'hud.lapN': 'LAP {n}',
  'hud.finish': 'FINISH',
  'hud.wrongWay': 'WRONG WAY',
  'item.banana': 'BANANA',
  'item.triple_banana': 'BANANA ×3',
  'item.green_shell': 'GREEN SHELL',
  'item.triple_green_shell': 'GREEN ×3',
  'item.red_shell': 'RED SHELL',
  'item.triple_red_shell': 'RED ×3',
  'item.blue_shell': 'BLUE SHELL',
  'item.mushroom': 'MUSHROOM',
  'item.triple_mushroom': 'MUSHROOM ×3',
  'item.golden_mushroom': 'GOLDEN',
  'item.star': 'STAR',
  'item.lightning': 'LIGHTNING',
  'item.bob_omb': 'BOB-OMB',
  // loading
  'loading.now': 'NOW LOADING',
  'loading.tip': 'TIP',
  'loading.subtitle': '{laps} LAPS  ·  {stars}  ·  {theme}',
  'tip.0': 'Hold DRIFT (Space / Shift) through a corner and release for a mini-turbo. Longer drift = bigger boost.',
  'tip.1': 'Tap the throttle just as the countdown hits 1 for a rocket start. Hold it too early and you will spin out.',
  'tip.2': 'Hold BRAKE while using a shell to throw it backwards.',
  'tip.3': 'Press Q to look behind you. Check what is coming before dropping a banana.',
  'tip.4': 'Boost pads (glowing chevrons) give a free +45% speed burst. Line them up.',
  'tip.5': 'Item odds depend on your place. Trailing racers get stars, lightning and blue shells.',
  'tip.6': 'A star makes you invincible and destroys any hazard you touch.',
  'tip.7': 'Staying on the road matters: off-road cuts your top speed almost in half.',
  'tip.8': 'Use a mushroom on the long straight, or to recover after a hit.',
  'tip.9': 'Heavy karts bump light karts around. Pick your weight class wisely.',
  'tip.10': 'Hop off jump crests for a small landing boost.',
  'tip.11': 'Press M to mute the audio at any time.',
  // results
  'results.kicker': 'RACE COMPLETE',
  'results.victory': 'VICTORY!',
  'results.place': '{ord} PLACE',
  'results.sub.win': 'Untouchable. The crowd goes wild.',
  'results.sub.podium': 'Podium finish. Champagne is on ice.',
  'results.sub.mid': 'Solid run. The podium is within reach.',
  'results.sub.rough': 'Rough race. Time for revenge.',
  'results.you': '(YOU)',
  'results.dnf': 'DNF',
  'results.again': 'RACE AGAIN',
  'results.changeTrack': 'CHANGE TRACK',
  'results.mainMenu': 'MAIN MENU',
  // pause
  'pause.kicker': 'RACE PAUSED',
  'pause.title': 'PAUSED',
  'pause.resume': 'RESUME',
  'pause.restart': 'RESTART RACE',
  'pause.quit': 'QUIT TO MENU',
  'pause.hint': 'ESC / P  resume   ·   ↑↓  navigate   ·   ENTER  select',
  // touch
  'touch.drift': 'DRIFT',
  'touch.item': 'ITEM',
  // errors
  'err.webgl.title': 'WEBGL2 REQUIRED',
  'err.webgl.body':
    'Turbo Kart Rush needs a browser with WebGL 2 and hardware acceleration enabled. Try the latest Chrome, Edge, Firefox or Safari, and make sure GPU acceleration is switched on.',
  'err.start.title': 'FAILED TO START',
  'err.start.body': 'Something went wrong while starting the game. Open the developer console for details, then reload.',
  'err.reload': 'RELOAD',
  'err.buildRace': 'Could not build the race. Check the console for details.',
  'err.noTracks': 'No tracks are available yet.',
  'err.runtime': 'Runtime error: {msg}',
  'err.rejection': 'Unhandled promise rejection: {msg}',
  'mute': '🔇 MUTED',
  // characters (names stay English)
  'char.zippy.tagline': 'Blink and she is already two corners ahead.',
  'char.pixel.tagline': 'Sugar-rush handling. Corners are her candy.',
  'char.fennec.tagline': 'Big ears, bigger mini-turbos.',
  'char.max.tagline': 'The all-rounder. Every lap is a highlight reel.',
  'char.juno.tagline': 'Charges every drift like a thunderstorm.',
  'char.kai.tagline': 'Cool as the deep end, smooth as a swell.',
  'char.bram.tagline': 'Slow to wake up. Impossible to shove.',
  'char.rosa.tagline': 'Eighteen wheels of attitude in a four-wheel kart.',
  // tracks (names stay English)
  'track.sunny_circuit.desc': 'Rolling green hills, a long start straight and one tricky hairpin. The perfect warm-up.',
  'track.coral_coast.desc': 'Seaside sweepers, a flat-out pier straight and soft sand that swallows anyone who cuts the corner.',
  'track.dune_drift.desc': 'Sunset sweepers, a canyon run between towering sandstone walls and two hairpins that punish greed.',
  'track.frostbite_falls.desc': 'A plunging descent onto a frozen lake causeway with nothing but ice between you and the drop.',
  'track.neon_nexus.desc': 'Three hairpins, a rooftop jump and a flat-out neon straight under a violet sky. Experts only.',
  'track.magma_ridge.desc': 'Climb the caldera, jump the ridge, then thread two lava bridges with nothing to stop you falling in.',
} as const;

export type StringKey = keyof typeof en;
```

- [ ] **Step 4: ko.ts**

```ts
import type { StringKey } from './en';

/** 한국어. 캐릭터/트랙 이름은 영문 고유명사 유지. */
export const ko: Record<StringKey, string> = {
  'title.sub': '아케이드 그랑프리',
  'title.pressStart': 'ENTER 또는 클릭으로 시작',
  'title.tapStart': '화면을 탭해서 시작',
  'title.version': 'v1.1 · Three.js · 100% 프로시저럴 · 게임패드·터치 지원',
  'title.lang': 'KO | EN',
  'legend.throttle': '가속',
  'legend.brake': '브레이크 / 후진',
  'legend.steer': '조향',
  'legend.drift': '홉 · 드리프트',
  'legend.item': '아이템 사용 (브레이크 누른 채 = 뒤로 던지기)',
  'legend.lookBack': '뒤 돌아보기',
  'legend.pause': '일시정지',
  'legend.mute': '음소거',
  'menu.step1': '1 / 2 단계',
  'menu.step2': '2 / 2 단계',
  'menu.chooseRacer': '레이서 선택',
  'menu.pickCircuit': '서킷 선택',
  'menu.back': '← 뒤로',
  'menu.continue': '다음 →',
  'menu.startRace': '레이스 시작',
  'menu.difficulty': '난이도',
  'menu.laps': '{n}랩',
  'menu.weightClass': '체급',
  'diff.easy': '쉬움',
  'diff.normal': '보통',
  'diff.hard': '어려움',
  'diff.easy.blurb': '느긋한 상대, 넉넉한 러버밴딩.',
  'diff.normal.blurb': '정통 그랑프리 난이도.',
  'diff.hard.blurb': '냉혹한 AI, 거의 완벽한 라인, 자비 없음.',
  'weight.light': '경량',
  'weight.medium': '중량',
  'weight.heavy': '헤비',
  'stat.speed': '속도',
  'stat.acceleration': '가속',
  'stat.handling': '조향',
  'stat.weight': '무게',
  'stat.miniTurbo': '터보',
  'tier.rookie': '루키',
  'tier.pro': '프로',
  'tier.expert': '엑스퍼트',
  'theme.grassland': '초원',
  'theme.desert': '사막',
  'theme.snow': '설원',
  'theme.beach': '해변',
  'theme.volcano': '화산',
  'theme.neon': '네온',
  'hud.lap': 'LAP',
  'hud.go': 'GO!',
  'hud.finalLap': '마지막 랩!',
  'hud.lapN': '{n}랩',
  'hud.finish': '완주',
  'hud.wrongWay': '역주행',
  'item.banana': '바나나',
  'item.triple_banana': '바나나 ×3',
  'item.green_shell': '초록 등껍질',
  'item.triple_green_shell': '초록 ×3',
  'item.red_shell': '빨간 등껍질',
  'item.triple_red_shell': '빨간 ×3',
  'item.blue_shell': '파란 등껍질',
  'item.mushroom': '버섯',
  'item.triple_mushroom': '버섯 ×3',
  'item.golden_mushroom': '황금 버섯',
  'item.star': '스타',
  'item.lightning': '번개',
  'item.bob_omb': '폭탄',
  'loading.now': '로딩 중',
  'loading.tip': '팁',
  'loading.subtitle': '{laps}랩  ·  {stars}  ·  {theme}',
  'tip.0': '코너에서 드리프트(Space / Shift)를 누른 채 돌다가 놓으면 미니터보. 길게 끌수록 부스트가 커집니다.',
  'tip.1': '카운트다운이 1이 되는 순간 가속을 누르면 로켓 스타트. 너무 일찍 누르면 스핀합니다.',
  'tip.2': '브레이크를 누른 채 등껍질을 쓰면 뒤로 던집니다.',
  'tip.3': 'Q로 뒤를 볼 수 있습니다. 바나나를 놓기 전에 뒤를 확인하세요.',
  'tip.4': '부스트 패드(빛나는 화살표)는 공짜 +45% 가속. 라인을 맞추세요.',
  'tip.5': '아이템 확률은 순위에 따라 달라집니다. 뒤처질수록 스타·번개·파란 등껍질.',
  'tip.6': '스타는 무적. 닿는 장애물을 전부 파괴합니다.',
  'tip.7': '도로를 벗어나면 최고 속도가 거의 절반으로 떨어집니다.',
  'tip.8': '버섯은 긴 직선에서, 혹은 피격 후 복구용으로 쓰세요.',
  'tip.9': '무거운 카트는 가벼운 카트를 밀쳐냅니다. 체급을 잘 고르세요.',
  'tip.10': '점프 구간 정상에서 홉하면 착지 부스트를 받습니다.',
  'tip.11': 'M을 누르면 언제든 음소거.',
  'results.kicker': '레이스 종료',
  'results.victory': '우승!',
  'results.place': '{ord}',
  'results.sub.win': '압도적. 관중이 열광합니다.',
  'results.sub.podium': '포디움 피니시. 샴페인이 준비됐습니다.',
  'results.sub.mid': '견실한 주행. 포디움이 코앞입니다.',
  'results.sub.rough': '거친 레이스. 복수의 시간입니다.',
  'results.you': '(나)',
  'results.dnf': 'DNF',
  'results.again': '다시 레이스',
  'results.changeTrack': '트랙 변경',
  'results.mainMenu': '메인 메뉴',
  'pause.kicker': '레이스 일시정지',
  'pause.title': '일시정지',
  'pause.resume': '계속하기',
  'pause.restart': '레이스 재시작',
  'pause.quit': '메뉴로 나가기',
  'pause.hint': 'ESC / P  계속   ·   ↑↓  이동   ·   ENTER  선택',
  'touch.drift': '드리프트',
  'touch.item': '아이템',
  'err.webgl.title': 'WEBGL2 필요',
  'err.webgl.body':
    'Turbo Kart Rush는 WebGL 2와 하드웨어 가속이 켜진 브라우저가 필요합니다. 최신 Chrome, Edge, Firefox, Safari에서 GPU 가속을 켜고 다시 시도하세요.',
  'err.start.title': '시작 실패',
  'err.start.body': '게임을 시작하는 중 문제가 생겼습니다. 개발자 콘솔을 확인한 뒤 새로고침하세요.',
  'err.reload': '새로고침',
  'err.buildRace': '레이스를 만들 수 없습니다. 콘솔을 확인하세요.',
  'err.noTracks': '사용 가능한 트랙이 없습니다.',
  'err.runtime': '런타임 오류: {msg}',
  'err.rejection': '처리되지 않은 프라미스 거부: {msg}',
  'mute': '🔇 음소거',
  'char.zippy.tagline': '눈 깜짝할 새 두 코너 앞에 있다.',
  'char.pixel.tagline': '설탕 러시 핸들링. 코너가 그녀의 사탕.',
  'char.fennec.tagline': '큰 귀, 더 큰 미니터보.',
  'char.max.tagline': '올라운더. 매 랩이 하이라이트.',
  'char.juno.tagline': '드리프트마다 뇌우처럼 충전한다.',
  'char.kai.tagline': '깊은 바다처럼 쿨하고, 너울처럼 부드럽게.',
  'char.bram.tagline': '깨우긴 느리다. 밀어내긴 불가능.',
  'char.rosa.tagline': '네 바퀴 카트에 실린 18륜 트럭의 기세.',
  'track.sunny_circuit.desc': '완만한 초록 언덕, 긴 출발 직선, 까다로운 헤어핀 하나. 완벽한 워밍업.',
  'track.coral_coast.desc': '해안 스위퍼, 전력 질주 방파제 직선, 그리고 코너를 자르는 자를 삼키는 모래.',
  'track.dune_drift.desc': '석양 스위퍼, 거대한 사암 벽 사이의 캐니언, 욕심을 벌하는 헤어핀 둘.',
  'track.frostbite_falls.desc': '얼어붙은 호수 위 둑길로 떨어지는 급강하. 당신과 추락 사이엔 얼음뿐.',
  'track.neon_nexus.desc': '헤어핀 셋, 옥상 점프, 보랏빛 하늘 아래 전력 질주 네온 직선. 전문가 전용.',
  'track.magma_ridge.desc': '칼데라를 오르고, 능선을 뛰어넘고, 아무것도 막아주지 않는 용암 다리 둘을 건너라.',
};
```

- [ ] **Step 5: i18n.ts**

```ts
/**
 * Contract addition: tiny string table with ko/en. `t(key, params)` substitutes `{name}`.
 * Language: localStorage 'tkr.lang' -> navigator.language (ko*) -> 'en'.
 */
import { events } from './events';
import { ordinal } from './math';
import { en, type StringKey } from './locales/en';
import { ko } from './locales/ko';

export type Lang = 'ko' | 'en';
export type { StringKey };

const STORAGE_KEY = 'tkr.lang';
const TABLES: Record<Lang, Record<StringKey, string>> = { en, ko };

export function detectLang(navigatorLanguage: string | undefined, stored: string | null): Lang {
  if (stored === 'ko' || stored === 'en') return stored;
  return (navigatorLanguage ?? '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let current: Lang = detectLang(typeof navigator !== 'undefined' ? navigator.language : undefined, readStored());
if (typeof document !== 'undefined') document.documentElement.lang = current;

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  const changed = lang !== current;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* private mode etc. */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  if (changed) events.emit('ui:langChange', {});
}

export function toggleLang(): Lang {
  setLang(current === 'ko' ? 'en' : 'ko');
  return current;
}

export function t(key: StringKey, params?: Record<string, string | number>): string {
  const table = TABLES[current];
  let s: string = (table as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key;
  if (params) {
    for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]));
  }
  return s;
}

/** Try a dynamic key (e.g. `char.<id>.tagline`); return `fallback` when the key is not in the table. */
export function tOr(key: string, fallback: string): string {
  const table = TABLES[current] as Record<string, string>;
  return table[key] ?? fallback;
}

/** "1st" in English, "1위" in Korean. */
export function localOrdinal(n: number): string {
  return current === 'ko' ? `${n}위` : ordinal(n);
}

/** Suffix after the numeral, for the HUD's split numeral/suffix layout. */
export function localOrdinalSuffix(n: number): string {
  return localOrdinal(n).slice(String(n).length);
}
```

- [ ] **Step 6: events.ts**

`'ui:error': {};` 아래에:
```ts
  'ui:langChange': {};
```

- [ ] **Step 7: 통과 확인**

Run: `npm test -- i18n && npm run typecheck`
Expected: 6 passed, 타입 클린. (`ko`에 키가 빠지면 tsc가 `Record<StringKey,string>` 불일치로 잡는다.)

- [ ] **Step 8: Commit**

```bash
git add src/core/i18n.ts src/core/i18n.test.ts src/core/locales src/core/events.ts
git commit -m "feat(i18n): ko/en string tables, t()/setLang/detectLang, ui:langChange event"
```

---

### Task 4.2: MainMenu 문자열 치환 + 언어 토글 + 재구축

**Files:**
- Modify: `src/ui/MainMenu.ts`
- Modify: `src/game/Game.ts`

- [ ] **Step 1: MainMenu import**

```ts
import { getLang, t, tOr, toggleLang } from '../core/i18n';
import type { StringKey } from '../core/i18n';
```

- [ ] **Step 2: 상단 테이블을 키 기반으로**

```ts
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const DIFFICULTY_LABEL: Record<Difficulty, StringKey> = { easy: 'diff.easy', normal: 'diff.normal', hard: 'diff.hard' };
const DIFFICULTY_BLURB: Record<Difficulty, StringKey> = {
  easy: 'diff.easy.blurb',
  normal: 'diff.normal.blurb',
  hard: 'diff.hard.blurb',
};
const STAT_KEYS: readonly { key: keyof CharacterDef['stats']; label: StringKey }[] = [
  { key: 'speed', label: 'stat.speed' },
  { key: 'acceleration', label: 'stat.acceleration' },
  { key: 'handling', label: 'stat.handling' },
  { key: 'weight', label: 'stat.weight' },
  { key: 'miniTurbo', label: 'stat.miniTurbo' },
];
const TIER_KEYS: readonly StringKey[] = ['tier.rookie', 'tier.pro', 'tier.expert'];
```

- [ ] **Step 3: 생성자 문자열 치환**

| 기존 | 신규 |
|---|---|
| `el('div', 'logo-sub', 'ARCADE GRAND PRIX', title);` | `el('div', 'logo-sub', t('title.sub'), title);` |
| `el('span', 'press-start-text', 'PRESS ENTER / CLICK TO START', prompt);` | `el('span', 'press-start-text', window.matchMedia?.('(pointer: coarse)').matches ? t('title.tapStart') : t('title.pressStart'), prompt);` |
| `keys` 배열의 두 번째 요소들 | `t('legend.throttle')`, `t('legend.brake')`, `t('legend.steer')`, `t('legend.drift')`, `t('legend.item')`, `t('legend.lookBack')`, `t('legend.pause')`, `t('legend.mute')` |
| `'v1.0 · Three.js · 100% procedural · gamepad supported'` | `t('title.version')` |
| `'STEP 1 / 2'` / `'STEP 2 / 2'` | `t('menu.step1')` / `t('menu.step2')` |
| `'CHOOSE YOUR RACER'` / `'PICK A CIRCUIT'` | `t('menu.chooseRacer')` / `t('menu.pickCircuit')` |
| `button('← BACK', ...)` (2곳) | `button(t('menu.back'), ...)` |
| `button('CONTINUE →', ...)` | `button(t('menu.continue'), ...)` |
| `'DIFFICULTY'` | `t('menu.difficulty')` |
| `el('button', 'seg', DIFFICULTY_LABEL[d], seg)` | `el('button', 'seg', t(DIFFICULTY_LABEL[d]), seg)` |
| `button('START RACE', ...)` | `button(t('menu.startRace'), ...)` |

`setDifficulty`: `this.diffBlurb.set(DIFFICULTY_BLURB[...])` → `this.diffBlurb.set(t(DIFFICULTY_BLURB[DIFFICULTIES[i]]))`.
`setCharacter`: `this.charTagline.set(def.tagline)` → `this.charTagline.set(tOr(\`char.${def.id}.tagline\`, def.tagline))`.

`buildCharacterCard`:
- `el('div', 'card-tag', c.tagline, card)` → `el('div', 'card-tag', tOr(\`char.${c.id}.tagline\`, c.tagline), card)`
- `pill` 텍스트 `c.weightClass.toUpperCase()` → `t(\`weight.${c.weightClass}\` as StringKey)`; `pill.title = t('menu.weightClass')`
- `el('span', 'stat-label', s.label, row)` → `el('span', 'stat-label', t(s.label), row)`

`buildTrackCard`:
- 테마 필 `t.theme.toUpperCase()` → `tt(\`theme.${t.theme}\` as StringKey)` — 매개변수 `t`가 `TrackDefinition`과 이름이 겹치므로 이 메서드에서만 **import한 `t`를 `tt`로 별칭**: 파일 상단 import를 `import { getLang, t, t as tt, tOr, toggleLang } from '../core/i18n';`로.
- `el('div', 'card-tag', t.description, body)` → `el('div', 'card-tag', tOr(\`track.${t.id}.desc\`, t.description), body)`
- `` `${t.laps} LAPS` `` → `tt('menu.laps', { n: t.laps })`
- `['ROOKIE','PRO','EXPERT'][t.difficulty - 1] ?? 'PRO'` → `tt(TIER_KEYS[t.difficulty - 1] ?? 'tier.pro')`

- [ ] **Step 4: 언어 토글 버튼**

타이틀 섹션 생성 직후(`const title = el(...)` 다음 줄)에:
```ts
    const langBtn = button(t('title.lang'), 'ghost lang-toggle', () => {
      toggleLang();
    });
    langBtn.dataset.lang = getLang();
    title.appendChild(langBtn);
```
(`button()` 헬퍼가 `stopPropagation`하므로 타이틀 클릭 → 캐릭터 선택 전이가 발생하지 않는다.)

CSS (`src/style.css` 끝):
```css
.lang-toggle {
  position: absolute;
  top: calc(16px + env(safe-area-inset-top, 0px));
  right: calc(16px + env(safe-area-inset-right, 0px));
  pointer-events: auto;
  font-size: 13px;
  padding: 8px 12px;
}
```
`.panel-title-screen`이 `position: static`이면 `position: relative`를 추가한다(확인 필요).

- [ ] **Step 5: Game에서 메뉴 재구축**

`Game.ts`: `private readonly mainMenu: MainMenu;` → `private mainMenu: MainMenu;` (readonly 제거).

생성자에서 MainMenu 생성·콜백 배선 3줄을 메서드로 추출:
```ts
  private buildMainMenu(): MainMenu {
    const menu = new MainMenu(this.uiRoot, CHARACTERS as readonly CharacterDef[], TRACKS as readonly TrackDefinition[]);
    menu.onHighlight = (id) => this.backdrop.setCharacter(getCharacter(id));
    menu.onPanelChange = (panel) => this.onMenuPanel(panel);
    menu.onStart = (settings) => this.startRace(settings);
    return menu;
  }
```
생성자: `this.mainMenu = this.buildMainMenu();`

리스너 블록에 추가:
```ts
    this.unsubLang = events.on('ui:langChange', () => this.onLangChange());
```
필드: `private unsubLang: (() => void) | null = null;`
`dispose()`에 `this.unsubLang?.(); this.unsubLang = null;`.

메서드:
```ts
  /** Language switched on the title screen: rebuild the (stateless) menu in place. */
  private onLangChange(): void {
    const panel = this.mainMenu.currentPanel;
    const wasMenu = this.state === 'title' || this.state === 'characterSelect' || this.state === 'trackSelect';
    this.mainMenu.dispose();
    this.mainMenu = this.buildMainMenu();
    // Keep the mute indicator / touch layer above the new menu node.
    this.uiRoot.appendChild(this.muteIndicator);
    if (wasMenu) this.mainMenu.show(panel);
    this.muteIndicator.textContent = t('mute');
  }
```
`import { t } from '../core/i18n';` 추가. `'🔇 MUTED'` 리터럴 → `t('mute')`. `showToast('Could not build the race...')` → `showToast(t('err.buildRace'), 'error')`, `'No tracks are available yet.'` → `t('err.noTracks')`.

**스펙 이탈 메모:** 스펙은 "라벨만 교체"라 했지만 MainMenu가 텍스트 노드 참조를 20여 개 보관해야 해서, 타이틀에서만 토글되고 메뉴 상태가 기본값인 점을 이용해 **재구축**으로 단순화한다. 스펙 §4 "전환" 문단을 이에 맞게 한 줄 수정한다.

- [ ] **Step 6: 검증**

Run: `npm run typecheck && npm test && npm run build`
브라우저: 타이틀 우상단 `KO | EN` 클릭 → 서브타이틀/범례/버전 즉시 한국어. 캐릭터 화면 헤더·태글라인·체급·스탯 라벨 한국어, 트랙 화면 설명·랩·티어 한국어, 이름은 영문. 새로고침 후 한국어 유지(localStorage). 다시 토글 → 영어.

- [ ] **Step 7: Commit**

```bash
git add src/ui/MainMenu.ts src/game/Game.ts src/style.css docs/superpowers/specs/2026-09-04-local-mods-design.md
git commit -m "feat(i18n): MainMenu strings via t(), KO|EN toggle rebuilds menu, Game toasts localized"
```

---

### Task 4.3: HUD · Loading · Results · Pause · Touch · main.ts 치환

**Files:**
- Modify: `src/ui/HUD.ts`, `src/ui/LoadingScreen.ts`, `src/ui/ResultsScreen.ts`, `src/ui/PauseMenu.ts`, `src/ui/TouchControls.ts`, `src/main.ts`

- [ ] **Step 1: HUD.ts**

import: `import { localOrdinalSuffix, t } from '../core/i18n'; import type { StringKey } from '../core/i18n';`
`ordinal` import 제거(math에서 `clamp01, damp, formatRaceTime`만).

`ITEM_LABEL` 테이블 삭제. `HUD.ts:351`의 `this.itemLabel.set(this.rouletteVisual ? '' : ITEM_LABEL[item]);`를
```ts
this.itemLabel.set(this.rouletteVisual || item === 'none' ? '' : t(`item.${item}` as StringKey));
```
로.

| 기존 | 신규 |
|---|---|
| `el('span', 'hud-lap-label', 'LAP', lapBox)` | `el('span', 'hud-lap-label', t('hud.lap'), lapBox)` |
| `this.flashCenter('GO!', ...)` | `this.flashCenter(t('hud.go'), ...)` |
| `this.flashCenter('FINAL LAP!', ...)` | `this.flashCenter(t('hud.finalLap'), ...)` |
| `` this.flashCenter(`LAP ${e.lap}`, ...) `` | `this.flashCenter(t('hud.lapN', { n: e.lap }), ...)` |
| `this.flashCenter('FINISH', ...)` | `this.flashCenter(t('hud.finish'), ...)` |
| `const ord = ordinal(place); ... this.placeSuffix.set(ord.slice(String(place).length));` | `this.placeSuffix.set(localOrdinalSuffix(place));` (`ord` 변수 삭제) |
| `HUD.ts:156` `el('span', 'wrongway-text', 'WRONG WAY', this.wrongWay)` | `el('span', 'wrongway-text', t('hud.wrongWay'), this.wrongWay)` |

- [ ] **Step 2: LoadingScreen.ts**

import `import { t } from '../core/i18n'; import type { StringKey } from '../core/i18n';`
`TIPS` 배열을 키 배열로:
```ts
const TIPS: readonly StringKey[] = ['tip.0','tip.1','tip.2','tip.3','tip.4','tip.5','tip.6','tip.7','tip.8','tip.9','tip.10','tip.11'];
```
`this.tipText.set(TIPS[i])` (2곳) → `this.tipText.set(t(TIPS[i]))`.
`'NOW LOADING'` → `t('loading.now')`, `'TIP'` → `t('loading.tip')`.
subtitle:
```ts
this.subtitle.set(t('loading.subtitle', { laps: def.laps, stars, theme: t(`theme.${def.theme}` as StringKey) }));
```

- [ ] **Step 3: ResultsScreen.ts**

import `import { localOrdinal, t } from '../core/i18n';`, math에서 `ordinal` import 제거.

| 기존 | 신규 |
|---|---|
| `'RACE COMPLETE'` | `t('results.kicker')` |
| `button('RACE AGAIN', ...)` 등 3개 | `t('results.again')`, `t('results.changeTrack')`, `t('results.mainMenu')` |
| `place === 1 ? 'VICTORY!' : \`${ordinal(place).toUpperCase()} PLACE\`` | `place === 1 ? t('results.victory') : t('results.place', { ord: localOrdinal(place).toUpperCase() })` |
| 4개 subheading 문자열 | `t('results.sub.win')`, `t('results.sub.podium')`, `t('results.sub.mid')`, `t('results.sub.rough')` |
| `el('span', 'standing-place', ordinal(s.place), row)` | `el('span', 'standing-place', localOrdinal(s.place), row)` |
| `s.name + (s.isPlayer ? '  (YOU)' : '')` | `` s.name + (s.isPlayer ? `  ${t('results.you')}` : '') `` |
| `'DNF'` | `t('results.dnf')` |

- [ ] **Step 4: PauseMenu.ts**

import `import { t } from '../core/i18n';`
`'RACE PAUSED'`→`t('pause.kicker')`, `'PAUSED'`→`t('pause.title')`, `'RESUME'`→`t('pause.resume')`, `'RESTART RACE'`→`t('pause.restart')`, `'QUIT TO MENU'`→`t('pause.quit')`, 힌트→`t('pause.hint')`.

**PauseMenu/ResultsScreen/LoadingScreen은 Game 생성 시 한 번 만들어진다.** 언어 토글 후에도 반영되도록 `Game.onLangChange()`에 다음을 추가한다:
```ts
    this.results.dispose();
    this.results = new ResultsScreen(this.uiRoot);
    this.results.onRaceAgain = () => { if (this.race) this.startRace(this.race.settings); };
    this.results.onChangeTrack = () => this.returnToMenu('trackSelect');
    this.results.onMainMenu = () => this.returnToMenu('title');
    this.pauseMenu.dispose();
    this.pauseMenu = new PauseMenu(this.uiRoot);
    this.pauseMenu.onResume = () => this.resume();
    this.pauseMenu.onRestart = () => {
      const settings = this.race?.settings;
      this.leavePause();
      if (settings) this.startRace(settings);
      else this.returnToMenu('title');
    };
    this.pauseMenu.onQuit = () => { this.leavePause(); this.returnToMenu('title'); };
    this.loading.dispose();
    this.loading = new LoadingScreen(this.uiRoot);
```
(해당 필드들의 `readonly`를 제거. 생성자의 동일 배선 코드와 중복되므로 `buildOverlays()` 메서드로 추출해 생성자와 `onLangChange` 양쪽에서 호출한다.) HUD는 레이스마다 새로 생성되므로 조치 불필요. TouchControls 라벨은 다음 Step.

- [ ] **Step 5: TouchControls.ts + main.ts**

TouchControls: `import { t } from '../core/i18n';` — `'ITEM'`→`t('touch.item')`, `'DRIFT'`→`t('touch.drift')`. 그리고 `events.on('ui:langChange', ...)`로 두 버튼 `textContent` 갱신(unsub은 dispose에서).

main.ts: `import { t } from './core/i18n';`
- `showFatal(app, 'WEBGL2 REQUIRED', '...')` → `showFatal(app, t('err.webgl.title'), t('err.webgl.body'))`
- `'FAILED TO START'`, 본문 → `t('err.start.title')`, `t('err.start.body')`
- `button` 라벨 `'RELOAD'` → `t('err.reload')`
- `` `Runtime error: ${ev.message || 'unknown'}` `` → `t('err.runtime', { msg: ev.message || 'unknown' })`
- `` `Unhandled promise rejection: ${reason}` `` → `t('err.rejection', { msg: reason })`

- [ ] **Step 6: 한글 타이포 CSS** (`src/style.css` 끝)

```css
/* Korean: Impact has no Hangul, so glyphs fall through to a Gothic face; loosen uppercase tracking. */
html[lang='ko'] {
  --display: 'Impact', 'Haettenschweiler', 'Arial Narrow Bold', 'Apple SD Gothic Neo', 'Noto Sans KR',
    'Malgun Gothic', system-ui, sans-serif;
}
html[lang='ko'] .btn,
html[lang='ko'] .panel-title,
html[lang='ko'] .panel-kicker,
html[lang='ko'] .card-name,
html[lang='ko'] .card-tag,
html[lang='ko'] .pill,
html[lang='ko'] .seg,
html[lang='ko'] .difficulty-label,
html[lang='ko'] .select-info-name,
html[lang='ko'] .select-info-tagline,
html[lang='ko'] .hud-msg,
html[lang='ko'] .hud-lap-label,
html[lang='ko'] .loading-kicker,
html[lang='ko'] .loading-tip-label,
html[lang='ko'] .results-title,
html[lang='ko'] .standing-name,
html[lang='ko'] .touch-btn {
  letter-spacing: 0.01em;
  word-break: keep-all;
}
```

- [ ] **Step 7: 검증**

Run: `npm run typecheck && npm test && npm run build`
Expected: 클린. `grep -rnE "'(FINAL LAP!|RACE AGAIN|NOW LOADING|PAUSED|WRONG WAY)'" src` → 출력 없음.

브라우저(KO): 레이스 시작 → 카운트다운 후 `GO!`, 아이템 라벨 한국어(예: 바나나), 순위 `1위`, 2랩 진입 시 `2랩`, 마지막 랩 `마지막 랩!`, ESC → `일시정지/계속하기/…`, 완주 → `우승!` 또는 `N위`, 순위표 `(나)`. 로딩 화면 팁 한국어. 새로고침 후 유지. 모바일 뷰포트에서 DRIFT/ITEM 버튼이 `드리프트/아이템`. EN으로 토글 후 동일 흐름이 영어.

- [ ] **Step 8: Commit**

```bash
git add src/ui src/main.ts src/game/Game.ts src/style.css
git commit -m "feat(i18n): localize HUD, loading tips, results, pause, touch labels, fatal screens; Korean typography"
```

---

### Task 4.4: 마무리 — NOTES.md·spec 갱신, 전체 검증

**Files:**
- Modify: `NOTES.md` (§1 실행 방법에 `npm test`, §2 트리에 새 파일, §6 표 1·5번 완료 표시)
- Modify: `docs/superpowers/specs/2026-09-04-local-mods-design.md` §4 전환 문단(재구축 방식으로)

- [ ] **Step 1: NOTES.md**

- §1에 `npm test        # vitest (touchMath / InputManager / tracks / balance / i18n)` 추가.
- §2 트리에 `core/balance.ts`, `core/i18n.ts`, `core/locales/`, `ui/TouchControls.ts`, `ui/touchMath.ts`, `track/tracks/coralCoast.ts`, `magmaRidge.ts`, `*.test.ts` 추가.
- §6 표: 1번(터치)·5번(한국어) 행 현황을 "✅ 완료(local-mods)"로, 3·4번은 "다음: V8 연동 스펙"으로.

- [ ] **Step 2: 전체 검증**

```bash
npm test && npm run typecheck && npm run build
```
Expected: 테스트 전부 통과(약 30개), 타입·빌드 클린.

브라우저 최종 회귀: 데스크톱 EN에서 Sunny Circuit 1랩(키보드) → 터치 컨트롤 안 보임 / 모바일 KO에서 Magma Ridge 카운트다운까지 → 터치 컨트롤 보임, 6트랙 3×2, 콘솔 에러 0.

- [ ] **Step 3: Commit**

```bash
git add NOTES.md docs/superpowers/specs/2026-09-04-local-mods-design.md
git commit -m "docs: NOTES/spec updated for touch, 6 tracks, balance.ts, ko/en"
```

---

## 완료 후

브랜치 `local-mods`에 Part 1~4 커밋이 쌓인 상태. 다음 스펙(V8 연동: agent8 리더보드 `race:finish` 훅, @verse8/ads, gitlab develop 배포)은 별도 브레인스토밍으로 시작한다.
