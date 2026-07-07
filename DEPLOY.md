# BobArtist v0.0.31 배포 가이드

## 핵심 구조

```text
GitHub
├── server → Render
└── client → Vercel
```

DB는 사용하지 않습니다. 방 상태는 Render 서버 메모리에 저장됩니다.
Render 무료 플랜은 서버가 잠들 수 있으므로 첫 접속이 느릴 수 있습니다.

## 1. GitHub 반영

기존 프로젝트 폴더에서 v0.0.31 파일로 교체한 뒤:

```bash
git add .
git commit -m "v0.0.31 deployment stable"
git push
```

## 2. Render 서버 설정

Render > Web Service > bobartist 설정:

```text
Root Directory: server
Build Command: npm install --registry=https://registry.npmjs.org && npm run build
Start Command: npm start
```

Environment Variables:

```text
NODE_VERSION=22
NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
CLIENT_ORIGIN=*
```

처음 외부 테스트에서는 `CLIENT_ORIGIN=*`을 권장합니다.
Vercel 주소가 확정되면 아래처럼 제한할 수 있습니다.

```text
CLIENT_ORIGIN=https://your-bobartist-client.vercel.app
```

배포 후 확인:

```text
https://YOUR_RENDER_SERVICE.onrender.com/health
```

## 3. Vercel 클라이언트 설정

Vercel > Add New Project > GitHub repo 선택:

```text
Root Directory: client
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
```

Environment Variables:

```text
VITE_SERVER_URL=https://YOUR_RENDER_SERVICE.onrender.com
```

Vercel 배포 후 해당 URL을 친구에게 공유합니다.

## 4. 배포 후 테스트

1. Vercel URL 접속
2. 방 생성
3. 다른 브라우저/다른 사용자 입장
4. Ready
5. 게임 시작
6. Focus Score 확인
7. Result 후 Restart
8. 술래 교대 확인

## 5. Render에서 npm install이 멈출 때

아래가 설정되어 있는지 확인합니다.

```text
NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
```

Build Command도 아래처럼 공식 registry를 직접 지정합니다.

```bash
npm install --registry=https://registry.npmjs.org && npm run build
```

기존에 내부 registry가 들어간 package-lock이 올라가 있으면 삭제 후 커밋하세요.
