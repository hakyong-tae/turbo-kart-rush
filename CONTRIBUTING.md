# 작업 규칙

이 저장소(`hakyong-tae/turbo-kart-rush`)에서 Drift Kart를 고칠 때의 약속입니다.
공개 저장소입니다. 올린 것은 누구나 봅니다.

## 브랜치

| 브랜치 | 쓰임 | 누가 합치나 |
|---|---|---|
| `main` | 기준 버전. Verse8 배포와 CrazyGames 빌드는 여기서 나온다 | 저장소 주인만 |
| `intern/<이름>-<작업>` | 인턴 작업. 예: `intern/sunnew-cgqa-39-lobby-icons` | PR로 `main`에 |
| `crazygames-r2` 등 그 밖 | 저장소 주인 쪽 작업 | 저장소 주인 |

`main`에는 직접 push하지 않습니다. PR과 승인 1개가 있어야 합쳐지고, 강제 push는 막혀 있습니다.

## 작업 순서

1. `main`을 받아 거기서 브랜치를 만든다: `git switch main && git pull && git switch -c intern/<이름>-<작업>`
2. 고친다. 한 PR에는 한 가지 일만 담는다.
3. 아래 "PR 전에 돌릴 것"을 돌린다.
4. push하고 `main`으로 PR을 연다.
   **PR의 대상 저장소가 `hakyong-tae/turbo-kart-rush`인지 꼭 확인한다.** 이 저장소는 포크라서
   GitHub가 원작 저장소(`bridge-mind/turbo-kart-rush`)를 대상으로 먼저 고른다. 그대로 열면 남의 저장소에 PR이 간다.
5. 리뷰에서 나온 말에 답하고 고친다. 합치는 것은 저장소 주인이 한다. 합쳐진 브랜치는 자동으로 지워진다.

QA 이슈를 고치는 작업이면 노션 "CrazyGames QA 이슈 트래커"의 이슈 ID(예: `CGQA-39`)를
브랜치 이름과 PR 제목에 넣는다. 예: `CGQA-39: 로비 아이콘 버튼에 이름`.

## PR 전에 돌릴 것

```bash
npm run typecheck
npm test
npm run build
npm run build:crazygames
```

네 가지는 PR을 열면 GitHub에서도 돌아간다(검사 이름 `ci`). 통과해야 합칠 수 있다.

화면을 바꿨다면 해당 점검 도구도 돌리고, 무엇을 돌렸고 결과가 어땠는지 PR에 적는다.

| 바꾼 곳 | 도구 |
|---|---|
| 로비 | `tools/lobby-check.mjs` |
| 결과 화면 | `tools/results-fit-check.mjs`, `tools/unlock-card-check.mjs`, `tools/auto-next-check.mjs` |
| 글자 크기, 작은 창 | `tools/small-text-check.mjs` |
| 첫 접속, 첫 세 판 | `tools/first-session.mjs` |
| CrazyGames판 문구·요청·SDK | `tools/crazygames-check.mjs`, `tools/crazygames-sdk-check.mjs` |
| 그 밖의 UI | `tools/ui-smoke.mjs` |

쓰는 법은 각 파일 맨 위 주석에 있다. 대부분 개발 서버(`npm run dev`, CrazyGames판은 `npx vite --mode crazygames`)가 떠 있어야 한다.
도구들은 지금 puppeteer를 저장소 주인 기기의 고정 경로에서 읽는다. 다른 기기에서 돌리지 못했다면 그렇게 적고,
바꾼 화면의 전·후 캡처를 PR에 붙인다(한글·영문, PC와 폰 가로).

## 건드리지 않는 것

- **저장 키** (`tkr.*`). 바꾸면 이용자의 저장이 사라진다.
- **`server.js`의 컬렉션·상품·광고 placement 이름.** 서버와 콘솔에 등록된 이름이다.
  `server.js`의 목록·가격표는 클라이언트와 짝이 맞아야 한다(`src/verse8/serverLists.test.ts`, `serverEconomy.test.ts`가 잡는다).
- **`package-lock.json`.** 의존성을 바꿔야 하면 먼저 저장소 주인에게 말한다.
- **게임 이름.** Drift Kart / 드리프트 카트다. 옛 이름은 쓰지 않는다. 문구에는 이름을 적지 않고 `{game}`을 쓴다.
- **비밀.** 토큰, 비밀번호, `.env`는 커밋하지 않는다. 한 번 올라가면 지워도 남는다.

## 두 판이 같은 코드를 쓴다

- `npm run build` = Verse8·원스토어판(`dist/`), `npm run build:crazygames` = CrazyGames판(`dist-crazygames/`).
- 판마다 다른 것은 `src/core/platform.ts`의 `PLATFORM`에 묻는다(`vx`, `rewardedAds`, `online`, `hosted`).
  다른 곳에서 판을 직접 가리지 않는다.
- 판마다 문구가 달라야 하면 `src/core/locales/`에 `'<키>@crazygames'` 항목을 하나 더 둔다.
- CrazyGames SDK를 만지는 코드는 `src/platform/crazygames.ts` 하나뿐이다.
- 한 판만 보고 고치지 않는다. 두 빌드가 다 되는지, 바꾼 화면이 두 판에서 다 맞는지 본다.
- 한글 문구를 새로 넣으면 글꼴에 그 글자가 있는지 테스트가 확인한다(`src/assets/fonts/charset.test.ts`).
  없다고 나오면 저장소 주인에게 말한다.

구조와 지난 결정은 `NOTES.md`, `docs/ARCHITECTURE.md`, `docs/VERSE8-CONTEXT.md`에 있다.

## 배포 태그

배포는 저장소 주인이 한다. 올린 소스 커밋에 태그를 붙여, 지금 어디에 무엇이 떠 있는지 남긴다.

- Verse8에 올린 소스 커밋: `v8-YYYY-MM-DD`
- CrazyGames에 올린 빌드의 소스 커밋: `cg-YYYY-MM-DD`

태그는 저장소 주인이 붙인다.
