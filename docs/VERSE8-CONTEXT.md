# Drift Dash GP (구 Turbo Kart Rush) — Verse8 컨텍스트 (V8 AI / CLI 에이전트용)

이 문서는 Verse8 워크스페이스의 AI와 로컬 CLI 에이전트가 **먼저 읽어야 하는** 규칙이다. 구조 분석은 `NOTES.md`, 모듈 계약은 `CONTRACT.md`.

## 1. 이 게임은
- Three.js 0.185 + TypeScript + Vite 아케이드 카트레이서. **에셋 파일 0개** — 지오메트리·텍스처·오디오 전부 코드 생성. MIT.
- 트랙 6개, 캐릭터 8명(프리미엄 3: fennec·bram·rosa), 터치 조작, ko/en.

## 2. 깨뜨리면 안 되는 것
1. `vite.config.ts`의 `base: './'` — 서브경로 호스팅 필수.
2. `@verse8/ads`는 **정적 import** 유지, `package.json` deps에서 빼지 말 것(동적 import는 번들에서 트리셰이킹된 사례 있음).
3. `src/verse8/server.ts`의 `@agent8/gameserver/dist/src/store/useGameServerStore` 딥임포트는 **리터럴 문자열**로만. `GameServer.connect()` 직접 호출 금지(스토어 경유) — 어기면 창 전환마다 재접속 폭풍.
4. `src/verse8/embed.ts`의 GAME_SIZE 핸드셰이크 제거 금지(iframe 뷰포트 0 방지).
5. 루트 `server.js` = 서버 함수 배포물(빌드 없음). 컬렉션 `tkr_times`, 유저스테이트 키 `adsRemoved` / `premiumRaces` / `nickname` / `grants`. **광고권·구매 상태는 서버만 진실** — 클라 `src/verse8/entitlements.ts`는 캐시.
6. `src/core/**`는 프로즌 계약(추가만, 값 변경 금지). 튠 값은 `src/core/balance.ts`.
7. 닉네임 규칙은 `src/verse8/nickname.ts`와 `server.js` 두 곳에 복제 — 함께 수정.

## 3. 빌드 / 검증
```bash
npm install
npm test            # vitest (server.js 하네스 포함)
npm run typecheck
npm run build       # dist/ ; grep -c '"@agent8/gameserver' dist/assets/*.js → 0 이어야 함
```

## 4. 크리에이터 콘솔 체크리스트
- VXShop 상품: id **`remove-ads`**, 100 VX, 비소모(non-consumable), Lifetime Limit 1. 게임 내 표기 "전 차량 해금".
- 광고 placement: **`rewarded_premium_kart`** (리워드). 전면 광고 없음.
- 서버 함수 배포 확인: `ping`, `submitTime`, `getTopTimes`, `getMyEntitlements`, `grantPremiumRaces`, `consumePremiumRace`, `setNickname`, `$onItemPurchased`.

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
- 폰 브레이크포인트 `@media (max-width: 700px), (max-height: 480px)` (style.css 말미): 키보드 안내 숨김, 선택 패널은 **스크롤 컬럼 + sticky 푸터**, 레이서 카드 세로 2열(`MainMenu.charColumns()`가 실제 열 수를 읽어 ↑↓ 이동), 가로 폰은 카드 축약. 일시정지 중 `.hud` 페이드.
- 세로 화면 메뉴 카메라는 `MenuBackdrop.PORTRAIT_FRAMINGS` + 거리 `1/aspect` — 지우면 카트가 카드 뒤를 가득 채운다.
- 검증: `node tools/mobile-audit.mjs` → `marketing/.audit/` 40장(390×844·844×390, ko/en, 10화면). 원스토어 폼 답변·증빙은 `docs/ONESTORE-FORM.md`, `marketing/onestore/`.
8. **시작 시 서버 연결 필수**: `Game` 생성자에서 `initShop()` + `refreshEntitlements()`를 호출한다(26-09-07 리뷰 수정). 빠지면 호스트에서 레이스 완주 전까지 게임서버에 붙지 않아 기록 패널이 오프라인으로 보이고 VXShop이 열리지 않는다. 기록 패널은 `inVerse8Host()`로만 게이트하고 소켓 상태로 게이트하지 않는다.
9. `embed.ts`의 GAME_SIZE는 **innerWidth/innerHeight만** 보고한다 — scrollHeight를 섞으면 호스트가 iframe을 화면보다 키워 아이폰에서 하단이 잘린다. 클립보드는 iframe 권한 정책으로 막히므로 `execCommand('copy')` 폴백 유지.
10. **한글 폰트**: `index.html`이 Google Fonts(Black Han Sans = 디스플레이/버튼, Noto Sans KR = 본문)를 로드하고 `html[lang='ko']`에서 `--display/--body`를 바꾼다. 라틴 디스플레이 글리프는 Impact가 있으면 Impact, 없으면 Black Han Sans. 폰트 CDN이 막히면 시스템 폰트로 자연 폴백(레이아웃 깨지지 않음). 작은 라벨(pill·stat·kicker)은 Noto 700.
11. **팀전/리타이어**: `src/core/teams.ts`가 규칙의 단일 출처(짝수 kartId=레드, 홀수=블루, 점수표 10/8/6/5/4/3/2/1, 1등 우선제). 리타이어는 1등 완주 후 `BALANCE.race.retireSeconds`(10s) — `finishTime -1`, 점수 0, 기록 제출 안 함. 온라인 방은 아직 `mode`를 전송하지 않아 항상 개인전.
12. **모바일 = 가로 전용**: `Game.onOrientationCheck`가 터치 기기 세로에서 `.rotate-gate`를 띄우고 레이스를 일시정지. 타이틀은 로비(싱글/온라인/설정/기록 버튼, `.single-toggle` 등 클래스는 툴 스크립트가 참조). HUD: 좌상단 순위표(`.hud-standings`), 우상단 아이템(라벨 없음, 3개는 겹친 아이콘, 오버드라이브는 링 게이지), 그 아래 랩/타임. 아이템 id: `nitro`/`triple_nitro`/`overdrive`(구 버섯류 — 넷 코드 인덱스는 동일).
