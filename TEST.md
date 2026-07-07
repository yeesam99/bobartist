# TEST v0.0.29

## 설치

기존 v0.0.28 설치 상태라면 새 패키지는 없으므로 `npm install`은 불필요합니다.
새 ZIP에서 처음 실행한다면 아래 명령을 실행합니다.

```bash
npm run install:all
```

## 실행

```bash
npm run dev
```

## 빌드 확인

```bash
npm run build:server
npm run build:client
```

## 로컬 기능 회귀 테스트

1. 방장이 이미지 업로드 후 방 생성
2. 참가자 입장
3. 참가자 Ready
4. 방장 게임 시작
5. DECORATE → SUBMIT → REVEAL → FIND → RESULT 진행
6. 다시 시작 후 술래 변경 확인

기대 결과:

- v0.0.28의 게임 흐름이 그대로 유지된다.
- Focus Score는 그림 상단 툴바에 통합 점수 1개로 표시된다.
- `Shift + Mouse Wheel` 확대/축소가 정상 동작한다.

## 서버 Health Check

서버 실행 후 브라우저에서 확인합니다.

```text
http://localhost:3000/health
```

기대 결과:

```json
{ "ok": true, "version": "0.0.29" }
```

## Render 배포 테스트

1. Render에 서버 배포
2. Render 환경변수 설정

```text
NODE_VERSION=22
CLIENT_ORIGIN=https://배포된-client주소.vercel.app
```

3. Render 서버 `/health` 접속

기대 결과:

- `{ "ok": true, "version": "0.0.29" }` 응답

## Vercel 배포 테스트

1. Vercel Root Directory를 `client`로 설정
2. 환경변수 설정

```text
VITE_SERVER_URL=https://배포된-render-server주소.onrender.com
```

3. Vercel 배포 주소 접속
4. 방 생성/입장 테스트

기대 결과:

- 외부 사용자가 Vercel 주소로 접속할 수 있다.
- Socket.IO가 Render 서버와 연결된다.
- 방 생성/입장/Ready/게임 시작이 정상 동작한다.

## 외부 테스트 체크리스트

- 친구에게는 Vercel 클라이언트 주소만 공유한다.
- 서버가 sleep 상태였다면 첫 접속이 느릴 수 있다.
- 방 상태는 서버 메모리이므로 서버 재시작 시 초기화된다.
