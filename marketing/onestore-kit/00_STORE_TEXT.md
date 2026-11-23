# Drift Kart — 원스토어 등록 문안 / ONE store listing copy

근거: 코드(`src/track/tracks`, `src/core/types.ts` 아이템, `src/core/cosmetics.ts`, `src/core/cups.ts`, `src/core/daily.ts`, `server.js`, `src/verse8/`)와 `docs/STORE.md`, `docs/ONESTORE-FORM.md`. 2026-10-21 기준.
Sources: the code paths above plus `docs/STORE.md` and `docs/ONESTORE-FORM.md`, as of 2026-10-21.

> ⚠️ 온라인 대전은 현재 빌드에서 꺼져 있음(`src/core/constants.ts` `ONLINE_ENABLED = false`) → 문안에서 제외. 다시 켜면 "최대 8인 온라인 대전(빠른 매칭·방 코드)" 문구 추가
> ⚠️ Online multiplayer is switched off in the current build (`ONLINE_ENABLED = false`), so it is left out of this copy. Add it back if the flag is turned on

## 제목 / Title

드리프트 카트 / Drift Kart

## 장르 · 태그 / Genre · Tags

- 장르 / Genre: 레이싱 · 아케이드 / Racing · Arcade
- 태그 / Tags: 카트레이싱 / kart racing · 레이싱 / racing · 아케이드 / arcade · 드리프트 / drift · 캐주얼 / casual · 3D · 리더보드 / leaderboard · 그랑프리 / grand prix · 데일리 챌린지 / daily challenge · 커스터마이징 / customization

## 짧은 설명 (80자 이내) / Short description (≤ 80 chars)

- KO (52자): 드리프트로 순위를 뒤집는 아케이드 카트 레이스 · 레이서 8명 · 서킷 8개 · 아이템 14종
- EN (78 chars): Drift, boost and blast past rivals: 8 racers, 8 circuits, 14 items, daily runs

## 긴 설명 / Long description (KO 블록 → EN 블록, 합계 1,000자 이하)

드리프트로 미니터보를 모아 코너마다 순위를 뒤집는 3D 아케이드 카트 레이서예요. 개성이 다른 레이서 8명과 초원·해변·사막·설원·네온·화산 테마의 서킷 8개, 바나나부터 파란 등껍질·번개까지 아이템 14종이 마지막 코너까지 승부를 흔들어요. 그랑프리 컵 3종에서 합산 점수로 우승을 노리고, 매일 바뀌는 '오늘의 도전'에서 하루 한 번의 기록으로 순위를 겨뤄요. 차고에서 카트 도색은 언제든 무료로 바꿀 수 있어요. 트랙별 최고 기록과 꾸민 카트는 계정에 저장돼요. 키보드·게임패드·터치를 모두 지원해요.

An arcade 3D kart racer where drifting charges mini-turbos and every corner is a chance to pass. 8 racers, 8 circuits across grassland, beach, desert, snow, neon and volcano themes, and 14 items from bananas to blue shells and lightning keep every race open to the last turn. Chase three Grand Prix cups on combined points, or take one shot a day at the Daily Challenge board. Paint your kart for free in the garage. Best times and your kart's look are saved to your account. Keyboard, gamepad and touch supported.

(글자 수 / Character count: KO 283 + EN 514 = 797, 공백 포함 / incl. spaces)

## 주요 특징 / Key features

- 3단계 드리프트 미니터보 · 로켓 스타트 · 부스트 패드 / 3-stage drift mini-turbos · rocket starts · boost pads
- 레이서 8명(기본 5 + 프리미엄 3) · 서킷 8개 · 아이템 14종 / 8 racers (5 standard + 3 premium) · 8 circuits · 14 items
- 개인전 · 팀 점수제 · 팀 1등 우선, 난이도 3단계 / Solo, team points and team first-place modes, 3 difficulty levels
- 그랑프리 컵 3종(루키 · 프로 · 챔피언십) / 3 Grand Prix cups (Rookie · Pro · Championship)
- 오늘의 도전: 날짜마다 서킷 · 규칙 · 체급이 바뀌는 하루 1회 기록전 + 전용 순위표 / Daily Challenge: one run a day on a date-seeded circuit, rule and kart class, with its own board
- 트랙별 기록 리더보드 / Per-track leaderboards
- 차고: 도색 무료, 라이버리 32 · 언더글로우 6 · 트레일 10 · 배기 화염 8 · 휠 4 · 엔진음 5 · 엠블럼 8 · 프리셋 13(유료 해금) / Garage: free paint; 32 liveries · 6 underglows · 10 trails · 8 exhaust flames · 4 wheel effects · 5 engine sounds · 8 emblems · 13 presets (paid unlock)
- 계정 저장: 닉네임 · 트랙별 최고 기록 · 차고 외형 · 컵 성적 · 구매 내역 / Saved to the account: nickname, best times, garage look, cup results, purchases
- 한국어 / English, 가로 화면 전용(모바일 터치 스틱 + 버튼) / Korean and English, landscape only (touch stick + buttons on mobile)

## 결제 · 광고 안내 / Purchases & ads

- 유료 상품 1종 / One paid product: **차고 해금 `premium-garage` · 100 VX**, 비소모성 1회 구매 / non-consumable, one-time
  - 해금 내용: 차고 유료 꾸미기 항목 전체 + 프리미엄 카트 3종(Fennec Flash · Boulder Bram · Big Rig Rosa) 영구 이용 / Unlocks every paid garage cosmetic and permanent use of the 3 premium karts
  - 구매는 서버에 기록되어 다른 기기에서도 복원돼요. / The purchase is recorded on the server and restored on any device.
- 광고 1종 / One ad placement: **선택형 리워드 광고 `rewarded_premium_kart`** / opt-in rewarded ad
  - 시청 완료 시 프리미엄 카트 이용권 +3레이스(보유 최대 9회, 하루 최대 10회 시청) / +3 premium-kart races per completed ad (hold up to 9, max 10 ads a day)
  - 보상은 서버 검증 후 지급되고, 중단하거나 실패하면 지급되지 않아요. / Granted after server verification; skipped or failed ads grant nothing.
- 강제 전면 광고 없음 / No forced interstitial ads
- 확률형 아이템 없음: 레이스 중 아이템 상자는 순위에 따른 플레이 요소이며 구매 · 보유 · 거래가 불가능해요. / No probability-based items: race item boxes are a gameplay element weighted by position and cannot be bought, kept or traded.
- 그 밖의 모든 콘텐츠(기본 레이서 5명 · 서킷 8개 · 그랑프리 · 오늘의 도전 · 리더보드)는 무료 / Everything else (5 standard racers, 8 circuits, Grand Prix, Daily Challenge, leaderboards) is free

## 크레딧 / Credits

- 원작 / Original: [bridge-mind/turbo-kart-rush](https://github.com/bridge-mind/turbo-kart-rush), MIT License
- Verse8 이식 · 확장 / Verse8 port and extensions: Drift Kart (차고 · 그랑프리 · 오늘의 도전 · 한국어화 · 터치 조작 · 리더보드 / garage, Grand Prix, Daily Challenge, Korean localisation, touch controls, leaderboards)
- 에셋 / Assets: 외부 에셋 파일 없음. 모델 · 텍스처 · 효과음 · 음악 전부 코드로 생성 / No external asset files; models, textures, sound effects and music are all generated in code
- 엔진 / Engine: Three.js (MIT)
