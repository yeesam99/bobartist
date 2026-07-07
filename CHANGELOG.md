# CHANGELOG

## v0.0.29

### Added

- Render 배포용 `render.yaml` 추가
- Vercel 배포용 `client/vercel.json` 추가
- 배포 가이드 `DEPLOY.md` 추가
- 클라이언트 환경변수 예시 `client/.env.example` 추가
- 서버 환경변수 예시 `server/.env.example` 추가
- 서버 상태 확인용 `/health` API 추가
- 루트 `build:server`, `build:client` 스크립트 추가

### Changed

- 서버 버전 `0.0.29` 반영
- CORS origin을 `CLIENT_ORIGIN` 환경변수 기반으로 정리
- `CLIENT_ORIGIN`에 콤마 구분 여러 주소 또는 `*` 사용 가능
- README.md / TEST.md v0.0.29 기준 갱신

### Dependency

- 새 패키지 추가 없음

## v0.0.28

### Added

- Focus Score를 그림 상단 툴바에 한 줄로 표시하는 UI 구조 추가
- `Shift + Mouse Wheel` 확대/축소 단축키 적용
- `Shift + 0` 100% 복귀 단축키 적용

### Changed

- Focus Score 위치를 오른쪽 HUD 하단에서 `ARTWORK CANVAS` 상단으로 이동
- Focus Score는 색상/플레이어 나열이 아닌 통합 점수 1개로 표시
- 확대/축소 안내 문구를 `Shift + Wheel` 기준으로 변경

### Removed

- 오른쪽 HUD 하단 Focus Score 카드 표시 제거
