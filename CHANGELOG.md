# CHANGELOG

## v0.0.33 - Circle Render Engine

- 술래 REVEAL/FIND 화면에서 제출 원의 `baseColor` 원판을 그리지 않도록 분리
- 일반 렌더링과 술래 렌더링을 `drawHardClippedCircleImage` / `drawSpySafeCircleImage`로 분리
- 술래 렌더링은 외곽 알파를 안쪽으로 feather 처리하여 clip/drawImage 경계가 테두리처럼 보이지 않도록 수정
- 아티스트/결과 화면의 원 표시와 선택 결과 테두리는 유지
- 새 패키지 추가 없음

## v0.0.32 - Circle Render Edge Rollback

- Removed the same-color stroke added in v0.0.31 because it could make the hidden circle edge look thicker.
- Kept shadow/composite cleanup for stable Canvas rendering.
- Added pixel snapping for circle fill/clip positions to reduce edge shimmer without exposing a guide ring.
- The spy guide-ring prohibition remains unchanged.


## v0.0.32 - Circle Render Fix

- 원 가장자리의 희미한 테두리/잔상 완화
- Canvas 원 렌더링을 `fill + same-color stroke` 기반으로 정리
- `shadowBlur`, `shadowColor`, `globalCompositeOperation` 초기화로 잔상 가능성 축소
- 제출된 원 렌더링에도 동일한 기본 원 마감 처리 적용
- 술래 화면에서는 기존처럼 별도 가이드 테두리 표시 금지 유지
- 새 패키지 추가 없음

## v0.0.30 - Deployment Stable

- 새 게임 기능 추가 없음
- Render/Vercel 배포 안정화 구조로 정리
- root/client/server의 불필요한 `node_modules`, `dist`, `package-lock.json` 제거
- npm registry를 공식 npm registry로 고정하기 위한 `.npmrc` 추가
- Render build command를 공식 registry 사용 방식으로 정리
- `NODE_VERSION=22` 유지
- 루트 `npm run dev`로 server/client 동시 실행 유지
- `npm run build`로 server/client 빌드 확인 가능하도록 정리
- README / DEPLOY / TEST 갱신

## v0.0.29 - Deployment Ready

- Render/Vercel 배포 준비 파일 추가
- `/health` 서버 확인 API 추가
- 환경변수 예시 추가

## v0.0.28 - Focus Score UI Engine

- Focus Score를 그림 상단 한 줄로 이동
- 확대/축소 단축키를 Shift + Wheel로 변경
