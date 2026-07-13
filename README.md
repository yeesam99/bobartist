# BobPlatform v0.0.68

BobPlatform은 여러 개의 실시간 웹 게임을 하나의 게임 선택 로비에서 실행하는 멀티게임 플랫폼입니다.

현재 게임:

- BobArtist: 기존 v0.0.50 게임 흐름과 Socket 이벤트를 유지한 플레이 가능 모듈
- Yacht Dice: 독립 멀티플레이 로비와 서버 기반 Roll/Hold 플레이 단계 제공

## v0.0.68 핵심 원칙

- 기존 BobArtist 게임 로직과 서버 방 상태 구조를 변경하지 않습니다.
- 기존 BobArtist Socket 이벤트명을 그대로 유지합니다.
- 새 게임은 `games/<game-name>` 아래에 독립적으로 추가합니다.
- 게임 전용 규칙과 상태를 `shared`에 넣지 않습니다.

## 현재 구조

```text
client/
├─ src/
│  ├─ games/
│  │  ├─ bobartist/index.ts
│  │  └─ yacht-dice/index.ts
│  ├─ lobby/index.ts
│  ├─ shared/index.ts
│  ├─ main.ts
│  ├─ platform.css
│  └─ style.css
└─ vercel.json

server/
├─ src/
│  ├─ games/
│  │  ├─ bobartist/README.md
│  │  └─ yacht-dice/index.ts
│  ├─ shared/index.ts
│  └─ index.ts
└─ .env.example
```

안정성을 위해 BobArtist 서버 구현은 v0.0.62에서도 `server/src/index.ts`에 유지합니다. 향후 검증된 단계에서만 게임 모듈로 이동합니다.

## 설치 및 실행

```bash
npm install
npm run install:all
npm run dev
```

- Server: `http://localhost:3000`
- Client: `http://localhost:5173`

## 빌드

```bash
npm run build
```

개별 빌드:

```bash
npm run build:server
npm run build:client
```

## 라우팅

Hash 기반 화면 전환을 사용해 Vercel의 직접 경로 새로고침 문제를 줄였습니다.

- `#/` : BobPlatform 게임 선택 로비
- `#/bobartist` : 기존 BobArtist
- `#/yacht-dice` : Yacht Dice 로비 및 Roll/Hold 게임 화면

## 배포

### Render

- Root Directory: `server`
- Build Command: `npm install --registry=https://registry.npmjs.org && npm run build`
- Start Command: `npm start`
- `NODE_VERSION=22`
- `NPM_CONFIG_REGISTRY=https://registry.npmjs.org/`
- `CLIENT_ORIGIN`: Vercel 주소 또는 초기 테스트용 `*`

### Vercel

- Root Directory: `client`
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- `VITE_SERVER_URL=https://YOUR_RENDER_SERVICE.onrender.com`

## 저장 방식

DB를 사용하지 않습니다. BobArtist 방과 게임 상태는 서버 메모리, 닉네임과 최근 방 코드는 브라우저 localStorage를 사용합니다.


## Yacht Dice v0.0.61 안정화

- 실제 주사위 눈 `⚀`~`⚅` 표시
- Roll 시 Hold하지 않은 주사위 흔들림 애니메이션
- Hold 및 Hold 해제 시 짧은 강조 애니메이션
- 레이아웃, 점수 규칙 및 Socket 구조는 v0.0.55와 동일


## Yacht Dice v0.0.61 범위

- 2~6명 멀티플레이 로비
- 방장 시작 및 참가자 Ready
- 서버 생성 주사위 5개와 Roll/Hold
- 클래식 13개 점수 카테고리
- 서버 점수 저장과 다음 플레이어 턴 순환
- 상단 보너스, 총점, 실시간 플레이어 순위
- 데스크톱 한 화면 배치와 작은 화면 반응형 레이아웃

게임 규칙과 Socket 상태 구조는 v0.0.54를 유지하며, v0.0.61는 화면 배치 안정화에 집중합니다.


## v0.0.61 다인 플레이 기준

- 최소 2명, 최대 6명
- 방장을 제외한 모든 참가자 Ready 시 시작
- 참가 인원 순서대로 턴 순환
- 모든 참가자가 13개 항목을 채우면 최종 점수와 공동 우승자를 계산합니다.

### 공통 방 채팅
BobArtist와 Yacht Dice는 `client/src/shared/chat`과 `server/src/shared/chat`의 동일한 채팅 모듈을 사용합니다. 채널은 `/chat/game/{gameId}/{roomCode}` 형식이며 DB 없이 서버 메모리에 방별 최근 100개 메시지만 보관합니다. 서버 재시작 시 채팅 기록은 초기화됩니다.


## 관리자 채팅 모니터 (v0.0.61)

- 경로: `#/admin/chat`
- 서버 환경변수: `ADMIN_CHAT_PASSWORD`
- 로컬 기본 비밀번호: `bobadmin` (배포 환경에서는 반드시 변경)
- DB 없이 서버 메모리의 전체 채널과 최근 로그를 실시간 조회합니다.


## Bob Indian Poker (v0.0.67 Chips & Basic Betting)

- 일반 온라인 포커 게임처럼 플레이어가 테이블을 둘러앉는 구조
- 최대 6개 좌석과 현재 플레이어 하단 배치
- 중앙 라운드/공개 상태, 우측 게임 정보, 하단 액션 바 구성
- 베팅 버튼은 UI 자리만 준비되며 v0.0.67에서는 비활성 상태
- 기존 v0.0.62 카드 분배·공개·승패 판정 기능 유지

## Bob Indian Poker (v0.0.62 Step 1)

- 경로: `#/indian-poker`
- 인원: 2~6명
- 현재 구현: 방 생성/입장, Ready, 52장 카드 분배, 상대 카드 표시, 카드 공개, A~2 승패 판정, 동점 공동 승리, 다음 라운드
- 미구현: 칩, Ante, Pot, Check/Bet/Call/Raise/Fold/All In, Main/Side Pot
- Client 모듈: `client/src/games/indian-poker`
- Server 모듈: `server/src/games/indian-poker`


## Bob Indian Poker v0.0.67

- 시작 Chips 선택: 1,000 / 3,000 / 5,000 / 10,000
- Ante 100, Pot, 보유 Chips, 현재 턴 표시
- Check, Bet 100/500/1000, Call
- 베팅 종료 후 자동 Showdown 및 Pot 지급
- 데스크톱 100% 배율에서 핵심 게임 화면을 한 화면에 배치
- Raise, Fold, All In, Main Pot, Side Pot은 후속 버전에서 추가


## BobPlatform v0.0.68 안정화

- 상대 플레이어의 칩 이동 애니메이션 직후 내 차례가 되었을 때 행동 버튼이 비활성화 상태로 남는 문제를 수정했습니다.
- 모든 행동 잠금 경로에서 해제 타이머를 예약하고, 잠금 종료 시 게임 화면을 다시 렌더링합니다.
- 게임 화면 진입 및 종료 시 남아 있는 행동 잠금 타이머를 초기화합니다.
