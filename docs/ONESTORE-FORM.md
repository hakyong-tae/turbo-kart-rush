# Drift Dash GP — [Verse8] Application Form for ONE Store 답변 초안

원스토어 입점 신청 폼(Verse8 Application Form for ONE Store)의 질문 순서대로 정리한 답변과, 각 항목이 게임 안에서 실제로 어떻게 구현돼 있는지의 근거. 폼에 붙일 때는 **KO -- EN** 두 줄을 그대로 복사한다.
Answers for the ONE Store application form in question order, with the in-game evidence behind each. Paste both the KO and EN lines.

증빙 스크린샷: `marketing/onestore/` (폰 세로 390×844 · 가로 844×390, ko/en). 재생성: `npm run dev` 후 `node tools/mobile-audit.mjs` → `marketing/.audit/`.

---

## 1. 기본 정보 / Basics

| 항목 | 답변 |
|---|---|
| 이메일 / Discord | 신청자 본인 계정 기입 (Verse8 계정과 동일 이메일 권장) |
| 게임 제목 / Title | **Drift Dash GP** |
| Verse8 게임 링크 | Verse8 프로젝트 게시 후 URL 기입. 공개 여부: **Public** (라이선스 MIT, 에셋 0개 자체 생성 → 공개 가능) |
| GitLab 경로 | `hy.tae90/my-basic-game-project` (브랜치 `develop`). **토큰(glpat-…)은 절대 기입하지 않는다.** |
| 화면 방향 / Orientation | **가로 (Landscape) 전용** — 터치 기기를 세로로 들면 전체 화면 회전 안내(`.rotate-gate`)가 덮고 레이스는 자동 일시정지. 가로로 돌리면 바로 이어서 플레이. 가로 폰 레이아웃은 `max-height: 480px` 브레이크포인트로 최적화 |

## 2. 모바일 검증 / Mobile verification

**검증 기기 (Verified devices)**
- Chrome 헤드리스 모바일 에뮬레이션 390×844 @2x (iPhone 14/15 급) 세로·가로, 터치 입력 ON — `tools/mobile-audit.mjs`로 10개 화면 × 2언어 × 2방향 = 40장 자동 캡처
- 실기기 항목은 신청 전 최소 1대(Android 1 + iOS 1 권장) 직접 플레이 후 모델명 기입. 예: `Galaxy S24 (Android 14, Chrome)`, `iPhone 15 (iOS 17, Safari)`

**겹침·선명도·잘림 체크 (Overlap / sharpness / cut-off)** — 2026-09-07 감사에서 발견·수정한 항목:
1. 타이틀(세로): 키보드 조작 안내 패널이 "화면을 탭해서 시작"과 버전 표기를 덮음 → 폰 브레이크포인트에서 안내 숨김, 버전 표기 하단 중앙 축소
2. 레이서 선택(세로): 4열 카드가 좁아 이름 잘림·태그라인 글자 단위 줄바꿈, 2행과 CONTINUE 푸터가 화면 밖 → 2열 + 스크롤 컬럼 + 하단 고정(sticky) 푸터
3. 레이서/서킷 선택(가로 폰): 2행과 푸터가 390px 높이 밖 → 카드 축약(스와치+이름+체급) + 스크롤 + 고정 푸터
4. 서킷 선택(세로): "2/2 단계" 헤더가 첫 카드 뒤에 숨음 → 헤더를 흐름 배치로 전환
5. 메뉴 3D 카트(세로): 세로 화면에서 카트가 화면 폭을 가득 채워 카드 가독성 저하 → 세로 전용 카메라 거리(1/aspect)·하단 중앙 배치
6. 일시정지: 미니맵/속도계가 일시정지 패널 위에 겹침 → 일시정지 중 HUD 12% 페이드, 터치 기기에서 키보드 힌트 숨김
- 레이스 HUD(세로/가로), 결과, 기록, 설정, 온라인, 프리미엄 카트 시트: 겹침·잘림 없음 (스크린샷 참조)
- 선명도: DOM UI + 벡터 폰트, 캔버스는 `devicePixelRatio` 기준 렌더 → 고해상도 폰에서 흐려지지 않음

**30분 터치 전용 세션 (30-minute touch-only session)**
- 조작: 왼쪽 플로팅 아날로그 스틱(12시 가속·6시 브레이크·좌우 조향), 오른쪽 DRIFT / ITEM 버튼, 좌상단 ⏸. 키보드 없이 타이틀→레이서→서킷→레이스→결과→재도전 전 흐름 터치만으로 진행 가능
- 실기기 30분 플레이는 신청자가 직접 수행 후 체크. 확인 포인트: 발열/프레임 저하, 화면 회전 시 레이아웃, 광고 시청 후 복귀, 백그라운드 전환 후 오디오 재개

## 3. 언어 / Language

**언어 전환 위치 (Where the language switch is)**
- 타이틀 화면 우상단 **⚙(설정)** → **언어: KO / EN** 세그먼트 → 저장. 전환 즉시 모든 오버레이가 재구축된다.
- 첫 실행 시 자동 감지: `localStorage 'tkr.lang'` → `navigator.language`가 `ko*`면 한국어, 그 외 영어.
- 스크린샷: `marketing/onestore/language-switch-ko.png`, `language-switch-en.png`

KO: 타이틀 화면 우상단 ⚙ 설정 패널 → "언어" KO/EN 토글. 기기 언어(ko)는 자동 감지되며 설정값은 기기에 저장됩니다.
EN: Title screen → gear icon (top right) → Settings → "Language" KO/EN toggle. Device language (ko) is auto-detected; the choice is remembered on the device.

**모든 화면 양 언어 지원 (Both languages on every screen)**
- `src/core/locales/en.ts`(키 원본) / `ko.ts` 약 200키. 타이틀·설정·기록·온라인 로비·레이서/서킷 선택·잠금 시트·로딩 팁·카운트다운·HUD·일시정지·결과·토스트 전부 포함. 캐릭터/트랙 고유명(ZIPPY NOVA, CORAL COAST 등)은 브랜드명으로 양 언어 공통.

**게임 설명 (KO → EN, 합계 1,000자 이하)** — `docs/STORE.md`의 본문을 그대로 사용 (KO 258자 + EN 518자).

## 4. 계정 저장 / Account-saved progress

KO: 닉네임, 프리미엄 카트 이용권(광고 보상 잔여 횟수), 전 차량 해금 구매 여부, 트랙별 최고 기록이 모두 Verse8 서버(유저 스테이트 + `tkr_times` 컬렉션)에 계정 단위로 저장됩니다. 다른 기기에서 같은 계정으로 접속하면 기록 화면(🏆 기록 → 트랙 탭)과 레이스 결과 화면의 "내 기록 · N위" 배너에 동일한 최고 기록이 표시됩니다.
EN: Nickname, remaining premium-kart passes (rewarded-ad grants), the all-karts unlock purchase and per-track best times are stored per account on the Verse8 server (user state + the `tkr_times` collection). Signing in on another device shows the same personal best in the Records panel (🏆 → track tab) and in the "your best · rank" banner on the results screen.

근거: `server.js` `submitTime/getTopTimes`(계정당 트랙별 1건, 더 빠를 때만 갱신), `getMyEntitlements()` → `{adsRemoved, premiumRaces, nickname}`; 클라 `src/verse8/entitlements.ts`는 캐시일 뿐 서버가 진실.

## 5. 수익화 / Monetization

**구성 (What is monetized)**
- 전면 광고(interstitial): **없음** — 의도적 결정. ※ 폼이 "인게임 광고 필수"를 요구한다면 리워드 광고가 이를 충족하는지 원스토어/Verse8 담당자에게 확인 필요. 필요 시 결과 화면 진입 시 전면 광고 1회(`@verse8/ads showInterstitial`)를 추가하는 옵션은 열려 있음.
- 리워드 광고(opt-in): placement **`rewarded_premium_kart`**. 잠긴 프리미엄 카트(Fennec Flash · Boulder Bram · Big Rig Rosa) 카드 → 잠금 시트 → "광고 보고 3회 이용".
- VX 결제: 상품 **`remove-ads`**, **100 VX**, 비소모(non-consumable), Lifetime Limit 1 → 프리미엄 카트 3종 영구 해금(게임 내 표기 "전 차량 해금 · 100 VX").

KO: 강제 전면 광고 없음. 프리미엄 카트 3종은 (1) 선택형 리워드 광고 시청 시 3레이스 이용권, 또는 (2) 100 VX 1회 구매로 영구 해금. 그 외 모든 콘텐츠(레이서 5종·서킷 6개·온라인·리더보드)는 무료.
EN: No forced interstitials. Three premium karts are unlocked either by (1) an opt-in rewarded ad granting 3 races, or (2) a one-time 100 VX purchase for permanent access. Everything else (5 karts, 6 circuits, online, leaderboards) is free.

**리워드 광고 보상 규칙 (Rewarded-ad reward rules)**
KO: 광고 1회 완주 시 프리미엄 카트 이용권 +3레이스(미사용 잔여 최대 9회, 하루 최대 10회 시청). 보상은 서버 검증(SSV) 후 서버에서만 지급되며, 프리미엄 카트로 레이스를 시작할 때 1회씩 차감됩니다. 광고 중단·실패 시 지급 없음.
EN: Each completed rewarded ad grants +3 premium-kart races (up to 9 unused, max 10 ads per day). The grant is issued server-side only after server verification and one pass is consumed each time a race is started with a premium kart. Skipped or failed ads grant nothing.

**광고 타임아웃 120초 (120 s ad timeout)** — 적용됨: `src/verse8/ads.ts` `showRewarded({ placementId, timeoutMs: 120_000 })`.

**VX 결제 동작·계정 저장 (VX checkout works and is saved to the account)**
KO: 잠금 시트의 "전 차량 해금 · 100 VX" → VXShop 결제창 → 결제 완료 시 서버 `$onItemPurchased('remove-ads')`가 유저 스테이트 `adsRemoved=true`를 기록하고 클라이언트가 즉시 권한을 갱신해 잠금 배지가 사라집니다. 재접속·다른 기기에서도 서버 값으로 복원됩니다.
EN: "Unlock all karts · 100 VX" in the lock sheet opens VXShop checkout; on success the server hook `$onItemPurchased('remove-ads')` writes `adsRemoved=true` to the user state and the client refreshes entitlements immediately. The unlock is restored from the server on any device.

## 6. 확률형 아이템 / Probability items

KO: **없음.** 레이스 중 아이템 박스에서 나오는 아이템(바나나·등껍질·번개·자석 등 14종)은 순위에 따라 결정되는 플레이 요소로, 유료 재화·광고와 무관하며 소지·거래·구매가 불가능합니다. 유료 상품은 확률 요소가 없는 단일 해금 상품(remove-ads) 1종만 존재합니다.
EN: **None.** Items from race item boxes (14 kinds, e.g. banana, shells, lightning) are gameplay elements weighted by race position; they cannot be bought, owned or traded and are unrelated to VX or ads. The only paid product is a single non-random unlock (remove-ads).

## 7. 자진신고 / Self-declaration

- 저작권: 원작 [bridge-mind/turbo-kart-rush](https://github.com/bridge-mind/turbo-kart-rush) MIT, 에셋 파일 0개(지오메트리·텍스처·오디오 전부 코드 생성). 원작 고지는 README 유지.
- 서버 저장 데이터: 계정 식별자, 닉네임(1~12자), 기록 시간, 이용권 카운트만. 이메일·개인정보 수집 없음.
- 온라인 멀티: 호스트(방장 브라우저) 권위 시뮬 + Verse8 릴레이. 채팅 기능 없음(욕설/신고 이슈 없음).

## 8. 마무리 메모 / Wrap-up notes (폼 마지막 자유 기술)

KO: 100% 프로시저럴 3D 카트 레이서로 다운로드 에셋이 없어 로딩이 빠르고(번들 ~1.1 MB gzip 314 KB), 6서킷·8레이서·14아이템·최대 8인 온라인 대전·트랙별 리더보드를 제공합니다. 모바일은 세로·가로 모두 지원하며 플로팅 스틱 + 2버튼 터치 조작으로 키보드 없이 전 기능 이용 가능합니다. 수익화는 선택형 리워드 광고 1종과 100 VX 해금 상품 1종으로 최소화했고 확률형 요소는 없습니다.
EN: A fully procedural 3D kart racer with zero downloaded assets (bundle ~1.1 MB, 314 KB gzip): 6 circuits, 8 racers, 14 items, online races for up to 8 and per-track leaderboards. Both orientations are supported with a floating stick + two-button touch scheme, so the whole game is playable without a keyboard. Monetization is limited to one opt-in rewarded placement and one 100 VX unlock; there are no probability-based items.

---

## 제출 전 체크리스트 / Pre-submission checklist

- [ ] Verse8 게시 URL 확정 후 §1 기입, 공개 상태 Public 확인
- [ ] 크리에이터 콘솔에 `remove-ads`(100 VX, non-consumable, limit 1)와 `rewarded_premium_kart` 등록·활성
- [ ] 호스트 안에서 실 광고 1회 → 이용권 +3 표시, 실 결제 1회 → 잠금 배지 해제 확인 (다른 기기 재로그인 포함)
- [ ] 실기기(Android 1 + iOS 1) 30분 터치 플레이 후 기기명 §2 기입
- [ ] 전면 광고 요건이 필수인지 담당자 확인 (필수면 결과 화면 진입 시 1회 추가)
- [ ] 첨부: `marketing/thumbnail-1x1.png`, `marketing/drift-dash-gp-15s-1x1-web.mp4`(8 MB, 10 MB 제한), `marketing/onestore/language-switch-ko.png`
