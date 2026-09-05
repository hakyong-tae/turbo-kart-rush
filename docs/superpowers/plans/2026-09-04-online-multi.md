# Turbo Kart Rush 온라인 멀티(스펙 B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 호스트 권위 스냅샷 + 클라 예측 모델로 2~8인(AI 채움) 온라인 레이스. 아이템 OFF. 로비(퀵/목록/코드) + 방(READY/설정) + 결과 복귀.

**Architecture:** `src/net/**`(transport·protocol·roster·sessions·lobby)는 게임 코어와 `IKart`/이벤트 버스로만 연결. 호스트는 기존 `Game.step` 그대로 전체 시뮬, 클라는 자기 카트만 시뮬 + 나머지 스냅샷 보간. `KartState.isPlayer`는 각 클라에서 자기 카트만 true. 스펙: `docs/superpowers/specs/2026-09-04-online-multi-design.md`.

**Tech Stack:** 기존 + soldat-web 넷 계층 이식(transport/relay 서버). 검증: vitest(루프백 통합), 브라우저 `?loopback=1` 데모.

**공통:** `export PATH="$HOME/.nvm/versions/node/v23.11.0/bin:$PATH"; cd /Users/hytae/Downloads/turbo-kart-rush` (브랜치 `online-multi`). 각 Task 끝: `npm test && npm run typecheck`, 커밋.

---

## Part 1 — 넷 기반 (순수 로직, 테스트 우선)
- [ ] **1.1 `server.js` 방 함수** — soldat `server.ts`의 listRooms/joinRoom/touchRoom/leaveRoom/getRoomState/updateRoomState/relay/relayHot/now를 `class Server`에 추가. 컬렉션 `tkr_rooms`, key = 4자 코드(`[A-HJ-NP-Z2-9]`, 충돌 시 재생성), `joinRoom(null)` = 시작 전·8명 미만 방 우선 아니면 새 코드. `_upsertRoom`은 **2인자 update**. `$room.getRoomState()` p_ 키 수로 count. 하네스 테스트: 업서트가 __id 유지, 스테일 90s 필터, 퀵 조인이 열린 방 선택, 코드 생성 4자.
- [ ] **1.2 `src/net/types.ts`** — Transport/RoomState/RoomPlayer/RoomListing/MessageHandler (soldat 이식, 필드는 스펙 §3).
- [ ] **1.3 `src/net/protocol.ts` (+test)** — `encodeInput/decodeInput`, `encodeSnapshot/decodeSnapshot`, 상수 `MSG`. 테스트: 라운드트립 오차(pos ≤ 0.01m, heading ≤ 1e-3, speed ≤ 0.01), 8대 길이 153B, flags 비트.
- [ ] **1.4 `src/net/roster.ts` (+test)** — `buildRoster(players: {account,nick,characterId,joinedAt}[], hostAccount)` → joinedAt 순·호스트 0; `assignAiCharacters(roster)` → 8대 캐릭터 배열 결정론.
- [ ] **1.5 `src/net/loopback.ts`** — `createLoopbackHub()` → `endpoint(account)`가 Transport 구현(공유 roomState, 브로드캐스트 전원, `deliver()`로 수동 플러시 가능해 테스트 결정론).
- [ ] **1.6 `src/net/transport.ts`** — soldat 이식. provider = `{ getInstance: () => GameServer.getInstance(), ensureConnected }` (스펙 A `server.ts` 재사용). base64 래핑, relayHot throttle 50, updateRoomState 재시도.

## Part 2 — 세션
- [ ] **2.1 `Kart.applyNetState(pose: NetKartPose)`** — position/heading(→quaternion)/speed(→velocity)/flags/driftStage/lap/place/checkpointIndex/finished/finishTime 설정, 내부 lateralVel/slip 리셋 없이 pose만. `IKart.applyNetState?` 옵셔널(계약 추가).
- [ ] **2.2 `src/net/host-session.ts`** — `HostSession(transport, roster)`: `attach(race: {karts, raceManager})`, `onInput`(계정→kartId→setInput), `tick()`(3틱마다 snapshot), `race:allFinished`→RESULTS 송신, `onHumanLeft(kartId)` 콜백(roomState p_ 제거·LEAVE 수신), `startWhenLoaded(timeoutMs=10000)`.
- [ ] **2.3 `src/net/client-session.ts`** — `ClientSession(transport, roster, localKartId)`: `attach(race)`, `sendInput(input)`(3틱), 스냅샷 버퍼(정렬·중복 드롭), `tick(nowMs)`: 보간 시각 = 최신−100ms → 원격 카트 applyNetState; 자기 카트 보정(0.6m 블렌드 15%/틱, 5m 스냅); phase 전이 콜백 `onPhase`; 자기 lap/place/finish 변화 → state 반영 + `race:lap/positionChange/finish` 이벤트; RESULTS→`onResults`; 8s 무스냅샷→`onHostLost(lastStandings)`.
- [ ] **2.4 루프백 통합 테스트** — `src/net/FakeTrack.ts`(원형 반경 80m, 폭 8, 그리드 8, 체크포인트 12) + 실제 `Kart`. 호스트 8대(2 사람 + 6 AI 대신 정지) vs 클라 1명: 300틱 후 원격 카트 위치 오차 < 0.5m, 로컬 예측 카트가 인위적 5m 어긋남 후 20틱 내 수렴.
- [ ] **2.5 `src/net/lobby.ts`** — `Lobby(transport)`: `quickJoin()`, `join(code)`, `create()`, `list()`, `setReady`, `setCharacter`, `hostSetSettings`, `leave`, roomState 구독·파생(`players[]`, `isHost`, `allReady`), 하트비트. 테스트: READY 판정, 호스트 판정, 이탈 시 hostAccount 유지.

## Part 3 — Game 통합
- [ ] **3.1 `RaceSettings.online?`** — `{ role:'host'|'client', roster, localKartId }` (계약 추가).
- [ ] **3.2 `Game.buildRaceInner` 온라인 분기** — 카트 8대: roster kartId별 `new Kart(id, char, id===localKartId)`, 나머지 AI 캐릭터. AIDriver: 호스트=AI 슬롯만, 클라=없음. `items.object.visible=false`, `r.itemsEnabled=false`. `r.localKartId`. `karts[0]` 9곳 → `karts[r.localKartId]`.
- [ ] **3.3 `Game.step` 분기** — 호스트: 기존 + `hostSession.tick()`; 클라: 로컬 카트만 `update`, `clientSession.tick()`, raceManager.update는 phase countdown 동안만, items skip. 입력: 클라는 `clientSession.sendInput`.
- [ ] **3.4 시작/카운트다운/결과** — 로딩 완료 시 호스트: `startWhenLoaded` 후 `enterCountdown`; 클라: LOADED 송신, `onPhase(countdown)`→`enterCountdown`, `onPhase(racing)`은 로컬 GO로 처리. `onResults`→`results.show`. `onHostLost`→토스트+결과. 온라인이면 `maybeSubmitTime` 스킵, 결과 버튼 "방으로" → RoomPanel.
- [ ] **3.5 UI** — `OnlineLobby.ts`(ONLINE 버튼 타이틀 좌하단; 오프라인이면 안내), `RoomPanel.ts`(슬롯 8·닉·카트·READY·핑, 코드, 방장 설정 세그먼트, START), i18n 키 ~30. `?loopback=1` 데모 모드: 로컬 루프백 허브에 봇 클라 1명 자동 참가·READY.
- [ ] **3.6 검증** — vitest 전부, typecheck, build, 브라우저 `?loopback=1`: ONLINE → 방 → START → 카운트다운 → 레이스 → 결과 → 방 복귀, 콘솔 에러 0. 싱글 플레이 회귀(터치·리더보드·프리미엄 무변화).

## Part 4 — 문서·마무리
- [ ] `docs/VERSE8-CONTEXT.md` 멀티 절(relayHot 규칙·방 컬렉션·2인 E2E 절차), `CONTRACT.md` 추가, `NOTES.md` §6 4번 완료. 커밋, PR, 머지.
