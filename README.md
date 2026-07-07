# BobArtist v0.0.29

v0.0.29는 `Deployment Ready` 버전입니다.

기존 v0.0.28 게임 기능은 유지하면서, Render 서버 배포와 Vercel 클라이언트 배포를 쉽게 하기 위한 설정 파일과 문서를 추가했습니다.

## 기술 스택

- Node.js 22
- Vite 8
- TypeScript 6
- Express
- Socket.IO
- HTML Canvas
- DB 사용 안 함
- localStorage + Server Memory

## 실행 방법

처음 받은 ZIP이라면 의존성 설치가 필요합니다.

```bash
npm run install:all
```

서버/클라이언트 동시 실행:

```bash
npm run dev
```

개별 실행:

```bash
npm run dev:server
npm run dev:client
```

## 빌드

```bash
npm run build:server
npm run build:client
```

## 배포

배포 가이드는 `DEPLOY.md`를 확인합니다.

요약:

```text
Server → Render
Client → Vercel
```

추가된 파일:

```text
render.yaml
client/vercel.json
client/.env.example
server/.env.example
DEPLOY.md
```

## v0.0.29 변경 사항

- Render 배포용 `render.yaml` 추가
- Vercel 배포용 `client/vercel.json` 추가
- 서버 `/health` 확인 API 추가
- 서버 CORS 설정을 `CLIENT_ORIGIN` 환경변수 기반으로 정리
- 클라이언트 서버 주소 설정 예시 `client/.env.example` 추가
- 서버 환경변수 예시 `server/.env.example` 추가
- 배포 가이드 `DEPLOY.md` 추가
- 새 패키지 추가 없음

## 게임 흐름

```text
LOBBY
↓
READY
↓
GAME START
↓
DECORATE
↓
SUBMIT
↓
REVEAL
↓
FIND
↓
RESULT
↓
RESTART
↓
ROLE ROTATION
↓
DECORATE
```

## 주의

BobArtist는 DB를 사용하지 않습니다. Render 서버가 재시작되면 방 상태는 초기화됩니다.
