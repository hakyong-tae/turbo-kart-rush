# Drift Dash GP (구 Turbo Kart Rush) — 구조 분석 노트

> 원본: https://github.com/bridge-mind/turbo-kart-rush (MIT, 커밋 1개 `6c0456c`)
> 로컬: `/Users/hytae/Downloads/Drift Dash GP` · 포트 **5178** · `.claude/launch.json` 항목 `turbo-kart-rush`
> Three.js 0.185 + TypeScript 7 + Vite 8. **에셋 파일 0개** — 지오메트리/텍스처/오디오 전부 런타임 생성.
> 원작 자체가 "Claude Fable 5.1 서브에이전트 5개가 프롬프트 1개로 만든 게임"이고, `CONTRACT.md`가 그 에이전트들 사이의 아키텍처 계약서. **이 문서(NOTES.md) + CONTRACT.md 두 개가 Verse8 AI 컨텍스트 문서.**

---

## 1. 실행 방법

```bash
export PATH="$HOME/.nvm/versions/node/v23.11.0/bin:$PATH"
cd /Users/hytae/Downloads/Drift Dash GP
npm run dev          # http://localhost:5178  (vite --host, strictPort 아님)
npm run typecheck    # tsc --noEmit  — 현재 클린
npm test             # vitest — touchMath / InputManager / tracks / balance / i18n (30 tests)
npm run build        # dist/  (base: './' → 서브경로 배포 OK)
npm run preview
```

- `index.html` → `/src/main.ts` (WebGL2 체크 → `new Game(#app).start()`), `/src/style.css` (1,938줄, UI 전부 DOM+CSS)
- 디버그 핸들: `window.__turboKartRush` (Game 인스턴스, private 필드 그대로 접근 가능)
- **로딩 90%에서 멈춘 것처럼 보이는 현상**: 탭이 백그라운드면 rAF가 멈추고 `loadingElapsed`가 안 늘어서 그런 것. 버그 아님. (Game.ts `frameLoading`: 셰이더 컴파일 완료 or 8초 타임아웃 후 100%)
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
    │   ├── LockSheet.ts / LeaderboardPanel.ts / SettingsPanel.ts ★(v8) 프리미엄 잠금 시트 · 트랙 기록 · 닉네임/언어/배경음악·효과음 볼륨(M키 음소거는 별도)
    │   ├── OnlinePanel.ts ★(online) 로비(퀵/생성/코드/목록) + 방(슬롯·READY·설정·START)
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
    ├── net/                 [G] ★(online) protocol(INPUT 6B/SNAPSHOT 153B) · roster · host-session · client-session(보간·보정) · lobby · online(컨트롤러+루프백 봇) · transport · loopback · FakeTrack(테스트)
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
- `loading`: 2프레임 대기 후 `buildRace()` **동기** 빌드 → `renderer.compile`로 셰이더 워밍을 걸고 로딩 프레임마다 `pollShaders()`로 완료 여부 확인(three의 `compileAsync`는 쓰지 않는다 — 컴파일 대기 중에 레이스가 해제되면 three의 타이머가 해제된 재질을 읽어 오류가 났다) → 100%면 `enterCountdown()`.
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
| **트랙 16개** | `src/track/tracks/*.ts` | `TrackDefinition`: controlPoints(x,y,z 폐루프) · halfWidth(s) · wallHalfWidthFactor · itemBoxRows[t] · boostPads[t] · voidRanges · environment(sky/fog/sun/ambient) · palette(road/curb/offroad/wall/ground). 새 트랙 = 파일 1개 + `tracks/index.ts` 배열 추가. DEV에서 `validate.ts`가 자동 검증 |
| **캐릭터 16명**(레이스는 8대) | `src/kart/roster.ts` | `id/name/weightClass/stats{speed,acceleration,handling,weight,miniTurbo ∈0..1}/color/tagline` |
| **글로벌 물리** | `src/core/constants.ts` | BASE_TOP_SPEED 22, GRAVITY 26, KART_RADIUS 0.85, FIXED_DT, CHECKPOINT_COUNT 12, ITEM_BOX_RESPAWN 3s, ROULETTE 1.6s |
| **카트 핸들링** | `src/kart/Kart.ts:30-69` | ACCEL_BASE 9, BRAKE_DECEL 16, STEER_RATE 1.9, HOP_VELOCITY 4.5, DRIFT_SLIP_MAX 0.49, DRIFT_BOOST_STRENGTH 0.4(미니터보 1/2/3단 = 0.7/1.2/1.8s), OFFROAD 0.55, SHRUNK 0.65, STAR 1.2, LATERAL_GRIP_ROAD 8 |
| **아이템 확률표** | `src/items/ItemManager.ts:109` `ITEM_TABLE[place-1]` | 1위: banana 35/green 35/red 15/triple_banana 10/bomb 5 … 8위: star 22/golden 22/lightning 17/blue 16. 총 ItemType 14종(단일 11 + triple 3, 자석은 gameplay-2 추가) |
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
| 4 | ~~싱글플레이 전용~~ ✅ **완료(online-multi + item-sync)** 호스트 권위 스냅샷+예측, 2~8인+AI, 퀵/목록/코드 방, **아이템 동기화**(미러 모드·FX 재방출·useSeq). 실 2인 검증은 V8 호스트에서. **호스트 승격(hostEpoch, adoptFromKarts)** 완료. 다음: 카트 위 닉네임·관전 | 네트워크 코드 0 | 멀티는 `Kart.setInput`이 외부 InputState를 받는 구조여서 록스텝/입력동기 방식이 자연스러움 |
| 5 | ~~영문 UI 하드코딩~~ | ✅ **완료(local-mods)** `core/i18n.ts` ko/en, 타이틀 우상단 KO\|EN 토글(메뉴·오버레이 재구축), localStorage `tkr.lang`, navigator.language ko 자동. 캐릭터/트랙 이름은 영문 유지 | 토글은 타이틀에서만 |
| 6 | 텍스처 전부 CanvasTexture | 로딩 시 CPU로 생성 | 저사양에서 첫 로딩 수 초. 캐싱 or 해상도 옵션 여지 |
| 7 | `PCFSoftShadowMap` deprecated 경고 | three 0.185에서 PCF로 폴백 | 무해. `Game.ts` 렌더러 설정에서 `PCFShadowMap`으로 바꾸면 경고 제거 |
| 8 | 라이선스 | MIT (코드), 에셋 없음 → 저작권 이슈 0 | 캐릭터/트랙 이름도 자체 IP. Verse8 상업 배포 문제 없음 |
| 9 | ~~폰 레이아웃 미검증~~ | ✅ **완료(onestore-mobile, 26-09-07)** 폰 브레이크포인트(≤700w / ≤480h): 선택 패널 스크롤+sticky 푸터, 레이서 2열, 세로 메뉴 카메라 프레이밍, 일시정지 HUD 페이드, 타이틀 키보드 안내 숨김. `tools/mobile-audit.mjs`로 40장 캡처 검증 | 실기기 30분 세션·기기명은 원스토어 폼 제출 전 직접 (`docs/ONESTORE-FORM.md`) |
| 11 | 구조 정리(26-09-07) | ✅ `docs/ARCHITECTURE.md` 모듈 지도. style.css→`src/styles/` 14분할, Kart 어시스트(`kart/assists/`), HUD 위젯(`ui/hud/`), Game 보조(`TeamMarkers`/`OrientationGate`/`settingsStore`) 분리. 프레임당 할당 0 원칙 | 슬립스트림 보너스=체급 매트릭스 `BALANCE.slipstream.bonus` |
| 12 | UI 개편 "서킷 포스터"(26-11-17) | ✅ 브랜치 `ui-circuit-poster`. 검정 아스팔트 + 레이스 옐로 하나, 평행사변형·체커·번호판, 선 아이콘(`ui/icons.ts`), 그라데이션·유리 패널·이모지 제거. 로비 배경은 출발 그리드. 조작법 표는 설정 + 첫 레이스 로딩으로 이동. 미니맵은 순위표 아래(터치는 상위 3명+나) | 스펙·판단 기록 `docs/superpowers/specs/2026-11-17-ui-circuit-poster-design.md`, 캡처 `node tools/mobile-audit.mjs --hud` |
| 13 | 카트·서킷 확장 + 트랙 기믹(26-11-18) | ✅ 브랜치 `karts-circuits-gimmicks`. **레이서 16명**(새 8명 중 4명 프리미엄: coco·zorp·vera·brine), **서킷 16개**(Windmill Way·Tidal Run·Stunt Park·Tram Town·Canyon Rally·Glacier Gap·Ashfall Run·Skyline Loop), 컵 5개(스턴트·익스트림 추가, 챔피언십은 기존 8개 유지). **기믹**: 점프대·끊긴 다리(`ramps`), 얼음·진흙·부스트 띠(`zones`), 굴러오는 바위·눈덩이·용암, 건널목 전차(`movers`, 레이스 시간의 순수 함수라 온라인 동기화 불필요), 벽 물리기(`wallHalfWidthFactors`), 공중 묘기(공중에서 드리프트 → 착지 부스트). 기존 8개 서킷에도 기믹 추가. 선택 화면은 16장이 1000×700 이상에서 스크롤 없이 들어옴(폰 가로는 레이서 6열). 검증 도구 `tools/track-soak.mjs`(AI 8대 완주 검사)·`track-preview.mjs`(평면도)·`track-profile.mjs` | 기존 서킷 랩 타임이 달라져 서버의 기존 기록과 직접 비교 불가. 서킷 수가 바뀌어 오늘의 도전 서킷 배정이 전 날짜에서 바뀜. `server.js`의 `TRACKS`·`CUPS`·`CHARACTERS`·`PREMIUM`을 같이 배포해야 함. 스펙 `docs/superpowers/specs/2026-11-17-karts-circuits-gimmicks-design.md` |
| 14 | 실제 서킷 평면을 본뜬 주로(26-11-18) | ✅ 같은 테마·같은 난이도라 서로 닮았던 두 서킷을 실제 그랑프리 서킷의 평면으로 다시 깔았다. **Windmill Way** = 잔드보르트(네덜란드 해변 서킷) 1:3.8, 1,122m. **Canyon Rally** = 바레인(사막 서킷) 1:4.2, 1,293m. 이름·기믹·테마는 그대로, 제어점만 교체. 도구 `tools/track-from-plan.py`(GeoJSON 중심선 → 축소 → 가까운 구간 벌리기·급코너 펴기 → 스플라인 맞춤). 실제 서킷의 자잘한 코너 묶음은 카트 폭 도로에 안 들어가서 하나로 합쳐지고 윤곽만 남는다 | 게임 안 문구에는 실제 서킷 이름·F1 상표를 쓰지 않는다(평면 형태만 참고). 두 서킷의 랩 타임이 달라졌다. 다른 서킷도 같은 도구로 바꿀 수 있다 |
| 15 | 진행 시스템: 코인·미션·출석·레벨(26-11-18) | ✅ 브랜치 `claude/progression-coins-7d5a85`. **버는 쪽**: 레이스(1등 60~8등 10, 리타이어 5, 쉬움 ×0.8·어려움 ×1.3, 하루 10판 전액 → 30% → 61판부터 0), 경험치·레벨 30(레벨업마다 100코인), 일일 미션 3개(쉬움 40·보통 70·어려움 120, 3개 완료 +100, 서버가 날짜 시드로 16후보에서 선정), 출석 7일 주기(50~300), 보상형 광고 3곳(코인 2배 하루 5회·출석 복구·미션 교체 하루 1회). **쓰는 쪽**: 유료 외형 73종을 하나씩(300~1,000, 합계 42,200), 프리미엄 카트 각 2,500, 획득 전용 14종(레벨 6·누적 출석 3·코인 진열대 5, 100VX로 안 열림). 100VX 패스는 그대로 73종+전 카트. **서버 함수** `beginRace`·`finishRace`·`buyCosmetic`·`buyKart`·`doubleRaceCoins`·`claimAttendance`·`swapMission`, **유저스테이트** `coins`·`own`·`eco`·`race`·`award`·`xp`·`mis`·`streak`. 금액은 전부 `server.js`가 계산(클라는 순위·시간·카운터만 보고). **로컬 모의**: 호스트 밖에서는 같은 `server.js`를 브라우저에서 실행(`src/verse8/localServer.ts`, `localStorage` `tkr.local.user`), `?coins=5000`으로 지갑 채우기 | 규칙 표는 `server.js`와 `src/core/economy.ts` 두 곳(`serverEconomy.test.ts`가 일치 검사). 콘솔에 광고 placement 3개 등록 필요(`rewarded_double_coins`·`rewarded_streak_recover`·`rewarded_mission_swap`). 헬멧 장식 외형은 아직 없음. 스펙 `docs/superpowers/specs/2026-11-18-progression-server-design.md` |
| 16 | 렉 두 가지(26-11-19, QC 제보) | ✅ **레이서 선택**: 카드에 커서가 지날 때마다 3D 카트를 새로 만들던 것을 고쳤다. `MenuBackdrop`이 만든 카트를 id별로 보관하고, 메뉴가 열리면 0.8초 뒤부터 0.18초마다 한 대씩 16대를 미리 만들며(텍스처 업로드·셰이더 준비 포함), 새 카트는 선택이 0.12초 머물 때만 만든다. 16장 5번 훑기에서 50ms 넘는 프레임 90번이 0번이 됐다. **레이스**: 배기 불꽃·아이템 상자 링처럼 더해 그리는 양면 반투명 재질에 `forceSinglePass`를 넣었다(three가 매 프레임 두 번 그리며 `needsUpdate`를 세우던 것: 60프레임에 3,960번이 0번). 안 보이는 불꽃은 숨기고, `warmShaders`가 컴파일 직전에 불꽃을 잠깐 보이게 한다 | 보관 카트는 다시 보여 줄 때 저장된 꾸미기와 비교해 다시 칠한다(`cosKey`). `forceSinglePass`는 AdditiveBlending + `depthWrite:false` 재질에만 넣는다. 불꽃을 숨기는 코드와 `warmShaders`의 보이기 코드는 짝이라 하나만 옮기면 안 된다 |
| 17 | 온라인 참가자(미러) 쪽 코인 정산(26-11-19) | ✅ 브라우저 두 개(방장·참가자)로 실제 온라인 레이스를 돌려 확인했다. **완주**: 참가자 2위 → 45코인·경험치 50, 미션 집계(아이템·명중·묘기)가 서버 진행도와 일치. **방장 이탈**: 15초에 방장 창을 닫으면 참가자가 방장으로 승계돼 결승선에서 정상 지급(3위 35 + 미션 40). **리타이어(버그, 수정)**: 참가자는 카운트다운 뒤 자기 `RaceManager`를 돌리지 않아 `raceTime`이 0에 멈춰 있는데, `settleRace`가 리타이어 때 그 값을 레이스 길이로 보내 서버가 `bad-time`으로 거절했다(결과 화면엔 "레이스 시작이 서버에 기록되지 않아…"). 이제 `Game.raceClock()`이 참가자에서는 방장 스냅샷의 시계를 쓴다 → 리타이어 +5코인·경험치 10. 방장이 사라져 승계할 사람도 없을 때의 정산(`showOnlineResults`)도 같은 시계를 쓴다(실행 확인은 못 함). 도구: `node tools/online-settle-check.mjs finish|retire|migrate` (개발 서버 필요, 릴레이를 Node가 대신하고 `ONLINE_ENABLED`를 켜서 띄운다). ⚠️ 온라인은 여전히 `ONLINE_ENABLED = false`로 출시 중이라 플레이어가 이 경로에 닿지는 않는다. 실제 Verse8 릴레이·실기기 2대는 미확인. |
| 18 | CrazyGames 재도전: Drift Kart(26-11-20) | ✅ 브랜치 `crazygames-relaunch`. CrazyGames Basic Launch 탈락(PC 8/15·모바일 7/15, 플레이타임과 D1이 약점)에 대한 수정. 명세·판단·검증은 `docs/superpowers/specs/2026-11-20-drift-kart-crazygames-relaunch.md`. **빌드 타깃**: `src/core/platform.ts`가 이름과 기능 스위치를 정한다. `npm run build` = Verse8·원스토어판(DRIFT DASH GP), `npm run build:crazygames` = CrazyGames판(DRIFT KART, `dist-crazygames/`, VX·보상형 광고·온라인 없음, Verse8 SDK 대신 스텁, 문구 테이블에서 상대 판 문구 제거). **첫 세션**: 새 계정은 로비 없이 바로 Sunny Circuit 레이스, 첫 카드가 출발을 붙잡는 4단계 안내, 첫 3판은 입문 난이도(`BALANCE.ai.intro`, AI는 공격 아이템 없음), 플레이어는 우승자 +30초(전진 중이면 +75초까지) 리타이어 유예. **해금 사다리**(`server.js` `lad`): 서킷 4개로 시작해 완주마다 +1, 완주 1·2·3·5회 / 3위 안 / 1등 / 드리프트 부스트 10회 / 출석 2일차에 차고 항목 무료. 기존 계정은 16개 그대로. **결과 화면**: 보상을 위로, "새로 열림" 카드, "다음 해금" 진행 바, 주 버튼 "다음 레이스 · 서킷 이름", 폰은 상위 3명+나. **그 밖**: 터치 자동 가속(설정에서 끔)과 상시 스틱, HUD 조작 안내와 이벤트 피드, 로비 버튼 정리, 마지막 랩 아이템 상자 한 줄 추가. 도구: `tools/first-session.mjs`(새 저장 3판 주행 점검), `tools/crazygames-check.mjs`(CrazyGames 빌드 문구·크기·첫 화면·요청 호스트 점검), `tools/unlock-card-check.mjs`(결과 화면 해금 카드 이름 잘림), `tools/hud-feed-check.mjs`(피드와 순위 번쩍임 겹침). **글꼴**: CrazyGames 빌드는 외부 요청 0건이다. `src/assets/fonts/`의 Anton·Black Han Sans·Noto Sans KR(OFL)을 싣고 빌드가 `index.html`의 Google Fonts 링크를 `src/styles/fonts-local.css`로 바꾼다. 한글 두 글꼴은 게임에 나오는 글자만 추린 것이라 **한국어 문구를 추가하면 `python3 tools/subset-fonts.py <원본 글꼴 폴더>`로 다시 만든다**(`src/assets/fonts/charset.test.ts`가 잡는다). 기본 빌드는 그대로 Google Fonts. | Verse8 호스트 안 동작, 실기기 터치, 사람이 모는 입문 난이도 체감은 확인하지 못했다. CrazyGames SDK는 연동하지 않았다(`marketing/crazygames/SUBMISSION.md`의 "Before a Full Launch"). 첫날 미션·사다리의 "드리프트 부스트"는 2단계 이상만 센다: 초보가 3판 안에 10회를 채우기 어려울 수 있다. |
| 10 | ~~카트 8대가 색놀이~~ | ✅ **완료(kart-bodies, 26-09-07)** `kart/bodies.ts`에 캐릭터별 차체 스펙 8종(화살촉·버블카·사막버기·기준형·스텔스웨지·서프덱·몬스터·트럭). 바퀴/시트/드라이버/배기는 공통, 재질별 배치 병합 유지(카트당 ≤28 메시). 검증 `node tools/kart-lineup.mjs` | 물리·충돌 반경 변경 없음(비주얼만) |

---

## 7. Verse8 AI 프롬프트용 한 줄 요약

> Three.js 0.185 + TS + Vite 아케이드 카트레이서. 100% 프로시저럴(에셋 파일 없음). `src/core`(types/events/constants)가 프로즌 계약이고 game/kart/track/items+ai/audio+fx 5모듈이 인터페이스+이벤트버스로만 통신. 상태머신 title→characterSelect→trackSelect→loading→countdown→racing→finished→results. 고정스텝 1/120 물리(Kart.update) + 렌더레이트 비주얼. 데이터: 트랙 4개(`track/tracks/*.ts` TrackDefinition), 캐릭터 8명(`kart/roster.ts`), 아이템 확률표(`items/ItemManager.ts ITEM_TABLE`), AI 난이도(`ai/AIDriver.ts PROFILES`). 입력은 `InputManager → InputState → kart.setInput` 단방향이라 터치/네트워크 입력 추가가 쉬움. 터치 입력·저장·리더보드·멀티 없음.
