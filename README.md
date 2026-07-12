# BobPlatform v0.0.58

BobPlatform은 여러 개의 실시간 웹 게임을 하나의 게임 선택 로비에서 실행하는 멀티게임 플랫폼입니다.

현재 게임:

- BobArtist: 기존 v0.0.50 게임 흐름과 Socket 이벤트를 유지한 플레이 가능 모듈
- Yacht Dice: 독립 멀티플레이 로비와 서버 기반 Roll/Hold 플레이 단계 제공

## v0.0.58 핵심 원칙

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

안정성을 위해 BobArtist 서버 구현은 v0.0.58에서도 `server/src/index.ts`에 유지합니다. 향후 검증된 단계에서만 게임 모듈로 이동합니다.

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


## Yacht Dice v0.0.58 안정화

- 실제 주사위 눈 `⚀`~`⚅` 표시
- Roll 시 Hold하지 않은 주사위 흔들림 애니메이션
- Hold 및 Hold 해제 시 짧은 강조 애니메이션
- 레이아웃, 점수 규칙 및 Socket 구조는 v0.0.55와 동일


## Yacht Dice v0.0.58 범위

- 2~6명 멀티플레이 로비
- 방장 시작 및 참가자 Ready
- 서버 생성 주사위 5개와 Roll/Hold
- 클래식 13개 점수 카테고리
- 서버 점수 저장과 다음 플레이어 턴 순환
- 상단 보너스, 총점, 실시간 플레이어 순위
- 데스크톱 한 화면 배치와 작은 화면 반응형 레이아웃

게임 규칙과 Socket 상태 구조는 v0.0.54를 유지하며, v0.0.58는 화면 배치 안정화에 집중합니다.


## v0.0.58 다인 플레이 기준

- 최소 2명, 최대 6명
- 방장을 제외한 모든 참가자 Ready 시 시작
- 참가 인원 순서대로 턴 순환
- 모든 참가자가 13개 항목을 채우면 최종 점수와 공동 우승자를 계산합니다.

### 공통 방 채팅
BobArtist와 Yacht Dice는 `client/src/shared/chat`과 `server/src/shared/chat`의 동일한 채팅 모듈을 사용합니다. 채널은 `/chat/game/{gameId}/{roomCode}` 형식이며 DB 없이 서버 메모리에 방별 최근 100개 메시지만 보관합니다. 서버 재시작 시 채팅 기록은 초기화됩니다.
