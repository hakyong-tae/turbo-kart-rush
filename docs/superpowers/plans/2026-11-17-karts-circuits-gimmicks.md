# 카트 8대 + 서킷 8개 + 주로 기믹 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카트를 16대, 서킷을 16개로 늘리고, 주로 기믹(점프대·끊긴 도로·공중 묘기, 얼음·진흙·긴 부스트 띠, 움직이는 장애물, 지름길)을 만들어 새 서킷과 기존 서킷에 넣는다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-11-17-karts-circuits-gimmicks-design.md`. 기믹은 `TrackDefinition`의 선택 필드이고 트랙 모듈 안에서 해결한다: 점프대는 `Track.query()`의 지면 높이, 움직이는 장애물은 레이스 시계로 위치가 정해지는 `track.obstacles`. 카트 물리는 노면 두 종류·묘기·장애물 피격만 더한다.

**Tech Stack:** TypeScript 7, Three.js 0.185, Vite 8, vitest, puppeteer(헤드리스 도구).

**공통:** `export PATH="$HOME/.nvm/versions/node/v23.11.0/bin:$PATH"`, 브랜치 `karts-circuits-gimmicks`, push 금지, `package-lock.json` 건드리지 않음. 단계마다 `npm run typecheck && npm test` 통과 후 커밋.

---

### Task 1: 카트 8대
- [ ] `src/kart/roster.ts`에 8명 추가(스펙 1절 표), `src/kart/bodies.ts`에 차체 8종, `KART_BODIES`에 등록
- [ ] `KartModel.makeNumberTexture` 두 자리 번호
- [ ] `server.js` `CHARACTERS`·`PREMIUM`, 서버 목록 = 로스터 테스트(`src/verse8/server.test.ts`)
- [ ] 번역 `char.<id>.tagline` 8개(ko/en), `RaceManager.adopt.test.ts`의 그리드 8대 고정
- [ ] `tools/kart-lineup.mjs` 16대, 라인업 캡처로 실루엣 확인
- [ ] typecheck·test·커밋

### Task 2: 기믹 — 트랙 쪽
- [ ] `core/types.ts`: `SurfaceType` += ice/mud, `TrackDefinition` += ramps/zones/movers/wallHalfWidthFactors, `TrackObstacle` += velocity/hit, `ITrack` += setRaceTime/isRespawnSafe
- [ ] `core/balance.ts`: `BALANCE.track`
- [ ] `track/features.ts`(신설): 정의 → 계산용 데이터(점프대 구간, 구간 표, 움직이는 장애물 위치 함수). 순수 함수 + 테스트
- [ ] `Centerline`: 포인트별 벽 배수. `Track.query`: 점프대 높이, 끊긴 도로 void, 얼음·진흙·부스트 구간
- [ ] `builders/road.ts`·`barriers.ts`: 끊긴 도로 구간 비우기. `builders/features.ts`(신설): 쐐기, 노면 띠, 움직이는 장애물 메시
- [ ] `validate.ts`: 기믹 규칙. 테스트
- [ ] 커밋

### Task 3: 기믹 — 카트·레이스·AI 쪽
- [ ] `Kart.ts`: 얼음 접지력, 진흙 속도·가속, 긴 부스트 띠, 도로 아래 추락, `hit` 장애물 스핀, 공중 묘기 + 착지 부스트, 묘기 회전 연출
- [ ] `RaceManager.respawn`: 안전한 체크포인트. `Game.step`: `track.setRaceTime`
- [ ] `AIDriver`: 움직이는 장애물 예측·감속, 묘기
- [ ] `net/FakeTrack` 기반 물리 테스트, 커밋

### Task 4: AI 완주 검사 도구
- [ ] `tools/track-soak.mjs`: 서킷별 빨리감기 레이스, 완주·랩 타임·리스폰 수 표

### Task 5: 기존 서킷 8개에 기믹
- [ ] 스펙 3절 둘째 표대로 넣고 서킷마다 soak + 캡처, 커밋

### Task 6: 새 서킷 8개
- [ ] `tools/track-preview.mjs`(위에서 본 그림)로 레이아웃 확인하며 8개 작성, `tracks/index.ts` 등록
- [ ] `core/cups.ts` stunt·extreme, `server.js` TRACKS·CUPS, 번역(서킷 설명, 컵 이름, 팁), 테스트 갱신
- [ ] 서킷마다 soak + 캡처, 커밋

### Task 7: UI 16장
- [ ] 레이서·서킷 카드 16장 레이아웃(폰·PC), 컵 칩 5개, 기록 탭 16개, 캡처 확인, 커밋

### Task 8: 마무리
- [ ] typecheck·test·build, 전 화면 캡처, CONTRACT·ARCHITECTURE·NOTES 갱신, 스펙에 구현 중 판단 기록, 커밋
