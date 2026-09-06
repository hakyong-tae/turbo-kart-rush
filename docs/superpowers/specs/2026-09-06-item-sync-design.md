# Turbo Kart Rush — 스펙 C: 온라인 아이템 동기화 (멀티 2단계)

날짜: 2026-09-06 · 브랜치: `item-sync` · 선행: 스펙 B(main 머지, V8 develop 배포·게시 완료)

## 목표
온라인 레이스에서 아이템(박스·룰렛·발사체·해저드·효과)을 **호스트 권위**로 동기화한다. 클라는 아이템 로직을 돌리지 않고 스냅샷/이벤트를 그대로 그린다. 방 설정에 아이템 ON/OFF 토글(기본 ON).

## 구조
- **호스트**: 기존 `ItemManager`(authority) 그대로. 원격 플레이어의 아이템 사용은 INPUT의 `useSeq`(누를 때마다 +1) 변화로 감지 → `items.requestUse(kart, aimBack)`.
- **클라**: `ItemManager.setNetMode('mirror')` — `update()`는 시각만(박스 부유·스케일인, 오빗 회전, 해저드 애니메이션), 픽업·룰렛·물리·충돌 없음. `applyNetItems()`로 박스 활성 비트·해저드(id별 생성/이동/제거) 반영.
- **스냅샷 확장**: 카트 21B(+flags2: invincible/shrunk/squished/hopping/rouletteActive, item u8, itemCount u8) + 아이템 섹션(박스 비트마스크, 해저드 11B×n: id u16, kind u8, owner u8, xyz i16, flags u8). 8카트+10해저드 ≈ 300B.
- **FX 이벤트**: 호스트가 `item:*` 이벤트를 틱 동안 모아 스냅샷 주기마다 `MSG.FX`(신뢰성 relay, 배치 1회)로 방송. 클라가 같은 이벤트를 로컬 버스에 재방출(`isPlayer` 재계산) → HUD·오디오·파티클·포스트FX가 무수정으로 동작.
- 카트 상태 플래그(스핀·무적·축소·찌부)는 스냅샷으로 도착 → `Kart.applyNetState` 확장.
- 로컬 카트: 위치는 예측/보정 유지, 아이템 슬롯(item/itemCount/roulette)과 상태 플래그는 스냅샷 값을 그대로 채택.

## 프로토콜
- INPUT 7B: … + `useSeq u8`.
- SNAPSHOT: 헤더 9B · 카트 21B×n · `boxCount u8` · 비트마스크 `ceil(boxCount/8)`B · `hazardCount u8` · 해저드 11B×m.
- `MSG.FX`: `[{e, k?, s?, i?, p?:[x,y,z], r?}]` — e ∈ pickup·rouletteEnd·use·hit·destroyed·shellBounce·explosion·lightning·boxRespawn.
- `START.items: boolean`, `RoomState.items`(기본 true), `OnlineRaceConfig.items`.

## 파일
`src/net/protocol.ts`(확장) · `src/core/types.ts`(NetKartPose 확장, `OnlineRaceConfig.items`, `NetItems`) · `src/kart/Kart.ts`(applyNetState 확장) · `src/items/ItemManager.ts`(netMode, getNetItems, applyNetItems, 시각 전용 업데이트) · `src/net/host-session.ts`(items 소스, useSeq→사용 요청, FX 배치) · `src/net/client-session.ts`(useSeq, 해저드 보간, FX 재방출, 로컬 슬롯 미러) · `src/net/online.ts`·`lobby.ts`·`src/ui/OnlinePanel.ts`(items 토글) · `src/game/Game.ts`(host: 원격 사용 요청 처리 / client: mirror update).

## 테스트
protocol 라운드트립(아이템 섹션·useSeq) · ItemManager mirror(박스 비트 반영, 해저드 생성/이동/제거, requestUse no-op) · 세션 통합(호스트 해저드 스폰 → 클라 해저드 존재·위치, FX 재방출 이벤트 수신, useSeq→호스트 requestUse 호출) · 기존 68개 유지.

## 범위 밖
호스트 승격, 카트 위 닉네임, 관전.
