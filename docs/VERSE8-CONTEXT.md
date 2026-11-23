# Drift Kart (구 Drift Dash GP, 원작 Turbo Kart Rush) — Verse8 컨텍스트 (V8 AI / CLI 에이전트용)

이 문서는 Verse8 워크스페이스의 AI와 로컬 CLI 에이전트가 **먼저 읽어야 하는** 규칙이다. 구조 분석은 `NOTES.md`, 모듈 계약은 `CONTRACT.md`.

## 1. 이 게임은
- Three.js 0.185 + TypeScript + Vite 아케이드 카트레이서. **에셋 파일 0개** — 지오메트리·텍스처·오디오 전부 코드 생성. MIT.
- 트랙 16개(스위치백 패스=헤어핀, 프리즘 스카이웨이=가드 없는 공중 코스 포함. 점프대·끊긴 다리·얼음·진흙·움직이는 장애물 같은 기믹은 트랙 정의의 `ramps`/`zones`/`movers`), 캐릭터 16명(프리미엄 7: fennec·bram·rosa·coco·zorp·vera·brine), 컵 5개, 터치 조작, ko/en. **트랙·캐릭터·컵을 추가하면 루트 server.js의 `TRACKS`·`CHARACTERS`·`PREMIUM`·`CUPS`에도 같은 id를 넣어야 한다**(`src/verse8/serverLists.test.ts`가 일치를 검사).

## 2. 깨뜨리면 안 되는 것
1. `vite.config.ts`의 `base: './'` — 서브경로 호스팅 필수.
2. `@verse8/ads`는 **정적 import** 유지, `package.json` deps에서 빼지 말 것(동적 import는 번들에서 트리셰이킹된 사례 있음).
3. `src/verse8/server.ts`의 `@agent8/gameserver/dist/src/store/useGameServerStore` 딥임포트는 **리터럴 문자열**로만. `GameServer.connect()` 직접 호출 금지(스토어 경유) — 어기면 창 전환마다 재접속 폭풍.
4. `src/verse8/embed.ts`의 GAME_SIZE 핸드셰이크 제거 금지(iframe 뷰포트 0 방지).
5. 루트 `server.js` = 서버 함수 배포물(빌드 없음). 컬렉션 `tkr_times`, 유저스테이트 키 `premium` / `premiumRaces` / `nickname` / `cos` / `grants` (`adsRemoved`는 폐기된 구 키, 읽기만 호환) + 진행 시스템 키 `coins` / `own` / `eco` / `race` / `award` / `xp` / `mis` / `streak`(15·16번). **광고권·구매 상태·코인은 서버만 진실** — 클라 `src/verse8/entitlements.ts`는 캐시.
6. `src/core/**`는 프로즌 계약(추가만, 값 변경 금지). 튠 값은 `src/core/balance.ts`.
8. **빌드 타깃은 둘이다** (`src/core/platform.ts`). `npm run build`가 이 문서가 다루는 Verse8·원스토어판(`dist/`)이고, `npm run build:crazygames`는 CrazyGames판(`dist-crazygames/`)이다. **이름은 두 판 모두 DRIFT KART / 드리프트 카트**다(26-11-23 사용자 결정. 그 전까지 Verse8·원스토어판은 DRIFT DASH GP였다). 이름은 `src/core/platform.ts`와 `index.html`(제목·탭 아이콘·시작 스플래시) 두 곳에 적혀 있다. 저장 키(`tkr.*`)·서버 컬렉션·상품·광고 placement 이름에는 게임 이름이 없어서 그대로다. CrazyGames판은 VX 결제·보상형 광고 버튼·온라인이 없고, Verse8 SDK 대신 `src/verse8/stubs/sdk.ts`가 들어가며, 계정은 브라우저 저장소의 `server.js`(localServer)가 맡는다. 게임 이름은 문자열로 적지 말고 `GAME_TITLE` / `PLATFORM.name` / 문구의 `{game}`을 쓴다. 타깃별로 달라야 하는 문구는 `'<키>@crazygames'` 항목을 하나 더 둔다.
9. **첫 세션 사다리**(2026-11-20): 유저스테이트 키 `lad`(레이스·완주·3위 안·1등·드리프트 부스트 횟수, 가입일). 새 계정은 서킷 4개로 시작해 완주마다 하나씩 열리고, 사다리 조건을 채우면 차고 항목이 무료로 열린다. **`lad`가 없으면서 다른 키가 하나라도 있거나 `tkr_times`에 기록이 있는 계정은 `lad.all = true`로 16개 전부 열린 채 시작한다.** 표는 `server.js`(`LADDER`, `TRACK_ORDER`, `START_TRACKS`, `INTRO_RACES`, `FIRST_DAY_MISSIONS`)와 `src/core/economy.ts` 두 곳이며 `serverEconomy.test.ts`가 맞춘다. `TRACK_ORDER`는 `TRACKS_BY_DIFFICULTY` 순서와 같아야 한다.
7. 닉네임 규칙은 `src/verse8/nickname.ts`와 `server.js` 두 곳에 복제 — 함께 수정.

## 3. 빌드 / 검증
```bash
npm install
npm test            # vitest (server.js 하네스 포함)
npm run typecheck
npm run build       # dist/ ; grep -c '"@agent8/gameserver' dist/assets/*.js → 0 이어야 함
```

## 4. 크리에이터 콘솔 체크리스트
- VXShop 상품: id **`premium-garage`**, 100 VX, 비소모(non-consumable), Lifetime Limit 1. 게임 내 표기 "차고 해금 · 100 VX" — 차고의 유료 항목(라이버리·언더글로우·트레일·배기 화염·휠·엔진음)과 프리미엄 카트 3종 영구 해금. 구 id `remove-ads`는 폐기(구매자 0명)이나 서버는 계속 인정.
- 광고 placement(전부 리워드, 전면 광고 없음): **`rewarded_premium_kart`**(프리미엄 카트 3회권), **`rewarded_double_coins`**(레이스 코인 2배, 하루 5회), **`rewarded_streak_recover`**(끊긴 출석 이어가기), **`rewarded_mission_swap`**(미션 교체, 하루 1회). 뒤의 셋은 진행 시스템에서 추가 — 콘솔에 등록해야 한다.
- 서버 함수 배포 확인: `ping`, `submitTime`, `getTopTimes`, `getMyEntitlements`, `grantPremiumRaces`, `consumePremiumRace`, `setNickname`, `$onItemPurchased`, 진행 시스템 `beginRace`(5번째 인자 = 레이스 종류), `finishRace`, `buyCosmetic`, `buyKart`, `doubleRaceCoins`, `claimAttendance`, `swapMission`. `getMyEntitlements`와 `finishRace`의 응답에 `ladder`가 있어야 한다(없으면 구버전 server.js가 배포된 것).

## 5. 배포
- `gitlab.verse8.io` 레포의 **`develop`** 브랜치로 push → 자동 빌드. V8가 만든 스캐폴드 위에 오버레이할 때 `.env`, `.agent8.lock`, `committedAt` 등 플랫폼 파일은 보존.
- push 후 V8 Agent 채팅에는 아래만 붙여넣는다(서술형 요청은 게임을 재생성해버림):
```
코드나 파일을 생성/수정하지 마. 아래 셸 명령만 순서대로 실행해줘:
git fetch origin
git reset --hard origin/develop
bun install
bun run build
```
- 화면 오른쪽 아래의 `build MM/DD HH:MM · …` 배지(첫 터치·키 입력 전까지)가 지금 떠 있는 빌드를 말해 준다. 글자는 빌드할 때 정해진다(`vite.config.ts`의 `buildTag`): 빌더에 git 체크아웃이 있으면 `<develop 커밋> · src <main 커밋>`, 없으면 `src <main 커밋>`. `src` 뒤의 커밋은 push 전에 `src/buildInfo.ts`에 찍은 것이고, 시각은 그 빌드가 만들어진 때(KST)다. 로비 왼쪽 아래의 `날짜-…-s<해시>`에서 `s<해시>`는 소스 내용의 해시라, 같은 소스를 로컬에서 빌드한 것과 같으면 같은 코드다.
- 호스트 안에서만 검증 가능: 실 광고(SSV), 실 결제(`$onItemPurchased`), 실 랭킹, 핸드셰이크. 톱프레임(로컬)은 전부 mock.

## 6. 온라인 멀티 (스펙 B + C: 아이템 동기화)
- 구조: **호스트(방장 브라우저) 권위 시뮬** + 클라 자기 카트 예측/보정. 서버(`server.js`)는 릴레이·방 목록·roomState만. `$roomTick` 미사용.
- `relayHot`(스냅샷·입력, 3틱=50ms, 클라 `throttle: 50`)과 `relay`(START/LOADED/RESULTS/LEAVE) 함수 이름을 **합치지 말 것**(호출 캡이 함수별).
- 방 목록 컬렉션 `tkr_rooms`: 방장이 5s 하트비트 `touchRoom`, 목록은 90s 스테일 필터. `updateCollectionItem(collectionId, item)` **2인자**(3인자는 조용히 no-op).
- 코드: `src/net/{protocol,roster,host-session,client-session,lobby,online,transport,loopback}.ts`, UI `src/ui/OnlinePanel.ts`. `KartState.isPlayer`는 각 클라에서 자기 카트만 true; Game은 `r.localKartId`를 쓴다.
- 로컬 검증: 타이틀 ONLINE → "Local loopback demo" (같은 페이지 봇 1명). 실 2인 E2E는 배포 후 Puppeteer 2개(`--disable-background-timer-throttling` 등, VERSE8-MULTIPLAYER.md §9).
- **아이템(스펙 C)**: 호스트만 `ItemManager` 시뮬. 클라는 `setNetMode('mirror')`로 박스 비트마스크·해저드(id별)·카트 아이템 슬롯/상태 플래그를 스냅샷에서 받아 그리기만 한다. 클라의 아이템 사용은 INPUT `useSeq` 증가 → 호스트 `requestUse`. 효과(픽업·룰렛·사용·히트·파괴·바운스·폭발·번개·박스 리스폰)는 호스트가 `MSG.FX`로 배치 방송 → 클라가 같은 이벤트를 로컬 버스에 재방출. 방 설정 ITEMS ON/OFF(기본 ON). 스냅샷 ≈ 300B(8카트+10해저드).
- **호스트 승격(스펙 D)**: 스냅샷 헤더 `hostEpoch`. 8초 무스냅샷 → kartId 최소 생존자가 승격(`promote()` → 새 HostSession, `adoptFromKarts`, 아이템 authority 전환, roomState hostAccount 갱신). 클라는 낮은 epoch 무시. 후보 무응답 시 8초 후 다음 후보.
- 다음 예정: 카트 위 닉네임, 관전.


## 7. 모바일 / 원스토어 요건 (2026-09-07)
- 폰 브레이크포인트 `@media (max-width: 700px), (max-height: 480px)` (`src/styles/11-phone.css`): 키보드 안내 숨김, 선택 패널은 **스크롤 컬럼 + sticky 푸터**, 레이서 카드 세로 2열(`MainMenu.charColumns()`가 실제 열 수를 읽어 ↑↓ 이동), 가로 폰은 카드 축약. 일시정지 중 `.hud` 페이드.
- 세로 화면 메뉴 카메라는 `MenuBackdrop.PORTRAIT_FRAMINGS` + 거리 `1/aspect` — 지우면 카트가 카드 뒤를 가득 채운다.
- 검증: `node tools/mobile-audit.mjs` → `marketing/.audit/` 40장(390×844·844×390, ko/en, 10화면). 원스토어 폼 답변·증빙은 `docs/ONESTORE-FORM.md`, `marketing/onestore/`.
8. **시작 시 서버 연결 필수**: `Game` 생성자에서 `initShop()` + `refreshEntitlements()`를 호출한다(26-09-07 리뷰 수정). 빠지면 호스트에서 레이스 완주 전까지 게임서버에 붙지 않아 기록 패널이 오프라인으로 보이고 VXShop이 열리지 않는다. 기록 패널은 `inVerse8Host()`로만 게이트하고 소켓 상태로 게이트하지 않는다.
9. `embed.ts`의 GAME_SIZE는 **innerWidth/innerHeight만** 보고한다 — scrollHeight를 섞으면 호스트가 iframe을 화면보다 키워 아이폰에서 하단이 잘린다. 클립보드는 iframe 권한 정책으로 막히므로 `execCommand('copy')` 폴백 유지.
10. **한글 폰트**: `index.html`이 Google Fonts(Black Han Sans = 디스플레이/버튼, Noto Sans KR = 본문)를 로드하고 `html[lang='ko']`에서 `--display/--body`를 바꾼다. 라틴 디스플레이 글리프는 Impact가 있으면 Impact, 없으면 Black Han Sans. 폰트 CDN이 막히면 시스템 폰트로 자연 폴백(레이아웃 깨지지 않음). 작은 라벨(pill·stat·kicker)은 Noto 700.
11. **팀전/리타이어**: `src/core/teams.ts`가 규칙의 단일 출처(짝수 kartId=레드, 홀수=블루, 점수표 10/8/6/5/4/3/2/1, 1등 우선제). 리타이어는 1등 완주 후 `BALANCE.race.retireSeconds`(10s) — `finishTime -1`, 점수 0, 기록 제출 안 함. 온라인 방은 아직 `mode`를 전송하지 않아 항상 개인전.
12. **모바일 = 가로 전용**: `Game.onOrientationCheck`가 터치 기기 세로에서 `.rotate-gate`를 띄우고 레이스를 일시정지. 타이틀은 로비(싱글/온라인/설정/기록 버튼, `.single-toggle` 등 클래스는 툴 스크립트가 참조). HUD: 좌상단 순위표(`.hud-standings`), 우상단 아이템(라벨 없음, 3개는 겹친 아이콘, 오버드라이브는 링 게이지), 그 아래 랩/타임. 아이템 id: `nitro`/`triple_nitro`/`overdrive`(구 버섯류 — 넷 코드 인덱스는 동일).
13. **구조**: 모듈 지도와 '무엇을 바꾸려면 어디' 표는 `docs/ARCHITECTURE.md`. CSS는 `src/styles/` 번호순 임포트(순서=캐스케이드). 새 기능은 `ui/hud/`·`kart/assists/` 식으로 위젯/모듈 단위 파일 추가.
14. **컬렉션 쿼리는 `{ limit }`만**: `getCollectionItems(id, { limit })` 외의 `filters`/`orderBy`/`countCollectionItems`는 이 플랫폼에서 무시되거나 throw(26-09-09 QA: 기록 미저장·"[object Object]1위"·기록 삭제 원인). server.js는 전부 읽어서 JS로 필터/정렬(`_allTimes`). 스냅샷 전송은 `SNAPSHOT_EVERY=7`(≈58ms, relayHot throttle 50 위) — 더 자주 보내면 릴레이가 패킷을 버려 1초 정지가 생긴다. 로비는 `visibilitychange`/`pageshow`에 `Lobby.resume()`(재조인)한다. 온라인 출시 스위치 `ONLINE_ENABLED`(constants).
15. **진행 시스템(코인)**: 설계는 `docs/superpowers/specs/2026-11-18-progression-server-design.md`. 코인은 **전부 `server.js`가 계산**한다 — 클라는 레이스 사실(순위·리타이어·레이스 시간)만 보내고 금액은 보내지 않는다. `beginRace`(레이스 시작 때 서버 시각 기록) → `finishRace`(서버 시계로 실제 시간이 지났는지 확인 후 지급, 하루 10판 전액 → 30% → 61판부터 0). 항목별 소유는 `own` 문자열(`p:f,k:rosa` — 외형 토큰은 `cos`와 같은 표기, 카트는 `k:<id>`), 판정은 `server.js _owns` / 클라 `sanitize(cos, premium, owned)` 한 쌍. `setCosmetics`는 안 가진 유료 토큰을 걸러서 저장한다. 가격표·순위표는 `server.js`와 `src/core/economy.ts` 두 곳(`serverEconomy.test.ts`가 일치 검사) — **한쪽만 고치지 말 것.** 호스트 밖(로컬)에서는 `src/verse8/localServer.ts`가 같은 `server.js`를 `localStorage`(`tkr.local.user`)로 실행한다: 규칙을 클라에 다시 구현하지 말 것. `?auto`·`?b.` 레이스는 정산하지 않는다. 로컬에서 지갑을 채우려면 `?coins=5000`(호스트 안에서는 이 코드가 로드되지 않는다). `beginRace`가 서버에 닿지 않으면 레이스 중 3·6·12·24초 간격으로 다시 시도하고, 늦게 닿았으면 서버가 본 시간만큼만 청구한다(30초 미만이면 미지급). 지급이 0일 때 결과 화면은 이유를 적는다(서버 무응답 / 시작 미기록 / 서버 거절). 서버 함수 배포 확인 목록에 `beginRace`, `finishRace`, `buyCosmetic`, `buyKart` 추가.
16. **진행 시스템(미션·출석·레벨)**: 전부 `server.js`. `finishRace`가 경험치(순위표, 난이도 무관, 하루 감쇠 적용)·레벨업 코인(레벨당 100)·미션 진행을 한 번에 계산한다. 미션 3개는 **서버가** 날짜 시드로 고르고(`missionsFor`, 전원 동일) 클라는 받은 목록을 그리기만 한다 — 고르는 로직을 클라에 만들지 말 것. 미션 카운터는 `src/game/RaceStatsTracker.ts`가 세어 보고하고 서버가 `STAT_CAP`으로 자른다. 출석은 `claimAttendance(recover)`(7일 주기, 딱 하루 빠졌을 때만 `recover`로 선택), 광고 뒤 호출은 `doubleRaceCoins`·`swapMission`·`claimAttendance(true)`이며 하루 횟수는 서버가 센다. 레벨 보상·출석 보상 외형은 `own`에 저장하지 않고 `xp`·`streak.total`에서 계산한다(`_ownSet`). 획득 전용 외형 14종은 카탈로그 뒤에 `earn: true`로 붙어 있고 100 VX로 열리지 않는다(`EARN_ONLY`). 미션 후보·보상·레벨 곡선·출석표는 `server.js`와 `core/economy.ts` 두 곳, 체급표 `CLASS_OF`는 `kart/roster.ts`와 두 곳 — `serverEconomy.test.ts`가 일치를 검사한다. 서버 함수 배포 확인 목록에 `doubleRaceCoins`, `claimAttendance`, `swapMission` 추가.
