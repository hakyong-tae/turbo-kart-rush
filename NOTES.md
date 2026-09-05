# Turbo Kart Rush — 구조 분석 노트

> 원본: https://github.com/bridge-mind/turbo-kart-rush (MIT, 커밋 1개 `6c0456c`)
> 로컬: `/Users/hytae/Downloads/turbo-kart-rush` · 포트 **5178** · `.claude/launch.json` 항목 `turbo-kart-rush`
> Three.js 0.185 + TypeScript 7 + Vite 8. **에셋 파일 0개** — 지오메트리/텍스처/오디오 전부 런타임 생성.
> 원작 자체가 "Claude Fable 5.1 서브에이전트 5개가 프롬프트 1개로 만든 게임"이고, `CONTRACT.md`가 그 에이전트들 사이의 아키텍처 계약서. **이 문서(NOTES.md) + CONTRACT.md 두 개가 Verse8 AI 컨텍스트 문서.**

---

## 1. 실행 방법

```bash
export PATH="$HOME/.nvm/versions/node/v23.11.0/bin:$PATH"
cd /Users/hytae/Downloads/turbo-kart-rush
npm run dev          # http://localhost:5178  (vite --host, strictPort 아님)
npm run typecheck    # tsc --noEmit  — 현재 클린
npm test             # vitest — touchMath / InputManager / tracks / balance / i18n (30 tests)
npm run build        # dist/  (base: './' → 서브경로 배포 OK)
npm run preview
```

- `index.html` → `/src/main.ts` (WebGL2 체크 → `new Game(#app).start()`), `/src/style.css` (1,938줄, UI 전부 DOM+CSS)
- 디버그 핸들: `window.__turboKartRush` (Game 인스턴스, private 필드 그대로 접근 가능)
- **로딩 90%에서 멈춘 것처럼 보이는 현상**: 탭이 백그라운드면 rAF가 멈추고 `loadingElapsed`가 안 늘어서 그런 것. 버그 아님. (Game.ts `frameLoading`: 셰이더 `compileAsync` 완료 or 8초 타임아웃 후 100%)
- 내장 브라우저 패널은 오디오 뮤트(`🔇 MUTED` 표시). 일반 크롬에서 열어야 사운드 확인 가능.
- GitHub Pages 배포: `.github/workflows/deploy.yml` (node 22, `npm ci && typecheck && build` → Pages)
- **Verse8 배포·규칙**: `docs/VERSE8-CONTEXT.md` (깨뜨리면 안 되는 것 7개, 콘솔 체크리스트, develop push + V8 Agent 프롬프트)

---

## 2. 파일 구조 (총 20,657줄)

```
turbo-kart-rush/
├── index.html               Vite 진입점 (#app 하나 + main.ts)
├── vite.config.ts           base './', port 5178, target es2022
├── tsconfig.json            strict, ESNext/bundler, noEmit
├── CONTRACT.md              ★ 5개 워크스트림 아키텍처 계약 (모듈 소유권·public API·월드 규약)
├── README.md                원작 프롬프트·기능·조작법
└── src/
    ├── main.ts (79)         WebGL2 감지 → 전역 에러 토스트 → Game 부트
    ├── style.css (1938)     메뉴/HUD/토스트 전부. 글래스모피즘, 시스템 폰트만(웹폰트 X)
    │
    ├── core/                ★ FROZEN — 모든 모듈이 여기만 의존
    │   ├── types.ts (515)   IKart·ITrack·IItemManager·IAIDriver·IAudioEngine·IParticleSystem·IPostFX 인터페이스,
    │   │                    TrackDefinition·CharacterDef·KartState·RaceSettings·GameState·ItemType 등
    │   ├── constants.ts (58) KART_COUNT=8, FIXED_DT=1/120, BASE_TOP_SPEED=22, GRAVITY=26, CHECKPOINT_COUNT=12 …
    │   ├── balance.ts ★(local-mods) BALANCE 튠 객체 + `?b.<path>=` URL 오버라이드 + window.__balance
    │   ├── i18n.ts / locales/{en,ko}.ts ★(local-mods) t()/setLang/detectLang, 키 ~130개, ko 누락시 컴파일 에러
    │   ├── events.ts (108)  타입드 이벤트 버스 `events.emit/on` — race:* kart:* item:* game:* ui:* (약 45종)
    │   └── math.ts (135)    clamp/lerp/damp/seededRandom/fbm2 등
    │
    ├── game/                [A] 게임 루프·오케스트레이션
    │   ├── Game.ts (938)    렌더러/씬/카메라/라이트, 상태머신, 고정스텝 루프, 모든 모듈 생성·배선(buildRaceInner), dispose
    │   ├── RaceManager.ts (510) 카운트다운·체크포인트·랩·순위·완주·리스폰·역주행·스타트부스트
    │   ├── FollowCamera.ts (255) 체이스캠 (거리 6.5/높이 2.6, FOV 70→82, 드리프트 린, 룩백, 셰이크)
    │   └── MenuBackdrop.ts (515) 타이틀 뒤 회전하는 3D 카트+포디움+파티클
    │
    ├── ui/                  [A] DOM 오버레이 (캔버스 위 absolute div)
    │   ├── MainMenu.ts (388) title → characterSelect → trackSelect (난이도 easy/normal/hard 토글 포함)
    │   ├── HUD.ts (395)     순위 숫자, 랩, 아이템 슬롯+룰렛, 속도계, 타이머, 카운트다운, FINAL LAP/WRONG WAY 배너
    │   ├── Minimap.ts (172) 220px 캔버스, 트랙 폴리라인 + 카트 점
    │   ├── LoadingScreen.ts (99) 트랙명+팁+프로그레스바
    │   ├── PauseMenu.ts (76), ResultsScreen.ts (134) 결과표+컨페티
    │   ├── TouchControls.ts / touchMath.ts ★(local-mods) 가상 스틱(좌)+DRIFT/ITEM/⏸(우), TouchInputSource 구현
    │   ├── LockSheet.ts / LeaderboardPanel.ts / SettingsPanel.ts ★(v8) 프리미엄 잠금 시트 · 트랙 기록 · 닉네임/언어/음소거
    │   └── dom.ts (106) `el()` 헬퍼, toast.ts (27)
    │
    ├── kart/                [B] 카트 물리·모델·입력·로스터
    │   ├── Kart.ts (987)    아케이드 물리 (가속/브레이크/조향/홉/드리프트 3단 미니터보/부스트/스핀/스타/축소/벽·카트 충돌)
    │   ├── KartModel.ts (582) 캐릭터별 프로시저럴 카트 메쉬 (바디·휠·드라이버·배기)
    │   ├── InputManager.ts (250) 키보드+게임패드(+attachTouch 터치 병합) → InputState (edge-trigger 불리언)
    │   └── roster.ts (98)   CHARACTERS 8명 (light 3 / medium 3 / heavy 2), stats 0..1
    │
    ├── track/               [C] 트랙 빌더 + 환경
    │   ├── Track.ts (333)   `new Track(def)` 동기 빌드: 센터라인→체크포인트→그리드→미니맵→빌더 순차 add
    │   ├── Centerline.ts (283) CatmullRomCurve3(closed, centripetal), ~2000 샘플 LUT, closestT, 커브처
    │   ├── TerrainField.ts (216) fbm2 지형 높이필드, 도로 근처 평탄화
    │   ├── textures.ts (700) CanvasTexture 생성기 (도로/커브/잔디/사막/눈/네온/관중 등)
    │   ├── builders/        sky·terrain(+mountains)·road·barriers·decor(인스턴싱)·landmarks·props(그랜드스탠드/갠트리/스폰서브릿지/부스트패드)·animated
    │   └── tracks/          ★ 데이터 파일 — sunny / coral(beach★★) / dune / frostbite / neon / magma(volcano★★★) + validate.ts(DEV 검증)
    │
    ├── verse8/              [F] ★(v8) embed(핸드셰이크) · server(agent8 래퍼) · ads · shop(VXShop) · entitlements(서버권위 캐시+mock) · nickname
    ├── items/               [D] 아이템
    │   ├── ItemManager.ts (1340) 박스 스폰/리스폰, 순위별 룰렛 확률표(ITEM_TABLE), 발사체·해저드 시뮬, 충돌, 삼단 오빗
    │   └── itemVisuals.ts (907) 아이템 3D 메쉬 + `buildItemIcon()` 64px 캔버스 아이콘
    │
    ├── ai/AIDriver.ts (618) [D] 레이싱라인(센터+성격 오프셋+코너 인사이드), PD 조향, 드리프트, 해저드 회피, 박스 추적, 아이템 사용 판단, 러버밴딩, 스턱/역주행 복구
    │
    ├── audio/               [E] Web Audio 전부 합성
    │   ├── AudioEngine.ts (419) IAudioEngine 구현, 크로스페이드, 뮤트
    │   ├── engine.ts (315)  카트별 엔진음 (saw+square+sub, 로우패스, 속도→피치, PannerNode 위치음)
    │   ├── sfx.ts (882)     30여종 효과음 프리셋
    │   ├── music.ts (735)   칩튠 시퀀서 (menu / race 150bpm / finalLap +10% +1semitone / results)
    │   └── synth.ts (322)   오실레이터/노이즈/엔벨로프 프리미티브
    │
    └── fx/                  [E]
        ├── ParticleSystem.ts (1315) 6000개 GPU 풀 (Points, 수명/속도/중력/사이즈·컬러 커브), 프리셋별 emit + 카트 상태 기반 연속 이미터
        ├── PostFX.ts (248)  EffectComposer: RenderPass → UnrealBloom(0.5/0.85) → 커스텀 ShaderPass → OutputPass
        └── shaders.ts (223) 스피드라인·래디얼블러·색수차·비네트·히트틴트·플래시 GLSL
```

---

## 3. 아키텍처 핵심

### 3.1 모듈 격리 원칙 (CONTRACT.md)
- `src/core/**`만 공유. 다른 모듈의 **구체 클래스 import는 `Game.ts`에서만** 허용.
- 모듈 간 통신 = ① `types.ts` 인터페이스 ② `events.ts` 이벤트 버스 ③ `constants.ts`.
- 예: 오디오/FX는 `kart:driftStage`, `item:hit` 같은 이벤트를 구독해서 반응. Kart는 오디오를 모름.
- → **한 모듈만 뜯어서 갈아끼우기 쉬움** (예: 트랙 데이터만 추가, 로스터만 교체, 입력만 터치로 확장).

### 3.2 게임 상태머신 (`GameState`)
```
boot → title → characterSelect → trackSelect → loading → countdown → racing ⇄ paused
                                                                        ↓
                                                                    finished → results → title
```
- `Game.frame(dt, input)`가 상태별 분기. 메뉴 상태는 `MainMenu.handleInput` + 백드롭 렌더.
- `loading`: 2프레임 대기 후 `buildRace()` **동기** 빌드 → `renderer.compileAsync`로 셰이더 워밍 → 100%면 `enterCountdown()`.
- `finished`: 플레이어 완주 후 `playerAutoDriver`(AIDriver)가 플레이어 카트 자동주행, 전원 완주 or 12초 후 results.

### 3.3 루프
- rAF → `dt` (max 1/20 클램프) → `InputManager.update()` → `frame()`.
- 레이스 중 `simulate()`: 고정스텝 **FIXED_DT=1/120** 누적기, 프레임당 최대 8스텝.
  - `step()`: 입력 세팅 → `AIDriver.update` ×7 → `Kart.update(dt, track, others)` ×8 → `ItemManager.update` → `RaceManager.update`
- 렌더레이트: `updateVisuals`, FollowCamera, ParticleSystem, AudioEngine, HUD, PostFX.

### 3.4 월드 규약
- 미터 단위, +Y up, 카트 forward = 로컬 **-Z**, `heading`은 Y회전.
- 트랙 파라미터 `t ∈ [0,1)` wrap, `t=0`=피니시라인, +t 방향 주행. `raceProgress = lap + t` (단조증가, 순위 산출용).
- `ITrack.query(xz)` → `{ groundY, t, lateral, surface: road|offroad|boost|wall|void }`.
- 표면 효과: offroad ×0.55 / boost 패드 +45% 1.3s / void → VOID_Y(-30) 아래면 마지막 체크포인트 리스폰.
- 카트 8대, id 0 = 플레이어(그리드 슬롯 7 = 맨 뒤).

### 3.5 buildRaceInner 배선 (Game.ts:597)
`Track(def)` → 플레이어 Kart(0) + 나머지 7캐릭터 셔플해 AI Kart(1..7) → `AIDriver(kart, difficulty, seed=id)` → `ItemManager(particles).init(track, karts)` → `RaceManager(track, karts, settings)` → `FollowCamera.setTrack` → `HUD(uiRoot, buildItemIcon).setTrack` → 라이트(env에서 sun/hemi/fill/fog/background) → scene.add. 전부 `RaceContext r`에 담아두고 `disposeRace()`에서 일괄 dispose.

---

## 4. 밸런스/데이터 파일 (여기만 바꿔도 게임이 달라지는 곳)

> **26-09-04부터** 느낌 상수는 전부 `src/core/balance.ts`의 `BALANCE`에 모여 있다(값은 원본 그대로). `?b.kart.accelBase=11` 식 URL 오버라이드, 콘솔 `__balance` 실시간 수정 가능(AI 프로필은 다음 레이스부터). 아래 표의 Kart.ts/ItemManager/AIDriver/RaceManager 위치는 원본 기준이며 지금은 `BALANCE.kart / .drift / .status / .items / .itemTable / .ai / .race`에서 찾으면 된다.

| 항목 | 위치 | 내용 |
|---|---|---|
| **트랙 4개** | `src/track/tracks/*.ts` | `TrackDefinition`: controlPoints(x,y,z 폐루프) · halfWidth(s) · wallHalfWidthFactor · itemBoxRows[t] · boostPads[t] · voidRanges · environment(sky/fog/sun/ambient) · palette(road/curb/offroad/wall/ground). 새 트랙 = 파일 1개 + `tracks/index.ts` 배열 추가. DEV에서 `validate.ts`가 자동 검증 |
| **캐릭터 8명** | `src/kart/roster.ts` | `id/name/weightClass/stats{speed,acceleration,handling,weight,miniTurbo ∈0..1}/color/tagline` |
| **글로벌 물리** | `src/core/constants.ts` | BASE_TOP_SPEED 22, GRAVITY 26, KART_RADIUS 0.85, FIXED_DT, CHECKPOINT_COUNT 12, ITEM_BOX_RESPAWN 3s, ROULETTE 1.6s |
| **카트 핸들링** | `src/kart/Kart.ts:30-69` | ACCEL_BASE 9, BRAKE_DECEL 16, STEER_RATE 1.9, HOP_VELOCITY 4.5, DRIFT_SLIP_MAX 0.49, DRIFT_BOOST_STRENGTH 0.4(미니터보 1/2/3단 = 0.7/1.2/1.8s), OFFROAD 0.55, SHRUNK 0.65, STAR 1.2, LATERAL_GRIP_ROAD 8 |
| **아이템 확률표** | `src/items/ItemManager.ts:109` `ITEM_TABLE[place-1]` | 1위: banana 35/green 35/red 15/triple_banana 10/bomb 5 … 8위: star 22/golden 22/lightning 17/blue 16. 총 ItemType 13종(단일 10 + triple 3) |
| **아이템 파라미터** | `ItemManager.ts:28-49` | GREEN 34m/s(벽 6회 바운스) · RED 30 · BLUE 45 · BANANA_LIFE 40s · BOMB_FUSE 2.5s · EXPLOSION_RADIUS 4 · LIGHTNING_COOLDOWN 20s |
| **AI 난이도** | `src/ai/AIDriver.ts:53` `PROFILES` | easy/normal/hard 별 noise(0.09/0.045/0.015), reaction, driftThreshold, releaseStage(1/2/3), usesMushrooms, 스타트 타이밍. 러버밴딩 ±8% (`:397`) |
| **레이스 규칙** | `src/game/RaceManager.ts:14-28` | START_BOOST_WINDOW 0.6s(약 1.2s) / 부스트 너무 일찍 = 스핀아웃 2.6s / WRONG_WAY 1.2s / STUCK 6s / FINISH_GRACE 12s |
| **카메라** | `FollowCamera.ts` | 거리 6.5, 높이 2.6, FOV 70→82 |
| **포스트FX** | `PostFX.ts` | bloom strength 0.5 / threshold 0.85 |
| **음악** | `audio/music.ts` | 트랙별 코드진행·BPM 상수 |

---

## 5. 핵심 시스템 요약

- **트랙 생성**: 컨트롤포인트 → CatmullRom 폐곡선 → 2000샘플 LUT(길이·탄젠트·바이노멀·커브처) → 도로 리본(폭 가변, UV 길이방향) + 연석 + 피니시 체커 + 벽/배리어(테마별) + fbm 지형(도로 근처 평탄) + 스카이돔(그라디언트 셰이더) + 인스턴싱 장식(나무/선인장/눈사람/네온 파일런) + 그랜드스탠드/관중 텍스처 + 부스트패드 + 미니맵 폴리라인. 전부 `TrackDefinition` 하나에서 결정론적으로 생성.
- **카트 물리**: 속도 스칼라 + 측면 슬립 모델(진짜 리지드바디 아님). 홉(0.15s 후 드리프트 진입) → 드리프트 중 조향 유지로 스테이지 상승 → 릴리즈 시 부스트. 충돌은 스피어-스피어, 무게로 임펄스 분배. 벽은 lateral > wallHalfWidth면 binormal로 푸시백.
- **아이템**: `requestUse(kart, aimBack)`. 레드셸은 트랙 t 기준 "앞 카트"를 호밍, 블루셸은 1위에게 비행 후 폭발, 라이트닝은 스타 제외 전원 축소+히트. 삼단 아이템은 카트 주위 오빗(반경 1.5). 스타 상태로 해저드 접촉 시 파괴.
- **AI**: 목표 = 센터라인 + 성격 lateral offset + 코너 인사이드 바이어스, 룩어헤드 8~30m(속도비례). PD(Kp 2.2, Kd 0.15). 커브처 임계 넘으면 드리프트, 프로필 스테이지에서 릴리즈. 해저드 25m 전방 감지 → 2.6m 회피. 아이템 없으면 60m 내 박스 추적. 플레이어와 거리로 탑스피드 ±8%.
- **오디오**: 카트 8대 각각 오실레이터 스택 + 비플레이어는 PannerNode. 스타 시 음악 대신 스타 징글 루프. finalLap은 race 시퀀스를 +10% 템포/+1키.
- **파티클**: 단일 Points 6000개 풀. 드리프트 스파크 색 = 스테이지(파랑/주황/보라), 부스트 화염, 타이어 스모크, 오프로드 먼지, 스피드 스트릭.

---

## 6. 알려진 제약 / 수정 포인트 후보

| # | 항목 | 현황 | 메모 |
|---|---|---|---|
| 1 | ~~모바일 터치 입력 없음~~ | ✅ **완료(local-mods)** `ui/TouchControls.ts` — 왼쪽 플로팅 스틱(12시 가속/6시 브레이크/좌우 조향) + DRIFT·ITEM·⏸. `pointer: coarse`거나 첫 touchstart 시 활성, 레이스 중에만 표시. 터치 모드에선 미니맵을 상단 중앙으로 축소 배치 | 실기기 테스트는 미완(패널 에뮬레이션만) |
| 2 | 로딩이 rAF 의존 | 탭 백그라운드면 진행 안 됨 | `loadingElapsed`를 `performance.now()` 기반으로 바꾸면 해결 |
| 3 | ~~세이브/기록 없음~~ ✅ **완료(v8-integration)** 루트 `server.js` + `src/verse8/`. 트랙별 완주시간 리더보드(계정당 1건), 닉네임(설정), 프리미엄 카트 3종 = 리워드 광고 3회권/VXShop 100VX(서버 유저스테이트). 실 호스트 검증은 배포 후 | 베스트랩·완주 기록 로컬스토리지 없음 | agent8 리더보드 붙이기 좋은 자리 = `race:finish` 이벤트(kartId 0, time) |
| 4 | 싱글플레이 전용 (→ 다음: V8 연동 스펙) | 네트워크 코드 0 | 멀티는 `Kart.setInput`이 외부 InputState를 받는 구조여서 록스텝/입력동기 방식이 자연스러움 |
| 5 | ~~영문 UI 하드코딩~~ | ✅ **완료(local-mods)** `core/i18n.ts` ko/en, 타이틀 우상단 KO\|EN 토글(메뉴·오버레이 재구축), localStorage `tkr.lang`, navigator.language ko 자동. 캐릭터/트랙 이름은 영문 유지 | 토글은 타이틀에서만 |
| 6 | 텍스처 전부 CanvasTexture | 로딩 시 CPU로 생성 | 저사양에서 첫 로딩 수 초. 캐싱 or 해상도 옵션 여지 |
| 7 | `PCFSoftShadowMap` deprecated 경고 | three 0.185에서 PCF로 폴백 | 무해. `Game.ts` 렌더러 설정에서 `PCFShadowMap`으로 바꾸면 경고 제거 |
| 8 | 라이선스 | MIT (코드), 에셋 없음 → 저작권 이슈 0 | 캐릭터/트랙 이름도 자체 IP. Verse8 상업 배포 문제 없음 |

---

## 7. Verse8 AI 프롬프트용 한 줄 요약

> Three.js 0.185 + TS + Vite 아케이드 카트레이서. 100% 프로시저럴(에셋 파일 없음). `src/core`(types/events/constants)가 프로즌 계약이고 game/kart/track/items+ai/audio+fx 5모듈이 인터페이스+이벤트버스로만 통신. 상태머신 title→characterSelect→trackSelect→loading→countdown→racing→finished→results. 고정스텝 1/120 물리(Kart.update) + 렌더레이트 비주얼. 데이터: 트랙 4개(`track/tracks/*.ts` TrackDefinition), 캐릭터 8명(`kart/roster.ts`), 아이템 확률표(`items/ItemManager.ts ITEM_TABLE`), AI 난이도(`ai/AIDriver.ts PROFILES`). 입력은 `InputManager → InputState → kart.setInput` 단방향이라 터치/네트워크 입력 추가가 쉬움. 터치 입력·저장·리더보드·멀티 없음.
