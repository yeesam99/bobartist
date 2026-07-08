# BobArtist Test Guide

## v0.0.34 핵심 테스트

1. 방장 1명 + 참가자 1명 이상으로 방 입장
2. 모든 참가자가 READY 후 게임 시작 버튼 활성화 확인
3. 역할이 술래 1명, 나머지 도망자로 표시되는지 확인
4. 게임 화면 상단에 남은 시간이 표시되는지 확인
5. 술래가 제한시간 안에 원을 찾으면 술래 승 처리 확인
6. 제한시간이 끝나면 도망자 승 처리 확인

# TEST.md

## v0.0.34 로컬 테스트

### 1. 설치

```bash
npm install
npm run install:all
```

### 2. 통합 실행

```bash
npm run dev
```

확인:

- Server: http://localhost:3000/health
- Client: http://localhost:5173

### 3. 빌드

```bash
npm run build
```

성공 기준:

- server TypeScript build 성공
- client TypeScript/Vite build 성공

## Circle Render Fix 테스트

1. 어두운 이미지에서 원을 기본 흰색으로 둔다.
2. 원 가장자리에 회색/검은색 링처럼 보이는 잔상이 줄었는지 확인한다.
3. 원 내부를 스포이드 색상으로 칠한 뒤 가장자리가 깨지지 않는지 확인한다.
4. FIND 단계에서 술래 화면에 별도 가이드 테두리가 보이지 않는지 확인한다.
5. Zoom 50% / 100% / 200%에서 동일하게 확인한다.
6. Restart 후에도 동일하게 확인한다.

## 게임 기능 회귀 테스트

1. 브라우저 2개 접속
2. 방 생성
3. 방 입장
4. 참가자 Ready
5. 게임 시작
6. Artist 그림/원 숨기기
7. Reveal
8. Find
9. Focus Score 표시 확인
   - Artist: 실시간 통합 점수 표시
   - Spy: 10초마다 통합 점수 표시
10. Spotlight
11. Result
12. Restart
13. 술래가 다음 플레이어로 교대되는지 확인
14. 3회 이상 반복해도 Canvas/원/역할/점수가 꼬이지 않는지 확인

## Render 테스트

Render 배포 후:

```text
https://YOUR_RENDER_SERVICE.onrender.com/health
```

응답 예시:

```json
{ "ok": true, "version": "0.0.30" }
```

## Vercel 테스트

Vercel 환경변수:

```text
VITE_SERVER_URL=https://YOUR_RENDER_SERVICE.onrender.com
```

Vercel 접속 후 방 생성/입장/게임 시작까지 확인합니다.


## v0.0.32 Circle Edge Test

- In FIND, confirm the hidden circle no longer shows a thick white outer ring.
- Confirm the artist guide ring still only appears when explicitly toggled and never appears to the spy.
- Confirm zoom levels 50%, 100%, and 200% do not make the circle edge visibly thicker.
- Confirm Focus Score and round restart still work after the rendering change.
