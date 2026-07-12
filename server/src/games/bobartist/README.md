# BobArtist server module migration note

v0.0.57에서는 안정성을 위해 기존 BobArtist 서버 로직과 Socket 이벤트를 `server/src/index.ts`에 그대로 유지합니다.
검증 없이 이벤트명이나 방 상태 구조를 이동하지 않습니다.
