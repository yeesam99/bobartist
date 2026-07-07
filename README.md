# BobArtist v0.0.31

실시간 그림 숨바꼭질 게임 BobArtist입니다.

## 기술 스택

- Node.js 22
- Vite 8
- TypeScript 6
- Express
- Socket.IO
- HTML Canvas
- DB 사용 안 함
- localStorage + Server Memory

## v0.0.31 변경 목적

v0.0.31은 **Circle Render Fix** 버전입니다.
게임 중 원 가장자리에 희미한 테두리처럼 보이는 현상을 줄이기 위해 Canvas 원 렌더링 방식을 정리했습니다.

배포 구조는 v0.0.30 Deployment Stable 구조를 유지합니다.

## 로컬 실행

최초 1회:

```bash
npm install
npm run install:all
```

실행:

```bash
npm run dev
```

위 명령 하나로 서버와 클라이언트가 동시에 실행됩니다.

- Server: http://localhost:3000
- Client: http://localhost:5173

개별 실행도 가능합니다.

```bash
npm run dev:server
npm run dev:client
```

## 빌드 확인

```bash
npm run build
```

또는 개별 확인:

```bash
npm run build:server
npm run build:client
```

## 배포 구조

```text
GitHub Repository
├── server  → Render Web Service
└── client  → Vercel Project
```

### Render 서버

- Root Directory: `server`
- Build Command: `npm install --registry=https://registry.npmjs.org && npm run build`
- Start Command: `npm start`
- Environment Variables:
  - `NODE_VERSION=22`
  - `NPM_CONFIG_REGISTRY=https://registry.npmjs.org/`
  - `CLIENT_ORIGIN=*` initially

### Vercel 클라이언트

- Root Directory: `client`
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Environment Variable:
  - `VITE_SERVER_URL=https://YOUR_RENDER_SERVICE.onrender.com`

## npm install 필요 여부

v0.0.30은 package-lock과 node_modules를 정리한 배포 안정화 버전입니다.
새 ZIP으로 받은 경우 반드시 아래를 실행하세요.

```bash
npm install
npm run install:all
```

기존 프로젝트 위에 덮어쓴 경우에도 dependency 구조 확인을 위해 한 번 실행하는 것을 권장합니다.
