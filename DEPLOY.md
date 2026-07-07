# BobArtist 배포 가이드 v0.0.29

## 배포 구조

```text
Client: Vercel
Server: Render
DB: 사용 안 함
State: Server Memory + localStorage
```

## 1. GitHub 업로드

프로젝트 루트 구조는 그대로 유지합니다.

```text
BobArtist/
├─ client/
├─ server/
├─ render.yaml
├─ README.md
├─ TEST.md
└─ CHANGELOG.md
```

## 2. Render 서버 배포

Render에서 `New Web Service`를 생성합니다.

수동 설정 시:

```text
Root Directory: server
Build Command: npm install && npm run build
Start Command: npm start
```

환경변수:

```text
NODE_VERSION=22
CLIENT_ORIGIN=https://배포된-client주소.vercel.app
```

초기 테스트 중 CORS 확인이 번거로우면 임시로 아래처럼 둘 수 있습니다.

```text
CLIENT_ORIGIN=*
```

Render 배포 후 서버 주소 예시:

```text
https://bobartist-server.onrender.com
```

브라우저에서 `/health` 접속 시 아래처럼 나오면 정상입니다.

```json
{ "ok": true, "version": "0.0.29" }
```

## 3. Vercel 클라이언트 배포

Vercel에서 GitHub 프로젝트를 Import합니다.

```text
Root Directory: client
Framework: Vite
Build Command: npm run build
Output Directory: dist
```

환경변수:

```text
VITE_SERVER_URL=https://배포된-render-server주소.onrender.com
```

예시:

```text
VITE_SERVER_URL=https://bobartist-server.onrender.com
```

## 4. 로컬 실행

로컬에서는 기존 방식 그대로 실행합니다.

```bash
npm run install:all
npm run dev
```

`client/.env`를 사용하려면 `client/.env.example`을 복사해서 만듭니다.

```bash
cp client/.env.example client/.env
```

## 5. 주의사항

- 서버는 DB를 사용하지 않으므로 Render 서버가 재시작되면 방 상태는 초기화됩니다.
- 무료 Render 서버는 일정 시간 미사용 시 sleep 상태가 될 수 있습니다.
- 외부 테스트 시 친구에게는 Vercel 클라이언트 주소만 공유하면 됩니다.
