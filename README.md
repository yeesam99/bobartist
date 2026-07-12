# BobPlatform v0.0.52

BobPlatform은 여러 개의 실시간 웹 게임을 하나의 게임 선택 로비에서 실행하는 멀티게임 플랫폼입니다.

현재 게임:

- BobArtist: 기존 v0.0.50 게임 흐름과 Socket 이벤트를 유지한 플레이 가능 모듈
- Yacht Dice: 독립 준비 화면까지만 제공하며 게임 로직은 아직 포함하지 않음

## v0.0.52 핵심 원칙

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

안정성을 위해 BobArtist 서버 구현은 v0.0.52에서도 `server/src/index.ts`에 유지합니다. 향후 검증된 단계에서만 게임 모듈로 이동합니다.

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
- `#/yacht-dice` : Yacht Dice 준비 화면

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
