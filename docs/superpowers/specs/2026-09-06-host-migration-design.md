# Drift Dash GP — 스펙 D: 호스트 승격 (멀티 3단계) + 제목 변경

날짜: 2026-09-06 · 브랜치 `host-migration`

## 제목
Turbo Kart Rush → **Drift Dash GP** (`GAME_TITLE`, index.html, package.json, WebGL 에러 문구, README 상단). 원작 표기·MIT 고지는 README에 유지.

## 호스트 승격
- 스냅샷 헤더에 `hostEpoch u8`(10B 헤더). 클라는 더 낮은 epoch 스냅샷을 무시하고, 같은 epoch에선 최초 발신자만 인정(스플릿브레인 가드). 새 epoch가 오면 버퍼를 비우고(새 호스트 tick 카운터) `onHostChanged`.
- 8초 무스냅샷 → `pickNextHost(roster, gone)` = 떠나지 않은 사람 중 kartId 최소. 내가 후보면 `promote()`: `HostSession(epoch+1)` 생성(markGone·markAllLoaded), roomState `hostAccount/hostEpoch` 갱신, `MSG.HOST` 알림. 후보가 아니면 8초 더 기다리고 후보를 gone에 추가해 재시도(연쇄 폴백). 남은 사람이 없으면 기존처럼 결과 화면.
- 승격 시 Game: `role='host'`, 비인간 슬롯·이탈자에게 AIDriver, `ItemManager` authority 전환 + reset(미러 해저드는 물리 없음), `RaceManager.adoptFromKarts(raceTime, phase)`로 랩/체크포인트/완주 상태를 카트 상태에서 재구성 후 권위 재개, `attachRace`로 스냅샷 송신 시작.
- OnlineController가 transport 메시지 핸들러를 단독 소유하고 세션에 `handleMessage`로 전달(이전엔 세션 생성이 핸들러를 덮어써 LEAVE 추적이 끊기던 버그 수정).

## 테스트
epoch 가드(구 호스트 복귀 무시·새 호스트 추종·재손실 미발생), `pickNextHost`, `adoptFromKarts`(완주/랩 유지·재개 후 완주 가능·카운트다운 재시작). 75 tests.
