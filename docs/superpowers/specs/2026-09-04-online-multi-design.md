# Turbo Kart Rush — 스펙 B: 온라인 멀티 레이스 (MVP, 아이템 OFF)

날짜: 2026-09-04 · 브랜치: `online-multi` · 선행: 스펙 A(`2026-09-04-v8-integration-design.md`, main 머지)
참조: `verse8-starter/docs/VERSE8-MULTIPLAYER.md`(라이브 검증 함정 10개), `soldat-web/src/net/*`, `soldat-web/server/src/server.ts`

## 결정 (사용자 확인)
- 로비: 퀵 레이스(자동 배정) + 방 목록 + 4자 코드 방. 방장이 트랙·난이도·랩 선택, 전원 READY 시 시작.
- 아이템: MVP OFF(방 설정에 토글 자리만, 비활성). 2단계에서 호스트 권위 아이템.
- 호스트 이탈: 8초 무스냅샷 → 토스트 + 마지막 순위로 결과. 승격은 2단계.
- 모델: 호스트 권위 스냅샷 + 클라 자기 카트 예측/보정. 인원 2~8, 부족분 AI.
- 멀티 기록은 리더보드에 제출하지 않음. 프리미엄 카트 게이트는 방에서 동일 적용.

## 1. 구조
```
호스트(방장 브라우저) = 권위 시뮬 60Hz (기존 Game.step 그대로: Kart.update×8, AI, RaceManager)
  입력   각 클라 → relayHot INPUT (3틱=50ms, throttle 50) → 호스트 kart.setInput
  상태   호스트 → relayHot SNAPSHOT (3틱=50ms) → 전원
  이벤트 START · LOADED · RESULTS · LEAVE → relay (신뢰성 JSON)
  방     $global 컬렉션 tkr_rooms(목록·하트비트 5s/스테일 90s) + roomState(p_{account}, 설정)
server.js = 스펙 A 함수 + 방 함수(listRooms/joinRoom/touchRoom/leaveRoom/getRoomState/updateRoomState/relay/relayHot/now)
```
- 클라: 자기 카트는 로컬 Kart.update(자기 입력)로 예측, 스냅샷의 자기 상태와 오차 > 0.6m면 100ms 블렌드, > 5m면 스냅. 다른 카트(사람·AI)는 스냅샷 보간(100ms 지연 버퍼) → `Kart.applyNetState`. 클라 RaceManager는 카운트다운(3-2-1-GO 로컬 타이머)만 돌리고, 이후 랩·순위·완주는 스냅샷 값으로 덮어쓰며 동일 이벤트(`race:lap` 등)를 로컬 방출.
- 카트 배정: 로스터 joinedAt 순, 호스트 = 0. 사람이 고른 캐릭터 제외 나머지를 로스터 순서 기준 결정론적으로 AI에 배정 → 모든 클라가 같은 8대 구성.
- `KartState.isPlayer`는 각 클라에서 **자기 카트만 true** → HUD/오디오/이벤트 필터 무수정. Game의 `karts[0]` 하드코딩은 `r.localKartId`로 치환.

## 2. 프로토콜 (`src/net/protocol.ts`, 바이너리 → transport가 base64 래핑)
- INPUT (6B): steer i8(×127) · throttle u8 · brake u8 · flags u8(bit0 drift, bit1 itemHeld, bit2 lookBack) · seq u16.
- SNAPSHOT (9B 헤더 + 18B×n): tick u32 · phase u8(0 grid,1 countdown,2 racing,3 complete) · countdown u8 · raceTime u16(0.1s) · n u8 ; 카트: id u8 · x,y,z i16(cm) · heading i16(rad×10000) · speed i16(cm/s) · flags u8(drift,boost,air,spin,frozen,finished,wrongWay) · driftStage u8 · lap u8 · place u8 · checkpoint u8 · finishTime u16(0.1s). 8대 = 153B.
- JSON: `START{trackId, difficulty, laps, roster:[{account,nick,characterId,kartId}], hostEpoch}`, `LOADED{account}`, `RESULTS{standings}`, `LEAVE{account}`, `PING{ping}`.

## 3. 파일
| 파일 | 내용 |
|---|---|
| `server.js` | 방 함수 이식(컬렉션 `tkr_rooms`, key = 4자 코드 `[A-HJ-NP-Z2-9]`, CAP 8, STALE 90s, `_upsertRoom` 2인자 update). `relay`/`relayHot`/`now` |
| `src/net/types.ts` | `Transport` 인터페이스, `RoomState{hostAccount,trackId,difficulty,laps,items:false,started,hostEpoch,p_*}`, `RoomPlayer{nick,characterId,ready,joinedAt,ping}`, `RoomListing` |
| `src/net/transport.ts` | agent8 래퍼(soldat 이식: base64, relay/relayHot, updateRoomState needResponse 재시도). 접속은 `src/verse8/server.ts`의 스토어 경유 `ensureConnected` 재사용 |
| `src/net/loopback.ts` | 인메모리 N-엔드포인트 transport(테스트·로컬 데모) |
| `src/net/protocol.ts` | 위 인코딩/디코딩 |
| `src/net/roster.ts` | 로스터 정렬·kartId 배정·AI 캐릭터 결정론 배정(순수 함수) |
| `src/net/host-session.ts` | 입력 수신→setInput, 3틱마다 스냅샷 송신, `race:allFinished`→RESULTS, 이탈자→`onHumanLeft(kartId)` |
| `src/net/client-session.ts` | 입력 송신, 스냅샷 버퍼·보간·보정, phase/lap/place/finish 콜백, 8s 타임아웃 |
| `src/net/lobby.ts` | 방 목록·퀵/코드 입장·roomState 구독·READY·설정 패치·하트비트 |
| `src/kart/Kart.ts` | `applyNetState(pose)` 추가(IKart 옵셔널 메서드, 계약 추가) |
| `src/core/types.ts` | `RaceSettings.online?: OnlineRaceConfig` (role, roster, localKartId) — 계약 추가 |
| `src/game/Game.ts` | 온라인 분기: 카트 구성, step(호스트 전체/클라 로컬만), raceManager 처리, 이벤트, 결과, 이탈 |
| `src/ui/OnlineLobby.ts`, `src/ui/RoomPanel.ts` | 로비/방 UI, 닉네임·카트·READY·핑, 방장 설정, 코드 표시 |
| `src/ui/HUD.ts` | 카트 닉네임 라벨은 2단계(MVP는 결과·방 화면에만 닉) |

## 4. 흐름
1. 타이틀 ONLINE → 로비. 퀵: `joinRoom(null)`; 목록: 선택 → `joinRoom(key)`; 코드 입력 → `joinRoom(code)`; 방 만들기 → 서버가 빈 코드 생성. 첫 입장자가 `hostAccount`.
2. 방: p_{account} = {nick(설정 닉 or RACER-xxxx), characterId(프리미엄은 canRace 게이트), ready, joinedAt}. 방장 5s 하트비트 `touchRoom`. 전원 READY(≥2명) → 방장 START.
3. START 수신 → `startRace({trackId, difficulty, laps, characterId: 내 카트, online:{role, roster, localKartId}})`. 로딩 완료 시 `LOADED`. 호스트는 전원 LOADED 또는 10s 후 `raceManager.startCountdown()`; 클라는 스냅샷 phase가 countdown이 되면 자기 raceManager.startCountdown()(로컬 3-2-1-GO).
4. 레이스: §1. 호스트 `race:allFinished` → RESULTS. 클라는 RESULTS 수신 → 결과 화면. 결과 → 방으로 복귀(ready 해제).
5. 이탈: 클라 LEAVE/roomState p_ 제거 → 호스트가 해당 카트에 AIDriver 부착. 호스트 무스냅샷 8s → 클라 토스트 + 마지막 스냅샷 순위로 결과.

## 5. 테스트
- vitest: protocol 라운드트립(양자화 허용오차), roster 배정 결정론, client-session 보간 버퍼·보정 임계(가짜 kart 상태), host↔client 루프백 통합(FakeTrack 원형 트랙 + 실제 Kart 물리, 200틱 후 클라의 원격 카트 위치가 호스트와 0.3m 내, 로컬 예측 카트 보정 수렴), lobby 상태(READY 판정·호스트 판정), server.js 방 함수(업서트·스테일·코드 생성).
- 브라우저: 실 2인은 V8 배포 후 Puppeteer 2개(가이드 §9). 로컬은 로비 UI(오프라인 표시)와 루프백 데모(`?loopback=1`: 같은 페이지에서 호스트 세션 + 가짜 클라 1명 봇 입력) 로 흐름 확인.

## 6. 2단계 (이 스펙 밖)
호스트 권위 아이템(박스·발사체 스냅샷), 호스트 승격(hostEpoch), 카트 위 닉네임 빌보드, 진행중 방 관전.
