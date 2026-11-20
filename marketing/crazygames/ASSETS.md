# Drift Kart — CrazyGames 커버·미리보기 영상 / Covers and preview videos

2026-11-20 제작. 게임 저장소 브랜치 `crazygames-relaunch`(8f5dab6)의 CrazyGames판(`vite --mode crazygames`)에서 찍었다.

## 파일 / Files

| 파일 | 규격 | 용도 |
|---|---|---|
| `cover_landscape_1920x1080.png` | 1920×1080 (16:9) | 가로 커버 / Landscape cover |
| `cover_portrait_800x1200.png` | 800×1200 (2:3) | 세로 커버 / Portrait cover |
| `cover_square_800x800.png` | 800×800 (1:1) | 정사각 커버 / Square cover |
| `preview_landscape_1920x1080.mp4` | 1920×1080, 30fps, 17.8초, 무음, 36MB | 가로 미리보기 / Landscape preview |
| `preview_portrait_1080x1620.mp4` | 1080×1620 (2:3), 30fps, 17.8초, 무음, 36MB | 세로 미리보기 / Portrait preview |

커버 3장은 저장소에 들어 있다. 영상 2개는 용량 때문에 커밋하지 않는다(`.gitignore`의
`marketing/crazygames/preview_*.mp4`). 이 폴더에 파일로만 있고, 저장소를 새로 받으면 없으니 아래
"다시 만들기"로 만들거나 따로 받아 온다.

The three covers are committed. The two videos are not (36 MB each; `.gitignore`): they live in this
folder as files only, so a fresh clone has to regenerate them or get them from elsewhere.

## CrazyGames 규격 대조 (docs.crazygames.com/requirements/game-covers, 26-11-20 확인)

- 커버 3종(16:9 1920×1080, 2:3 800×1200, 1:1 800×800), 같은 그림: 충족
- 커버 글자는 게임 제목만, 테두리·아이콘·스토어 로고 없음: 충족(게임 안 워드마크 DRIFT KART만)
- 단순 스크린샷 지양: 실제 레이스 한 순간을 카트 옆 낮은 카메라로 다시 찍은 컷(HUD 없음)
- 영상 2종(16:9 1080p, 2:3 1080p), 15~20초, 50MB 이하, 무음: 충족
- 영상에 홍보 문구·아이콘·검은 띠·마우스 커서 없음, 배속 없음(1/30초 스텝 캡처): 충족
- 첫 프레임은 커버(0.4초), 이후 실제 플레이 6컷 × 2.9초
  (Coral Coast → Neon Nexus → Stunt Park → Magma Ridge → Frostbite Falls → Skyline Loop)

## 알아둘 점

- 플레이 장면은 개발용 자동 주행(`?auto=1`, 하드 AI)이 플레이어 카트를 몬 실제 레이스다. HUD는 숨겼다.
- 가로 영상은 2880×1620 캡처를 1.2배 당겨 1920×1080으로 줄였고, 세로 영상은 같은 프레임의 가운데 1080×1620이다.
- 추격 카메라라 영상 속 카트는 작게 보인다. 커버는 카트를 크게 잡았다.
- 커버의 출발 게이트 간판은 뒤에서 보면 글자가 뒤집혀 보여서, 가로 커버는 간판이 잘리도록 당겼다.

## 다시 만들기 / Regenerate

도구는 `tools/marketing/crazygames-{capture,logo,covers}.mjs`와 `crazygames-video.py`다. 같은 폴더의
`lib.mjs`를 쓴다(Playwright 위치는 `PLAYWRIGHT` 환경 변수, 서버 주소는 `BASE`, 기본 `http://localhost:4942`).
ffmpeg와 Python의 Pillow가 필요하다. 명령은 모두 저장소 루트에서 실행한다.

```bash
# 1) CrazyGames판 개발 서버 (다른 터미널에서 띄워 둔다)
npx vite --mode crazygames --port 4942 --strictPort

# 2) 캡처 (WORK = 저장소 밖 임시 폴더, 서킷당 약 1분)
export WORK=/tmp/dk
node tools/marketing/crazygames-logo.mjs
for t in "Coral Coast" "Neon Nexus" "Stunt Park" "Magma Ridge" "Frostbite Falls" "Skyline Loop"; do node tools/marketing/crazygames-capture.mjs race "$t" 24 7; done
MAX=12 ALL=1 EVERY=9 CAMS=c1,c2,c3 node tools/marketing/crazygames-capture.mjs hero "Stunt Park" 5 0.3
python3 -c "import os; from PIL import Image; w=os.environ['WORK']; im=Image.open(w+'/logo.png'); b=im.getbbox(); im.crop((b[0]-8,b[1]-8,b[2]+8,b[3]+8)).save(w+'/logo-trim.png')"

# 3) 커버 → 영상 (커버가 먼저: 영상 첫 프레임에 쓴다)
OUT=marketing/crazygames node tools/marketing/crazygames-covers.mjs "$WORK/hero/stunt-park/h0090_c1L_d0b1_n4.jpg"
OUT=marketing/crazygames python3 tools/marketing/crazygames-video.py
```

레이스는 매번 다르게 흘러가므로 다시 찍으면 장면이 달라진다. 커버 컷은 `$WORK/hero/` 후보를 눈으로 골라
`crazygames-covers.mjs`에 넘긴다(위 파일 이름은 이번에 고른 컷의 것이라 다시 찍으면 바뀐다). 3단계는 이
폴더의 커버와 영상을 덮어쓴다.

도구를 이 저장소로 옮긴 뒤(파일 이름과 `lib.mjs` 불러오는 경로만 바꿈)에는 문법만 확인했고, 캡처를 다시
돌려 보지는 않았다.
