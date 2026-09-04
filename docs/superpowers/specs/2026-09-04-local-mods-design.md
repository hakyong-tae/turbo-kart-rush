# Turbo Kart Rush — 로컬 개조 1차 설계 (터치 · 트랙 2개 · 밸런스 노출 · 한국어)

날짜: 2026-09-04 · 브랜치: `local-mods` · 상위 문서: `NOTES.md`, `CONTRACT.md`

## 목표

원작(bridge-mind/turbo-kart-rush, MIT, 에셋 0)을 Verse8 배포 전 단계까지 다듬는다. 이번 스펙 범위는 네 가지이며 **V8 연동(리더보드/광고)은 별도 스펙**으로 뒤에 한다.

1. 모바일 터치 조작
2. 새 트랙 2개 (beach, volcano)
3. 밸런스 상수를 한 파일로 노출 (수치는 변경하지 않음)
4. 한국어 UI (ko/en 전환, 브라우저 언어 자동 감지)

원칙: `CONTRACT.md`의 모듈 격리를 지킨다. `src/core`에 **파일 추가**는 허용하되 기존 타입·상수 값은 바꾸지 않는다(추가 사항은 CONTRACT.md "Contract additions"에 기록).

---

## 1. 터치 조작

### 구성
- `src/ui/TouchControls.ts` (신규, 워크스트림 A 영역): DOM 오버레이. 포인터 이벤트를 받아 `TouchInputSource` 상태를 갱신하고 시각 피드백(스틱 노브, 버튼 눌림)을 그린다.
- `src/core/types.ts`에 **추가**: 
  ```ts
  export interface TouchInputSource {
    readonly steer: number;     // -1..1
    readonly throttle: number;  // 0..1
    readonly brake: number;     // 0..1
    readonly drift: boolean;    // held
    readonly item: boolean;     // held (InputManager가 edge로 변환)
    readonly pause: boolean;    // held
  }
  ```
- `src/kart/InputManager.ts`에 `attachTouch(src: TouchInputSource | null)` 추가. `update()`에서 키보드·게임패드 결과와 병합: 아날로그는 `max` (steer는 절대값이 큰 쪽), 불리언은 OR. `item`/`pause`는 이전 프레임과 비교해 edge 생성.
- `Game.ts`가 TouchControls를 생성해 `uiRoot`에 붙이고 `input.attachTouch(touch)` 호출. 상태 전이 시 `touch.setVisible(state === 'countdown' || state === 'racing')`.

### 레이아웃
```
[⏸]                                 (HUD)
                                  ( ITEM )
   ( 스틱 )                       ( DRIFT )
```
- 스틱: 화면 왼쪽 45% 영역 어디를 눌러도 그 자리에 생성(플로팅). 노브 이동 벡터 `(dx, dy)` / 반경 60px → `steer = clamp(dx)`, `throttle = max(0, -dy)`, `brake = max(0, dy)`. 데드존 0.12(반경 비율), 그 밖은 선형. 손을 떼면 전부 0.
- DRIFT(하단 우측, 큼), ITEM(그 위, 중간): 홀드 상태를 그대로 노출. 스틱을 6시로 내린 채(`brake > 0.5`) ITEM → 기존 규칙으로 뒤로 던지기.
- ⏸: 좌상단 40px 버튼. 룩백은 터치에서 미지원.
- 멀티터치: 포인터별 `pointerId`로 스틱/버튼 소유 추적. `pointercancel`/`blur`/`visibilitychange`에서 전부 해제.
- 오버레이 CSS: `touch-action: none; user-select: none; -webkit-tap-highlight-color: transparent;` 안전영역 `env(safe-area-inset-*)` 반영.

### 표시 조건
- `matchMedia('(pointer: coarse)')`가 true이거나 첫 `touchstart`가 window에 도달하면 `touchCapable = true`. 그 이후 racing/countdown에서만 보임. 키보드 입력이 들어와도 숨기지 않는다(단순화).
- 세로/가로 모두 동작. 회전 강제·안내 없음.

### 테스트 (vitest)
- 스틱 벡터→값 매핑 순수 함수 `stickToAxes(dx, dy, radius, deadzone)`: 12시=throttle 1, 6시=brake 1, 11시=throttle>0 & steer<0, 데드존 내부=0, 반경 초과=포화.
- `InputManager.update()` 병합: 터치 소스만 있을 때 결과, 키보드 throttle 1 + 터치 0.5 → 1, item 홀드 2프레임 → edge 1회.

---

## 2. 새 트랙 2개

빌더는 `beach`/`volcano` 테마를 이미 지원(TerrainField 프리셋, decor/landmarks/props/animated/barriers 분기 존재). 데이터 파일만 추가한다.

| 파일 | id | 테마 | 난이도 | 길이 목표 | 특징 |
|---|---|---|---|---|---|
| `src/track/tracks/coralCoast.ts` | `coral_coast` | beach | 2 | ~1050m | 해안 S벤드 연속, 넓은 모래 오프로드가 안쪽 숏컷을 유혹하는 구간, 방파제 롱 스트레이트, void 없음, 부스트패드 3, 아이템열 4 |
| `src/track/tracks/magmaRidge.ts` | `magma_ridge` | volcano | 3 | ~1300m | 고도차 최대 14m 등반→크레스트 점프, 용암 위 void 구간 2개(`voidRanges`, 도로 폭 좁게), 급경사 내리막 헤어핀, 마지막 롱 스트레이트, 부스트패드 3, 아이템열 4 |

- `tracks/index.ts` `TRACKS` 순서: sunny → coral → dune → frostbite → neon → magma (난이도 오름차순, 동률은 기존 우선).
- `environment`/`palette`는 기존 4개 트랙 값을 참고해 테마에 맞게 작성(베이지 모래·청록 바다 안개 / 검붉은 지면·주황 안개·낮은 태양).
- DEV `validateAllTracks`를 통과해야 한다. vitest에서도 두 트랙에 대해 `validate` 호출 + `Centerline` 길이 900~1400m 확인.
- **트랙 선택 UI**: `MainMenu` 카드 컨테이너를 6개 기준 3×2 그리드로(`style.css`). 좁은 화면(≤ 700px)은 2×3.

---

## 3. 밸런스 상수 노출 — `src/core/balance.ts`

### 원칙
- **수치는 현재값 그대로 복사**. 동작 변화 0. 원본 모듈은 로컬 `const`를 지우고 `BALANCE.x.y`를 참조.
- 옮기는 것: 게임 "느낌"을 바꾸는 값만. 시각/스크래치 상수(BOX_SIZE, ORBIT_*, ACCENT_EMISSIVE, `_v1` 등)는 제자리에 둔다.

### 구조
```ts
export const BALANCE = {
  kart:    { accelBase: 9, accelApproach: 2.2, boostAccel: 45, brakeDecel: 16, coastDecel: 4.5, steerRate: 1.9,
             driftSteerRate: 1.9, hopVelocity: 4.5, lateralGripRoad: 8, lateralGripOffroad: 4, wallRestitution: 0.3,
             reverseFraction: 0.35, reverseAccel: 5, overSpeedDecelMax: 10, overSpeedApproach: 2.0 },
  drift:   { minSpeed: 0.45, keepSpeed: 0.3, slipMax: 0.49, speedFactor: 0.965, boostStrength: 0.4, hopDriftDelay: 0.15 },
  status:  { spinDuration: 1.1, offroadFactor: 0.55, shrunkFactor: 0.65, starFactor: 1.2, squishFactor: 0.5 },
  items:   { greenSpeed: 34, redSpeed: 30, blueSpeed: 45, greenLife: 9, redLife: 8, bananaLife: 40,
             bombFuse: 2.5, explosionRadius: 4, lightningCooldown: 20, ownerGrace: 0.35 },
  itemTable: [ /* ITEM_TABLE 8행 그대로 */ ],
  ai:      { profiles: { easy: {...}, normal: {...}, hard: {...} }, rubberBand: 0.08, kP: 2.2, kD: 0.15,
             lookaheadMin: 8, lookaheadMax: 30, hazardLookahead: 25, boxSeekDistance: 60 },
  race:    { startBoostWindow: 0.6, startBoostWeakWindow: 1.2, startSpinoutHold: 2.6, wrongWaySeconds: 1.2,
             stuckSeconds: 6, finishGraceSeconds: 12 },
};
```
각 값 위에 단위와 효과를 한 줄 주석으로 적는다. `deepFreeze` 하지 않는다(런타임 오버라이드 허용).

### 오버라이드
- `applyBalanceOverridesFromURL(search: string)`: `b.<path>=<number>` 쿼리를 파싱해 `BALANCE`의 기존 숫자 경로만 덮어씀(존재하지 않는 키·비숫자 값은 무시하고 `console.warn`). `main.ts` 부트 시 `Game` 생성 전에 호출.
- `window.__balance = BALANCE` 노출. 모듈들이 매 프레임 프로퍼티를 읽으므로 콘솔 수정이 즉시 반영된다. 단 `PROFILES`처럼 생성 시 캡처하는 곳(AIDriver 생성자)은 다음 레이스부터 반영 — 주석으로 명시.
- 테스트: 파서가 숫자 경로만 바꾸는지, 잘못된 키 무시, 배열 인덱스(`b.itemTable.0.banana`)는 지원하지 않음을 명시.

### 문서
- `CONTRACT.md` "Contract additions"에 `balance.ts` 추가와 `TouchInputSource`, `i18n.ts` 추가를 기록.
- `NOTES.md` §4 표를 `balance.ts` 기준으로 갱신.

---

## 4. 한국어 UI — `src/core/i18n.ts`

### 구조
- `src/core/locales/en.ts`: `export const en = { 'menu.start': 'START RACE', ... } as const;` — 키의 원본.
- `src/core/locales/ko.ts`: `export const ko: Record<keyof typeof en, string> = { ... }` — 누락 시 컴파일 에러.
- `src/core/i18n.ts`: `type Lang = 'ko' | 'en'`, `t(key, params?)` (`{n}` 치환), `getLang()`, `setLang(l)` (localStorage `tkr.lang` 저장 + `events.emit('ui:langChange', {})`), `detectLang()` (`localStorage → navigator.language.startsWith('ko') → 'en'`). 모듈 로드 시 `document.documentElement.lang` 설정.
- `events.ts`에 `'ui:langChange': {}` 추가.

### 범위 (~80키)
- 메뉴: 타이틀 서브텍스트, "PRESS ENTER / CLICK TO START"(터치 기기면 "TAP TO START"), STEP 1/2 헤더, CHOOSE YOUR RACER / PICK A CIRCUIT, BACK/CONTINUE/START RACE, 난이도 EASY/NORMAL/HARD + 설명, 체급 LIGHT/MEDIUM/HEAVY, 스탯 라벨 5개, 랩 표기 "{n} LAPS".
- HUD: LAP, 서수(1st…8th → 1위…8위), FINAL LAP, WRONG WAY, GO!, 완주 배너, 위치 변동.
- 로딩: NOW LOADING, TIP, 팁 11개.
- 결과: RESULTS, 순위표 헤더, 시간 포맷, RETRY/CHANGE TRACK/TITLE 등 버튼.
- 일시정지: PAUSED, RESUME/RESTART/QUIT.
- 토스트/에러: WebGL2 필요, 시작 실패, 레이스 빌드 실패.
- 캐릭터 태글라인 8개 `char.<id>.tagline`, 트랙 설명 6개 `track.<id>.desc`. UI가 `t()`로 조회하고 키가 없으면 def의 영문 사용. **캐릭터/트랙 이름은 영문 고유명사 유지.**

### 전환
- 타이틀 화면 우상단 `KO | EN` 토글 버튼. 클릭 → `setLang` → `MainMenu.refreshText()`가 현재 화면의 텍스트 노드를 다시 채움(DOM 재구축 없이 라벨만 교체). HUD/로딩/결과/일시정지는 레이스마다 새로 만들어져 자연 반영.
- 한글 타이포: `html[lang="ko"]`에서 대문자용 `letter-spacing`·`text-transform: uppercase` 해제, 디스플레이 서체 스택 앞에 `"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic"` 추가.

### 테스트
- `detectLang` 3분기, `t()` 치환·누락키 폴백(키 문자열 반환), `Object.keys(en)`과 `ko`의 키 집합 일치.

---

## 테스트 인프라

- `vitest` devDependency 추가, `npm test` = `vitest run`. DOM이 필요한 테스트는 `// @vitest-environment jsdom` 표기(`jsdom` devDependency). 순수 로직은 node 환경.
- 완료 기준: `npm test`, `npm run typecheck`, `npm run build` 모두 클린.

## 구현 순서 및 검증

1. 터치 → 브라우저 패널 모바일 뷰포트(375×812, 812×375)에서 스틱·버튼으로 1랩 주행 확인
2. 트랙 2개 → 각 트랙 로딩·1랩 주행, validate 통과, 트랙 선택 3×2 레이아웃 확인
3. balance → typecheck 클린, 플레이 감 동일, `?b.kart.accelBase=20`으로 즉시 차이 확인
4. i18n → ko/en 토글, 레이스 HUD/결과 한국어, 새로고침 후 유지

각 단계는 별도 커밋. 이후 V8 연동 스펙으로 이어진다.
