# Drift Dash GP — 원스토어 등록 에셋 / ONE store kit

원스토어 등록 형식(대표 이미지 1장 + 원본 스크린샷)에 맞춘 세트. 스크린샷은 캡션·오버레이 없는 실제 게임 화면이고, 빌드 배지("build …")와 개발용 오버레이만 숨겼어요.
Laid out for the ONE store listing: one feature graphic plus raw in-game screenshots (no captions or overlays; only the "build …" badge and dev overlays are hidden).

## 파일 / Files

| 파일 / File | 규격 / Spec | 내용 / Content |
|---|---|---|
| `00_STORE_TEXT.md` | — | 제목·장르/태그·짧은/긴 설명(KO → EN)·결제/광고·크레딧 / listing copy |
| `graphic_1024x578.png` | 1024×578 | 대표 이미지: 게임 로고 + 한 줄 소개 + 실제 레이스 장면(네온 넥서스) / feature graphic |
| `ScreenShots/screenshot-01.png` | 1280×720 | 타이틀 · 로비 / title & lobby |
| `ScreenShots/screenshot-02.png` | 1280×720 | 레이서 선택 / racer select |
| `ScreenShots/screenshot-03.png` | 1280×720 | 서킷 선택 · 모드 · 그랑프리 / circuit, mode and Grand Prix select |
| `ScreenShots/screenshot-04.jpg` | 1280×720 | 미니터보 부스트 · 추월(마그마 리지) / mini-turbo boost and overtake |
| `ScreenShots/screenshot-05.jpg` | 1280×720 | 아이템 난전: 빨간 등껍질 · 접전(마그마 리지) / item scramble |
| `ScreenShots/screenshot-06.png` | 1280×720 | 출발 직후 그리드(코럴 코스트) / the pack off the start line |
| `ScreenShots/screenshot-07.png` | 1280×720 | 차고 · 프리셋(홀로 그리드) / garage presets |
| `ScreenShots/screenshot-08.png` | 1280×720 | 레이스 결과 / results |
| `ScreenShots/phone-1.jpg` | 2532×1170 | 폰 가로: 로비 / phone landscape: lobby |
| `ScreenShots/phone-2.jpg` | 2532×1170 | 폰: 부스트 패드 · 2위 추월(네온 넥서스), 터치 버튼 / boost pad, touch buttons |
| `ScreenShots/phone-3.jpg` | 2532×1170 | 폰: 접전 · 후방 미러 / close pack with the rear-view mirror |
| `ScreenShots/phone-4.jpg` | 2532×1170 | 폰: 차고 / garage |
| `ScreenShots/phone-5.jpg` | 2532×1170 | 폰: 오늘의 도전 / daily challenge |

- 파일당 1.3 MB 이하. PNG가 넘으면 같은 이름의 고화질 JPG로 저장 / Each file ≤ 1.3 MB; a PNG over the cap is saved as a high-quality JPG with the same stem
- 게임은 가로 전용이라 세로 스크린샷은 없어요. / The game is landscape-only, so there are no portrait shots.
- 폰 스크린샷은 844×390 @3x 터치 에뮬레이션(isMobile + hasTouch)이라 터치 조작 버튼이 보여요. / Phone shots use 844×390 @3x touch emulation, so the touch controls show.

## 다시 만들기 / Regenerate

```bash
export PATH="$HOME/.nvm/versions/node/v23.11.0/bin:$PATH"
npx vite --port 4941 --strictPort &           # dev 서버 필요(?auto=1 오토파일럿·이벤트 버스가 dev 전용)

node tools/marketing/shots.mjs                # desktop + phone + keyart (약 10분 / ~10 min)
node tools/marketing/shots.mjs desktop        # 한 세트만 / one profile only
SCENES=tracks,garage node tools/marketing/shots.mjs desktop   # 메뉴 장면만 다시 / re-shoot only these scenes

node tools/marketing/graphic.mjs marketing/onestore-kit/_work/keyart/<frame>.png
#   ZOOM=1.5 FOCUS=0.552,0.481 AT=0.66,0.52  → 액션 지점(FOCUS, 원본 비율)을 배너의 AT 위치로 확대 배치
```

- 레이스 장면은 실제 레이스(AI가 플레이어 카트까지 운전)를 30fps로 한 프레임씩 진행하며 점수(드리프트·부스트 / 시야 안 피격 / 앞쪽 카트 수)를 매겨 카테고리별 상위 후보를 `_work/cand-<profile>/`에 남기고 1위를 복사해요. 레이스는 매번 달라지므로 후보를 훑어보고 `PICK_<profile>_<drift|item|pack>=<파일명>`으로 골라 다시 돌리거나 직접 복사해요.
- Race shots: a real race (the AI drives the player kart too) is stepped one 30 fps frame at a time and scored (drift/boost, a hit in view, karts ahead); the top candidates per category land in `_work/cand-<profile>/` and the best is copied. Races differ run to run, so review the candidates and pick with `PICK_<profile>_<cat>=<file>` or copy by hand.
- 이번 세트의 선택: 04 = `drift_t5_02772`, 05 = `item_t5_00225`, 06 = `pack_t1_00000`, 08 = `results_t5_p6`, phone-2 = `drift_t4_00258`, phone-3 = `item_t4_00195`, 대표 이미지 배경 = `keyart/t4_00762_6.3.png`
- 헤드리스 Chromium(Playwright) + Metal ANGLE(프레임당 ~30 ms). `SWIFTSHADER=1`도 동작하지만 1920×1080 한 장에 ~15 s / Headless Chromium with the Metal ANGLE backend; SwiftShader works but is ~500× slower
- 숨기는 것: 빌드 배지, 로비 버전 줄(빌드 스탬프 포함), 토스트, Vite 오류 오버레이. 로컬에서만 생기는 "순위를 불러오지 못했습니다" 줄(오늘의 도전)과 1280×720에서 카드에 가려 한 글자만 삐져나오는 서킷 선택 헤더도 숨김 / Hidden: build badge, lobby version line, toasts, Vite overlay, the local-only "could not load the board" line, and the track-select header sliver that the card grid covers at 1280×720
- 차고 스크린샷은 로컬 모의 결제(메모리 내, 실제 결제 아님)로 차고 해금 상태를 만든 뒤 찍어요. / The garage shot unlocks the garage through the local in-memory mock checkout (no real purchase).
- 작업 파일은 `_work/`(gitignore) / Intermediate files live in `_work/` (gitignored)
