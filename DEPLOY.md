# BobPlatform v0.0.59 배포 가이드

## 배포 구조

```text
GitHub
├─ server → Render Web Service
└─ client → Vercel Project
```

v0.0.59은 기존 배포 Root Directory를 변경하지 않습니다.

## Render 서버

```text
Root Directory: server
Build Command: npm install --registry=https://registry.npmjs.org && npm run build
Start Command: npm start
```

환경변수:

```text
NODE_VERSION=22
NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
CLIENT_ORIGIN=https://YOUR_VERCEL_DOMAIN
```

초기 테스트에만 `CLIENT_ORIGIN=*`을 사용할 수 있습니다.

## Vercel 클라이언트

```text
Root Directory: client
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
```

환경변수:

```text
VITE_SERVER_URL=https://YOUR_RENDER_SERVICE.onrender.com
```

게임 선택은 Hash 경로를 사용하므로 `#/bobartist`, `#/yacht-dice` 새로고침이 Vercel 서버 경로로 전달되지 않습니다. 기존 `vercel.json` SPA rewrite도 유지합니다.

## 배포 후 확인

1. 기본 URL에서 BobPlatform 로비 표시
2. BobArtist 진입 후 방 생성과 입장
3. Yacht Dice 준비 화면 진입과 로비 복귀
4. Render `/health` 응답 버전 0.0.59
5. Vercel 클라이언트의 Socket 연결 주소와 CORS 확인


## 관리자 채팅 환경변수

Render 서버 환경변수에 `ADMIN_CHAT_PASSWORD`를 강한 비밀번호로 설정하세요. 설정하지 않으면 로컬 기본값 `bobadmin`이 사용되므로 운영 배포에서는 반드시 지정해야 합니다.
