# Turbo Kart Rush — Verse8 컨텍스트 (V8 AI / CLI 에이전트용)

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
