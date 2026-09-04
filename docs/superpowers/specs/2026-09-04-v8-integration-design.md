# Turbo Kart Rush — Verse8 연동 스펙 A (플랫폼 기반 · 리더보드 · 프리미엄 카트 광고/VXShop)

날짜: 2026-09-04 · 브랜치: `v8-integration` · 선행: `docs/superpowers/specs/2026-09-04-local-mods-design.md`(main 머지 완료)
후속: 스펙 B = 온라인 멀티(호스트 권위 스냅샷 + 예측, 2~4인 + AI 채움) — 이 스펙 배포 후 별도 진행.

## 목표

Verse8(verse8.io)에 배포 가능한 상태로 만든다. 게임플레이 변경은 없다.

1. **플랫폼 기반** — iframe 핸드셰이크, 루트 `server.js`, SDK 3종, V8 AI 컨텍스트 문서, develop 오버레이 배포 절차
2. **리더보드** — 트랙별 완주시간, 계정당 트랙별 1건, 서버 저장 닉네임
3. **프리미엄 카트** — Fennec Flash·Boulder Bram·Big Rig Rosa 잠금. 리워드 광고 1회 = 프리미엄 레이스 3회권, VXShop `remove-ads` 100 VX = 전 차량 무제한. **광고권·구매 상태 전부 V8 서버(유저스테이트) 저장**, 클라는 캐시만.
4. **설정 화면** — 닉네임(리더보드용, 미리 설정), 언어 KO/EN, 음소거

원칙: `CONTRACT.md` 격리 유지. Verse8 전용 코드는 전부 `src/verse8/`(신규 워크스트림 F)와 루트 `server.js`에 두고, 기존 모듈은 이벤트·인터페이스로만 연결한다. V8 호스트 밖(로컬 톱프레임)에서도 모든 경로가 mock으로 동작해야 한다.

검증된 참조 구현(그대로 이식): `block-blaster-v8/src/verse8/{server,ads,shop,embed}.ts`, `block-blaster-v8/server.js`, `server-survival-v8/src/verse8/gameserver.js` 주석(함정 목록).

---

## 1. 플랫폼 기반

### 1.1 파일
| 파일 | 역할 |
|---|---|
| `src/verse8/embed.ts` | `inVerse8Host()`(= `window.parent !== window`), `initEmbedHandshake()`: 로드·리사이즈 시 `GAME_SIZE`와 `GAME_SIZE_RESPONSE` **둘 다** postMessage, `REQUEST_GAME_SIZE` 수신 시 재전송(호스트 버전차 대비) |
| `src/verse8/server.ts` | agent8 접속 래퍼(Blast Block TS 그대로: 스토어 경유 `connect`, single-flight, per-caller 6s 예산, epoch 가드, `callServer(fn,args,fallback)`) + 게임 전용 호출(§2·§3) |
| `src/verse8/ads.ts` | `@verse8/ads` **정적 import**, `requestRewardedAd(placementId)` → `status==='rewarded'`만 true, 톱프레임은 mock 오버레이(Reward/Dismiss 선택). 전면 광고 함수는 두되 **호출처 없음** |
| `src/verse8/shop.ts` | `@verse8/platform/vanilla` VXShop: `initShop()`, `buyRemoveAds()`, `onClose(purchased)→refreshEntitlements()`. 톱프레임은 mock 구매 |
| `src/verse8/entitlements.ts` | 서버 권위 상태 캐시 `{ adsRemoved, premiumRaces, nickname }` + 구독. §3 |
| `server.js` (루트) | export 없는 `class Server`. 빌드 없음. §2·§3 함수 |
| `docs/VERSE8-CONTEXT.md` | V8 AI용 "깨뜨리면 안 되는 것": 에셋 0/프로시저럴, `base './'`, `@verse8/ads` 정적 import 유지, 핸드셰이크, `server.js` 계약, `balance.ts`, `src/core` 프로즌, 터치/i18n 구조. 배포 후 V8 워크스페이스에도 복사 |

### 1.2 부트 순서 (`main.ts`)
`initEmbedHandshake()` → balance 오버라이드 → `new Game()` → `initShop()`(비동기, 실패 무시) → `refreshEntitlements()`. 접속 실패/호스트 밖이면 전부 오프라인 폴백(리더보드 "오프라인" 표시, 프리미엄은 mock).

### 1.3 의존성·빌드
- `package.json` deps 추가: `@agent8/gameserver ^1.10.2`, `@verse8/ads ^0.5.0`, `@verse8/platform ^2.1.0`.
- `vite.config.ts`는 `base './'` 유지. 빌드 후 검증: `grep -c '"@agent8/gameserver' dist/assets/*.js` = 0 (딥임포트 리터럴 유지 확인).
- `src/verse8/server.ts`의 딥임포트 `@agent8/gameserver/dist/src/store/useGameServerStore`는 **리터럴 문자열**로만.

### 1.4 배포 (사용자가 gitlab repo URL + 토큰을 주는 시점에)
1. V8가 만든 스캐폴드 레포를 `develop`으로 clone → 우리 레포 파일을 오버레이(`.env`, `.agent8.lock`, `committedAt` 등 V8 파일 보존, `node_modules/dist` 제외).
2. `npm run build` 로컬 통과 확인 → `git push origin develop`.
3. 답변에 **V8 Agent 프롬프트를 반드시 첨부**(메모리 규칙): "코드나 파일을 생성/수정하지 마. 아래 셸 명령만: git fetch origin / git reset --hard origin/develop / bun install / bun run build".
4. 크리에이터 콘솔 수동 작업 체크리스트: VXShop 상품 `remove-ads`(100 VX, 비소모, Lifetime Limit 1) 등록, 광고 placement `rewarded_premium_kart` 확인, 서버함수 배포 확인.

---

## 2. 리더보드

### 2.1 서버 (`server.js`)
- 컬렉션 `tkr_times`. 레코드 `{ account, name, trackId, timeMs, characterId, difficulty, createdAt }`.
- `submitTime(trackId, timeMs, characterId, difficulty)`
  - `trackId` 화이트리스트 6개, `timeMs` 정수 30 000 ≤ t ≤ 1 200 000, `characterId` 8개 화이트리스트, `difficulty` 3개.
  - `name`은 클라가 보내지 않고 **서버가 유저스테이트 `nickname`에서 읽음**(없으면 `RACER-<account 끝 4자리 대문자>`).
  - 계정·트랙당 1건: 기존보다 빠를 때만 교체(기존 전부 삭제 후 add). 반환 `{ updated, entry, rank }`.
- `getTopTimes(trackId, limit=20)` → `{ rows:[{name, timeMs, characterId, difficulty, account}], myRank, myBest }` (timeMs ASC, `countCollectionItems` timeMs `<` 내 기록 +1).
- 닉네임은 §4의 `setNickname`으로 저장되며 기존 기록의 `name`도 함께 갱신(내 기록 조회 → name 필드 업데이트).

### 2.2 클라이언트
- `Game`: `race:finish`(isPlayer) 수신 시 `submitTime(...)` fire-and-forget. **제외 조건**: `?auto=1`, `playerAutoDriver`가 완주 전에 켜진 경우, `location.search`에 `b.` 밸런스 오버라이드가 있는 경우(치트 방지).
- 로컬 베스트 병행: `localStorage tkr.best.<trackId>` (오프라인/호스트 밖 표시용).
- `src/ui/LeaderboardPanel.ts`: 트랙 탭 6개, 상위 10행(순위·닉네임·시간·카트·난이도), 내 순위/베스트 행 고정 표시, 로딩/오프라인/빈 상태. 결과 화면에 "🏆 랭킹" 버튼과 자동 펼침(제출 응답의 `rank` 표시 "N위!"), 타이틀에도 🏆 버튼.
- 닉네임 미설정 상태에서 제출되면 서버 기본 이름이 붙는다. 결과 화면 랭킹 패널에 "닉네임 설정 →" 링크(설정 화면 이동).

---

## 3. 프리미엄 카트 (리워드 광고 3회권 / VXShop 100 VX)

### 3.1 데이터
- `CharacterDef.premium?: true` — `src/core/types.ts` **추가**(CONTRACT additions). `roster.ts`에서 `fennec`, `bram`, `rosa`에 표시.
- 서버 유저스테이트: `{ adsRemoved: boolean, premiumRaces: number, nickname: string }`.

### 3.2 서버 (`server.js`)
- `getMyEntitlements()` → `{ adsRemoved, premiumRaces, nickname }` (기본 false / 0 / '').
- `grantPremiumRaces()` → `premiumRaces = min(premiumRaces + 3, 9)`; 반환 새 값. 클라는 `@verse8/ads`가 `status:'rewarded'`(호스트 SSV 검증 완료)를 돌려준 뒤에만 호출. **어뷰즈 상한**: 계정당 `premiumGrantsToday`를 UTC 일자 키로 세어 하루 10회 초과 시 무시(`{ granted:false }`).
- `consumePremiumRace(characterId)` → 캐릭터가 프리미엄이 아니면 `{ok:true}`(차감 없음); `adsRemoved`면 `{ok:true}`; `premiumRaces>0`이면 −1 후 `{ok:true, premiumRaces}`; 아니면 `{ok:false}`.
- `$onItemPurchased({account, productId})` → `productId==='remove-ads'`면 `adsRemoved=true`.

### 3.3 클라이언트 (`src/verse8/entitlements.ts`)
- 상태 `{ adsRemoved, premiumRaces, nickname, loaded }` + `onChange` 구독. `refreshEntitlements()`가 서버에서 다시 읽음(부트, 광고/구매 후, 설정 저장 후).
- `canRace(characterId)`: 비프리미엄 → true; `adsRemoved` → true; `premiumRaces > 0` → true; 그 외 false.
- 레이스 시작(`Game.startRace`) 직전 프리미엄 카트면 `consumePremiumRace()` **await**(예산 6s). `ok:false`면 시작하지 않고 잠금 시트로 되돌림. 서버 미접속(호스트 밖)이면 로컬 mock 스토어(메모리, 새로고침 시 리셋)로 동일 규칙 적용 — 프로덕션에서는 도달 불가.
- 캐릭터 선택 UI(`MainMenu`): 프리미엄 카드에 🔒 배지 + 잔여권 `📺 ×n` 표시(해금 시 배지 제거). 잠긴 카트로 CONTINUE/클릭 시 하단 **잠금 시트**: `[📺 광고 보고 3회 이용]` `[🛒 100 VX 전 차량 해금]` `[다른 카트 고르기]`. 광고 성공 → `grantPremiumRaces` → 배지 갱신 → 자동 진행. 구매 성공 → `refreshEntitlements` → 진행.
- placement id `rewarded_premium_kart`.

### 3.4 mock (톱프레임)
- 광고: Reward/Dismiss 오버레이. 구매: Buy/Close 오버레이. 서버: `entitlements.ts` 내부 메모리 스토어가 `grant/consume/purchase`를 동일 규칙으로 처리(테스트 대상).

---

## 4. 설정 화면

- `src/ui/SettingsPanel.ts` — 타이틀 우상단 ⚙ 버튼(기존 KO|EN 토글 자리). 항목: **닉네임**(1~12자, 영숫자·한글·공백, 서버 `setNickname` → 성공 시 캐시 갱신, 오프라인이면 로컬 임시 저장 후 접속 시 동기화 시도), **언어** KO/EN 세그먼트(기존 토글 로직 이동), **음소거** 토글(기존 M키와 동일 함수). 저장/닫기.
- 서버 `setNickname(name)`: 정규화(trim, 12자, 허용문자만, 금지어 최소 목록) → 유저스테이트 저장 + 내 `tkr_times` 기록 name 갱신 → 반환 정규화된 이름.
- 첫 실행 시 닉네임이 비어 있으면 타이틀에 "닉네임을 설정하면 랭킹에 이름이 표시됩니다" 1회 토스트.

---

## 5. i18n 추가 키(ko/en) — 약 35개
설정(제목·닉네임·플레이스홀더·저장·언어·음소거·안내), 리더보드(제목·트랙·순위·시간·카트·난이도·내 순위·오프라인·비어있음·닉네임 설정 링크·"N위!"), 프리미엄(잠김·광고 보기·잔여 n회·100 VX 해금·다른 카트·광고 실패·구매 불가), mock 문구.

---

## 6. 테스트

- vitest
  - `entitlements.ts` 규칙(`canRace`, mock 스토어 grant 상한 9 / consume 차감 / adsRemoved 우선 / 비프리미엄 무차감).
  - `server.js`를 node에서 로드하는 하네스(`$global`·`$sender` 페이크 주입): `submitTime` 화이트리스트·범위·교체 규칙·기본 닉네임, `setNickname` 정규화, `grantPremiumRaces` 일일 상한, `consumePremiumRace` 분기, `$onItemPurchased`.
  - 닉네임 정규화 함수는 클라/서버 공용 로직을 `src/verse8/nickname.ts`에 두고 서버는 동일 규칙을 복제(파일 동기화 주석).
- 브라우저(로컬 mock): 잠금 카트 선택 → 광고 mock Reward → 배지 ×3 → 레이스 시작 시 ×2 → 구매 mock → 배지 사라짐. 리더보드 패널 오프라인 표시. 설정 닉네임 저장·언어 전환·음소거.
- 실 광고·실 결제·실 랭킹·핸드셰이크는 **V8 배포 후** 호스트에서 확인(체크리스트 §1.4).

## 7. 문서·마무리
- `CONTRACT.md` Contract additions: `CharacterDef.premium`, 워크스트림 F(`src/verse8/**`, `server.js`).
- `NOTES.md` §6 표 3번(저장/리더보드) 완료 표시, §2 트리에 `verse8/` 추가, §1에 V8 배포 절차 링크.
- 메모리 `project_turbo_kart_rush` 갱신.
