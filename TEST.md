# TEST.md

## v0.0.32 로컬 테스트

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


## v0.0.54 Yacht Dice Roll/Hold 테스트

1. 일반 창에서 Yacht Dice 방을 만들고 시크릿 창에서 입장합니다.
2. 참가자가 Ready 후 방장이 게임을 시작합니다.
3. 두 브라우저 모두 로비가 아닌 주사위 게임 화면으로 전환되는지 확인합니다.
4. 방장 화면에서만 첫 Roll 버튼이 활성화되는지 확인합니다.
5. 첫 Roll 시 1~6 값의 주사위 5개가 두 화면에 동일하게 표시되는지 확인합니다.
6. 주사위 1~2개를 Hold하고 두 번째 Roll을 실행합니다.
7. Hold 주사위 값은 유지되고 나머지만 변경되는지 확인합니다.
8. 관전자 화면에서도 Hold 표시와 Roll 횟수가 실시간으로 동일한지 확인합니다.
9. 세 번째 Roll 후 Roll 버튼과 Hold 조작이 비활성화되는지 확인합니다.
10. 관전자가 Roll/Hold를 시도할 수 없도록 버튼이 비활성화되는지 확인합니다.
11. Yacht Dice 방을 나간 뒤 BobArtist 방 생성·입장·Ready·게임 시작을 회귀 테스트합니다.

## v0.0.54 Yacht Dice 점수표·턴 순환 테스트

1. 2명 이상으로 Yacht Dice 게임을 시작합니다.
2. 현재 턴 플레이어가 최소 1회 Roll 하기 전에는 점수 항목을 선택할 수 없는지 확인합니다.
3. Roll 후 13개 카테고리에 예상 점수가 표시되는지 확인합니다.
4. 사용하지 않은 점수 항목을 선택하면 점수가 서버에 저장되는지 확인합니다.
5. 점수 저장 직후 다음 플레이어로 턴이 이동하는지 확인합니다.
6. 다음 턴의 주사위, Hold, Roll 횟수가 초기화되는지 확인합니다.
7. 이미 사용한 점수 항목을 다시 선택할 수 없는지 확인합니다.
8. 모든 브라우저에서 현재 턴과 플레이어별 총점이 동일하게 보이는지 확인합니다.
9. 상단 항목 합계가 63점 이상일 때 보너스 35점이 반영되는지 확인합니다.
10. 13개 항목이 모두 채워졌을 때 게임 종료와 승자가 표시되는지 확인합니다.
11. Yacht Dice 테스트 후 BobArtist 방 생성·입장·Ready·게임 시작을 회귀 테스트합니다.


## v0.0.55 Yacht Dice 한 화면 배치 테스트

1. 1920×1080, 1440×900, 1366×768 환경에서 Yacht Dice 게임 화면을 확인합니다.
2. 헤더, 주사위, Roll 버튼, 점수표, 총점, 플레이어 점수가 한 화면 안에 표시되는지 확인합니다.
3. 페이지 전체에 세로 스크롤이 생기지 않는지 확인합니다.
4. 플레이어 수가 늘어날 경우 우측 플레이어 점수 영역만 내부 스크롤되는지 확인합니다.
5. 점수표 13개 항목이 2열로 표시되고 선택 기능이 정상 동작하는지 확인합니다.
6. 브라우저 폭이 940px 이하일 때 세로형 반응형 배치로 전환되는지 확인합니다.
7. Roll, Hold, 점수 선택, 턴 이동 기능이 이전 버전과 동일하게 동작하는지 확인합니다.
8. BobArtist 게임 화면과 기존 기능을 회귀 테스트합니다.


## v0.0.56 Yacht Dice 주사위 표현 테스트

1. 첫 Roll 후 주사위가 숫자 대신 `⚀`부터 `⚅`까지의 주사위 눈으로 표시되는지 확인합니다.
2. Roll 버튼을 누를 때 Hold하지 않은 주사위만 짧게 흔들리는지 확인합니다.
3. Hold된 주사위는 다음 Roll 애니메이션에서 움직이지 않고 값도 유지되는지 확인합니다.
4. 주사위를 클릭해 Hold 또는 Hold 해제할 때 해당 주사위만 짧게 강조되는지 확인합니다.
5. 세 번째 Roll 이후 기존 점수 선택과 턴 이동이 정상 동작하는지 확인합니다.
6. 다른 플레이어 화면에서도 최종 주사위 값과 Hold 상태가 동일하게 동기화되는지 확인합니다.
7. BobArtist의 방 생성, 입장, Ready, 게임 시작을 회귀 테스트합니다.


## v0.0.58 Yacht Dice 클릭 안정성 및 다인 플레이 테스트

1. 첫 Roll 이후 주사위를 빠르게 여러 번 클릭해 Hold/Hold 해제가 누락되지 않는지 확인합니다.
2. Roll 시 주사위 흔들림 애니메이션이 없는지 확인합니다.
3. Hold/Hold 해제 시 확대·축소 또는 강조 애니메이션이 없는지 확인합니다.
4. 실제 주사위 눈 `⚀`~`⚅` 표시는 유지되는지 확인합니다.
5. 일반 창, 시크릿 창, 별도 브라우저를 사용해 3명 이상 입장합니다.
6. 최대 6명까지 입장할 수 있고 7번째 참가자는 차단되는지 확인합니다.
7. 방장을 제외한 모든 참가자가 Ready해야 시작 버튼이 활성화되는지 확인합니다.
8. 3명 이상에서 참가 순서대로 턴이 순환하는지 확인합니다.
9. 모든 참가자의 점수 저장과 Live Standings가 동기화되는지 확인합니다.
10. BobArtist 방 생성·입장·Ready·게임 시작을 회귀 테스트합니다.

## v0.0.58 공통 채팅 테스트
1. BobArtist 방에 브라우저 2개로 입장하고 우측 하단 채팅 버튼이 보이는지 확인한다.
2. 양쪽에서 메시지를 전송하고 같은 방에서만 실시간 수신되는지 확인한다.
3. Yacht Dice에서도 동일한 채팅 UI와 전송 기능이 동작하는지 확인한다.
4. 같은 방 코드라도 BobArtist와 Yacht Dice 채팅이 섞이지 않는지 확인한다.
5. 채팅 패널을 닫은 상태에서 새 메시지가 오면 미확인 개수가 표시되는지 확인한다.
6. 방을 나가면 채팅 패널과 현재 채널 정보가 사라지는지 확인한다.
7. 새 브라우저가 기존 방에 들어올 때 서버 메모리의 최근 메시지를 받는지 확인한다.
8. 200자를 넘는 메시지가 서버에서 잘리고 빠른 연속 전송이 제한되는지 확인한다.
9. BobArtist와 Yacht Dice의 기존 Ready, Start, 게임 진행 기능을 회귀 테스트한다.
