import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { registerYachtDice } from "./games/yacht-dice";
import { registerSharedChat } from "./shared/chat";

// BobPlatform v0.0.58 / BobArtist legacy module
// DB 사용 없음: 방 상태와 업로드 이미지는 서버 메모리에만 저장합니다.

type RoomState = "lobby" | "playing" | "ended";
type GamePhase =
  | "loading"
  | "role_assignment"
  | "decorate"
  | "submit"
  | "reveal"
  | "find"
  | "result";
type PlayerRole = "artist" | "spy";

type Player = {
  socketId: string;
  name: string;
  ready: boolean;
  role: PlayerRole | null;
  submitted: boolean;
  joinedAt: number;
};

type Artwork = {
  imageId: string;
  imageUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type CharacterSnapshot = {
  xRatio: number;
  yRatio: number;
  radiusRatio: number;
  baseColor: string;
};

const RUNNER_CIRCLE_MIN_SIZE = 50;
const RUNNER_CIRCLE_MAX_SIZE = 150;
const RUNNER_CIRCLE_MIN_RADIUS = RUNNER_CIRCLE_MIN_SIZE / 2;
const RUNNER_CIRCLE_MAX_RADIUS = RUNNER_CIRCLE_MAX_SIZE / 2;

type ArtworkSubmission = {
  playerId: string;
  playerName: string;
  character: CharacterSnapshot;
  paintDataUrl: string;
  submittedAt: number;
};

type FindResult = {
  selectedTargetId: string | null;
  success: boolean;
  message: string;
};

type FocusPointer = {
  xRatio: number;
  yRatio: number;
  canvasWidth: number;
  canvasHeight: number;
  updatedAt: number;
};

type FocusScoreItem = {
  playerId: string;
  playerName: string;
  score: number;
};

type SurvivalRankingItem = {
  playerId: string;
  playerName: string;
  rank: number;
  survivalMs: number;
  circleSizePx: number;
  sizeBonusMs: number;
  score: number;
};

type GameRound = {
  round: number;
  phase: GamePhase;
  startedAt: number;
  phaseStartedAt: number;
  artwork: Artwork;
};

type GameSettings = {
  decorateDurationMs: number;
  findDurationMs: number;
};

type Room = {
  code: string;
  hostSocketId: string;
  state: RoomState;
  players: Player[];
  artwork: Artwork;
  settings: GameSettings;
  game: GameRound | null;
  submissions: Record<string, ArtworkSubmission>;
  caughtTargetIds: string[];
  caughtAtByTargetId: Record<string, number>;
  selectedTargetId: string | null;
  result: FindResult | null;
  resultRankings: SurvivalRankingItem[];
  focusScores: Record<string, number>;
  focusPointer: FocusPointer | null;
  lastSpyFocusSnapshotAt: number;
  currentSpyIndex: number;
  createdAt: number;
  updatedAt: number;
};

type ImageStoreItem = {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  createdAt: number;
};

type ClientRoomRequest = {
  roomCode?: string;
  playerName?: string;
};

type CreateRoomRequest = ClientRoomRequest & {
  settings?: Partial<GameSettings>;
  artwork?: {
    dataUrl?: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  };
};

type PublicRoom = {
  code: string;
  state: RoomState;
  canStart: boolean;
  playerCount: number;
  maxPlayers: number;
  players: Array<{
    id: string;
    name: string;
    ready: boolean;
    isHost: boolean;
    role: PlayerRole | null;
    submitted: boolean;
  }>;
  artwork: Artwork;
  settings: GameSettings;
  game: null | {
    round: number;
    phase: GamePhase;
    startedAt: number;
    phaseStartedAt: number;
    artwork: Artwork;
    submissions: Array<ArtworkSubmission & { caught: boolean }>;
    caughtTargetIds: string[];
    selectedTargetId: string | null;
    result: FindResult | null;
    resultRankings: SurvivalRankingItem[];
  };
  createdAt: number;
  updatedAt: number;
};

const VERSION = "0.0.58";
const DEFAULT_DECORATE_DURATION_MS = 60 * 1000;
const DEFAULT_FIND_DURATION_MS = 5 * 60 * 1000;
const ALLOWED_DECORATE_DURATION_MS = new Set([
  60 * 1000,
  2 * 60 * 1000,
  3 * 60 * 1000,
]);
const ALLOWED_FIND_DURATION_MS = new Set([
  3 * 60 * 1000,
  5 * 60 * 1000,
  7 * 60 * 1000,
]);
const PORT = Number(process.env.PORT || 3000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const CLIENT_ORIGINS =
  CLIENT_ORIGIN === "*"
    ? "*"
    : CLIENT_ORIGIN.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;

const AUTO_SUBMIT_GRACE_MS = 900;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ROLE_ASSIGN_DELAY_MS = 900;
const REVEAL_TO_FIND_DELAY_MS = 2000;
const FOCUS_SCORE_TICK_MS = 1000;
const FOCUS_RADIUS_PX = 170;
const FOCUS_MAX_SCORE_PER_TICK = 10;
const SPY_FOCUS_SNAPSHOT_MS = 5000;
const MAX_SIZE_BONUS_MS = 12 * 1000;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
]);
const BLANK_WHITE_PAINT_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAIAAAD7GkOtAAAACXBIWXMAAAsTAAALEwEAmpwYAAAHHElEQVR4nO3BMQEAAADCoPVPbQdvoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMBVrgABu0Xl6wAAAABJRU5ErkJggg==";

const app = express();
app.use(cors({ origin: CLIENT_ORIGINS }));
app.use(express.json({ limit: "8mb" }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "BobPlatform Server",
    version: VERSION,
    rooms: rooms.size,
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, version: VERSION });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGINS,
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 8 * 1024 * 1024,
});

const rooms = new Map<string, Room>();
const images = new Map<string, ImageStoreItem>();

function normalizeName(name?: string): string {
  const value = (name || "").trim();
  return value.length > 0 ? value.slice(0, 16) : "익명";
}

function normalizeRoomCode(roomCode?: string): string {
  return (roomCode || "")
    .trim()
    .replace(/[^0-9]/g, "")
    .slice(0, 6);
}

function generateRoomCode(): string {
  for (let tryCount = 0; tryCount < 100; tryCount += 1) {
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    if (!rooms.has(code)) return code;
  }
  throw new Error("방 코드 생성에 실패했습니다.");
}

function generateImageId(): string {
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeGameSettings(value?: Partial<GameSettings>): GameSettings {
  const decorateDurationMs = Number(value?.decorateDurationMs);
  const findDurationMs = Number(value?.findDurationMs);
  return {
    decorateDurationMs: ALLOWED_DECORATE_DURATION_MS.has(decorateDurationMs)
      ? decorateDurationMs
      : DEFAULT_DECORATE_DURATION_MS,
    findDurationMs: ALLOWED_FIND_DURATION_MS.has(findDurationMs)
      ? findDurationMs
      : DEFAULT_FIND_DURATION_MS,
  };
}

function formatMinutes(ms: number): string {
  return `${Math.round(ms / 60000)}분`;
}

function parseArtwork(payload?: CreateRoomRequest["artwork"]): Artwork {
  if (!payload?.dataUrl) {
    throw new Error("방을 만들려면 원본 이미지가 필요합니다.");
  }

  const mimeType = (payload.mimeType || "").toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error("PNG, JPG, JPEG 이미지만 사용할 수 있습니다.");
  }

  const match = payload.dataUrl.match(
    /^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i,
  );
  if (!match) {
    throw new Error("이미지 데이터 형식이 올바르지 않습니다.");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length <= 0) {
    throw new Error("이미지 파일을 읽을 수 없습니다.");
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("이미지는 최대 5MB까지만 사용할 수 있습니다.");
  }

  const imageId = generateImageId();
  const fileName = (payload.fileName || "artwork").slice(0, 120);
  images.set(imageId, {
    buffer,
    mimeType,
    fileName,
    sizeBytes: buffer.length,
    createdAt: Date.now(),
  });

  return {
    imageId,
    imageUrl: `/images/${imageId}`,
    fileName,
    mimeType,
    sizeBytes: buffer.length,
  };
}

function canStartGame(room: Room): boolean {
  return (
    room.state === "lobby" &&
    room.players.length >= MIN_PLAYERS &&
    room.players.length <= MAX_PLAYERS &&
    room.players
      .filter((player) => player.socketId !== room.hostSocketId)
      .every((player) => player.ready)
  );
}

function normalizeSpyIndex(room: Room): void {
  if (room.players.length <= 0) {
    room.currentSpyIndex = 0;
    return;
  }
  room.currentSpyIndex =
    ((room.currentSpyIndex % room.players.length) + room.players.length) %
    room.players.length;
}

function setRandomSpy(room: Room): void {
  if (room.players.length <= 0) {
    room.currentSpyIndex = 0;
    return;
  }
  room.currentSpyIndex = Math.floor(Math.random() * room.players.length);
}

function assignRoles(room: Room): void {
  normalizeSpyIndex(room);
  room.players = room.players.map((player, index) => {
    const isSpy = index === room.currentSpyIndex;
    return {
      ...player,
      role: isSpy ? "spy" : "artist",
      submitted: isSpy,
    };
  });
  room.submissions = {};
  room.caughtTargetIds = [];
  room.caughtAtByTargetId = {};
  room.selectedTargetId = null;
  room.result = null;
  room.resultRankings = [];
  room.focusScores = {};
  room.focusPointer = null;
  room.lastSpyFocusSnapshotAt = 0;
}

function rotateSpy(room: Room): void {
  if (room.players.length <= 0) {
    room.currentSpyIndex = 0;
    return;
  }
  room.currentSpyIndex = (room.currentSpyIndex + 1) % room.players.length;
}

function setGamePhase(room: Room, phase: GamePhase): void {
  if (!room.game) return;
  room.game.phase = phase;
  room.game.phaseStartedAt = Date.now();
  room.updatedAt = Date.now();
  if (phase !== "find") {
    room.focusPointer = null;
  } else {
    room.lastSpyFocusSnapshotAt = Date.now();
    emitArtistFocusScores(room);
    scheduleFindTimeout(room.code, room.game.round, room.game.phaseStartedAt);
  }
  if (phase === "decorate") {
    scheduleDecorateTimeout(
      room.code,
      room.game.round,
      room.game.phaseStartedAt,
    );
  }
  emitRoomState(room);
}

function scheduleFindPhase(roomCode: string): void {
  setTimeout(() => {
    const latestRoom = rooms.get(roomCode);
    if (
      !latestRoom ||
      latestRoom.state !== "playing" ||
      latestRoom.game?.phase !== "reveal"
    )
      return;
    setGamePhase(latestRoom, "find");
  }, REVEAL_TO_FIND_DELAY_MS);
}

function ensureMissingRunnerSubmissions(room: Room): void {
  if (!room.game) return;
  const now = Date.now();
  room.players
    .filter((player) => player.role === "artist")
    .forEach((player, index) => {
      if (room.submissions[player.socketId]) return;
      const runnerIndex = index + 1;
      room.submissions[player.socketId] = {
        playerId: player.socketId,
        playerName: player.name,
        character: {
          xRatio: Math.min(0.86, 0.26 + runnerIndex * 0.12),
          yRatio: Math.min(0.78, 0.3 + (runnerIndex % 4) * 0.12),
          radiusRatio: 0.08,
          baseColor: "#FFFFFF",
        },
        paintDataUrl: BLANK_WHITE_PAINT_DATA_URL,
        submittedAt: now,
      };
      player.submitted = true;
    });
}

function finishDecorateTimeout(
  roomCode: string,
  round: number,
  phaseStartedAt: number,
): void {
  const latestRoom = rooms.get(roomCode);
  if (!latestRoom || latestRoom.state !== "playing" || !latestRoom.game) return;
  if (
    latestRoom.game.round !== round ||
    latestRoom.game.phaseStartedAt !== phaseStartedAt
  )
    return;
  if (
    latestRoom.game.phase !== "decorate" &&
    latestRoom.game.phase !== "submit"
  )
    return;

  ensureMissingRunnerSubmissions(latestRoom);
  latestRoom.game.phase = "reveal";
  latestRoom.game.phaseStartedAt = Date.now();
  latestRoom.updatedAt = Date.now();
  emitRoomState(latestRoom);
  scheduleFindPhase(latestRoom.code);
}

function scheduleDecorateTimeout(
  roomCode: string,
  round: number,
  phaseStartedAt: number,
): void {
  const initialRoom = rooms.get(roomCode);
  const delayMs =
    initialRoom?.settings.decorateDurationMs ?? DEFAULT_DECORATE_DURATION_MS;
  setTimeout(() => {
    const latestRoom = rooms.get(roomCode);
    if (!latestRoom || latestRoom.state !== "playing" || !latestRoom.game)
      return;
    if (
      latestRoom.game.round !== round ||
      latestRoom.game.phaseStartedAt !== phaseStartedAt
    )
      return;
    if (
      latestRoom.game.phase !== "decorate" &&
      latestRoom.game.phase !== "submit"
    )
      return;

    // 시간 종료 순간 서버가 바로 기본 흰 원을 생성하면,
    // 클라이언트가 가진 실제 위치/그림 스냅샷이 반영되지 않아 다음 단계에서 원이 엉뚱하게 보일 수 있습니다.
    // 먼저 모든 도망자 클라이언트에 자동 제출을 요청하고, 짧은 유예 뒤에도 누락된 인원만 서버 기본값으로 보정합니다.
    if (latestRoom.game.phase === "decorate") {
      latestRoom.game.phase = "submit";
      latestRoom.updatedAt = Date.now();
      emitRoomState(latestRoom);
    }

    io.to(latestRoom.code).emit("auto_submit_required", {
      round,
      deadlineAt: Date.now() + AUTO_SUBMIT_GRACE_MS,
    });

    setTimeout(
      () => finishDecorateTimeout(roomCode, round, phaseStartedAt),
      AUTO_SUBMIT_GRACE_MS,
    );
  }, delayMs);
}

function scheduleFindTimeout(
  roomCode: string,
  round: number,
  phaseStartedAt: number,
): void {
  const initialRoom = rooms.get(roomCode);
  const delayMs =
    initialRoom?.settings.findDurationMs ?? DEFAULT_FIND_DURATION_MS;
  setTimeout(() => {
    const latestRoom = rooms.get(roomCode);
    if (!latestRoom || latestRoom.state !== "playing" || !latestRoom.game)
      return;
    if (
      latestRoom.game.round !== round ||
      latestRoom.game.phaseStartedAt !== phaseStartedAt
    )
      return;
    if (latestRoom.game.phase !== "find") return;

    const endedAt = Date.now();
    latestRoom.selectedTargetId = null;
    latestRoom.resultRankings = computeSurvivalRankings(latestRoom, endedAt);
    latestRoom.result = {
      selectedTargetId: null,
      success: false,
      message: `찾기 시간 ${formatMinutes(latestRoom.settings.findDurationMs)} 종료. 도망자 승리!`,
    };
    latestRoom.game.phase = "result";
    latestRoom.game.phaseStartedAt = endedAt;
    latestRoom.updatedAt = Date.now();
    emitRoomState(latestRoom);
  }, delayMs);
}

function toPublicRoom(room: Room): PublicRoom {
  return {
    code: room.code,
    state: room.state,
    canStart: canStartGame(room),
    playerCount: room.players.length,
    maxPlayers: MAX_PLAYERS,
    players: room.players.map((player) => ({
      id: player.socketId,
      name: player.name,
      ready: player.ready,
      isHost: player.socketId === room.hostSocketId,
      role: player.role,
      submitted: player.submitted,
    })),
    artwork: room.artwork,
    settings: room.settings,
    game: room.game
      ? {
          round: room.game.round,
          phase: room.game.phase,
          startedAt: room.game.startedAt,
          phaseStartedAt: room.game.phaseStartedAt,
          artwork: room.game.artwork,
          submissions: Object.values(room.submissions).map((submission) => ({
            ...submission,
            caught: room.caughtTargetIds.includes(submission.playerId),
          })),
          caughtTargetIds: [...room.caughtTargetIds],
          selectedTargetId: room.selectedTargetId,
          result: room.result,
        resultRankings: [...room.resultRankings],
        }
      : null,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

function emitRoomState(room: Room): void {
  io.to(room.code).emit("room_state", toPublicRoom(room));
}

function findJoinedRoom(socket: Socket): Room | null {
  for (const room of rooms.values()) {
    if (room.players.some((player) => player.socketId === socket.id))
      return room;
  }
  return null;
}

function deleteRoomAndImage(code: string, room: Room): void {
  rooms.delete(code);
  images.delete(room.artwork.imageId);
}

function leaveJoinedRooms(socket: Socket): void {
  for (const [code, room] of rooms.entries()) {
    const beforeCount = room.players.length;
    room.players = room.players.filter(
      (player) => player.socketId !== socket.id,
    );

    if (beforeCount === room.players.length) continue;

    socket.leave(code);

    if (room.players.length === 0) {
      deleteRoomAndImage(code, room);
      continue;
    }

    if (room.hostSocketId === socket.id) {
      room.hostSocketId = room.players[0].socketId;
    }

    normalizeSpyIndex(room);

    if (room.state !== "lobby") {
      room.state = "lobby";
      room.game = null;
      room.submissions = {};
      room.caughtTargetIds = [];
      room.caughtAtByTargetId = {};
      room.selectedTargetId = null;
      room.result = null;
      room.resultRankings = [];
      room.focusScores = {};
      room.focusPointer = null;
      room.lastSpyFocusSnapshotAt = 0;
    }

    room.players = room.players.map((player) => ({
      ...player,
      ready: false,
      role: null,
      submitted: false,
    }));
    room.updatedAt = Date.now();
    emitRoomState(room);
  }
}

function joinRoom(socket: Socket, payload: ClientRoomRequest): void {
  const roomCode = normalizeRoomCode(payload.roomCode);
  const playerName = normalizeName(payload.playerName);

  if (roomCode.length !== 6) {
    socket.emit("room_error", { message: "6자리 방 코드를 입력해 주세요." });
    return;
  }

  const room = rooms.get(roomCode);
  if (!room) {
    socket.emit("room_error", { message: "존재하지 않는 방입니다." });
    return;
  }

  if (room.state !== "lobby") {
    socket.emit("room_error", { message: "이미 게임이 시작된 방입니다." });
    return;
  }

  const alreadyJoined = room.players.some(
    (player) => player.socketId === socket.id,
  );
  if (!alreadyJoined && room.players.length >= MAX_PLAYERS) {
    socket.emit("room_error", {
      message: "방이 가득 찼습니다. 최대 8명까지 입장할 수 있습니다.",
    });
    return;
  }

  leaveJoinedRooms(socket);
  socket.join(room.code);

  const currentPlayer = room.players.find(
    (player) => player.socketId === socket.id,
  );
  if (currentPlayer) {
    currentPlayer.name = playerName;
  } else {
    room.players.push({
      socketId: socket.id,
      name: playerName,
      ready: false,
      role: null,
      submitted: false,
      joinedAt: Date.now(),
    });
  }

  room.updatedAt = Date.now();
  socket.emit("room_joined", toPublicRoom(room));
  emitRoomState(room);
}

function toggleReady(socket: Socket): void {
  const room = findJoinedRoom(socket);
  if (!room) {
    socket.emit("room_error", { message: "먼저 방에 입장해 주세요." });
    return;
  }

  if (room.state !== "lobby") {
    socket.emit("room_error", {
      message: "게임 시작 후에는 준비 상태를 바꿀 수 없습니다.",
    });
    return;
  }

  const player = room.players.find((item) => item.socketId === socket.id);
  if (!player) return;

  if (player.socketId === room.hostSocketId) {
    player.ready = true;
    socket.emit("room_error", {
      message: "방장은 술래 역할이므로 준비 버튼 없이 시작 조건을 관리합니다.",
    });
    emitRoomState(room);
    return;
  }

  player.ready = !player.ready;
  room.updatedAt = Date.now();
  emitRoomState(room);
}

function startGame(socket: Socket): void {
  const room = findJoinedRoom(socket);
  if (!room) {
    socket.emit("room_error", { message: "먼저 방에 입장해 주세요." });
    return;
  }

  if (room.hostSocketId !== socket.id) {
    socket.emit("room_error", { message: "방장만 게임을 시작할 수 있습니다." });
    return;
  }

  if (!canStartGame(room)) {
    socket.emit("room_error", {
      message:
        "최소 2명 이상 필요하며, 모든 도망자가 READY 상태여야 게임을 시작할 수 있습니다.",
    });
    return;
  }

  const now = Date.now();
  setRandomSpy(room);
  assignRoles(room);
  room.state = "playing";
  room.game = {
    round: 1,
    phase: "role_assignment",
    artwork: room.artwork,
    startedAt: now,
    phaseStartedAt: now,
  };
  room.updatedAt = now;

  emitRoomState(room);
  io.to(room.code).emit("game_started", toPublicRoom(room));

  setTimeout(() => {
    const latestRoom = rooms.get(room.code);
    if (
      !latestRoom ||
      latestRoom.state !== "playing" ||
      latestRoom.game?.phase !== "role_assignment"
    )
      return;
    setGamePhase(latestRoom, "decorate");
  }, ROLE_ASSIGN_DELAY_MS);
}

function normalizeSnapshot(
  value: unknown,
  canvasWidth?: unknown,
  canvasHeight?: unknown,
): CharacterSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<CharacterSnapshot>;
  const xRatio = Number(item.xRatio);
  const yRatio = Number(item.yRatio);
  const radiusRatio = Number(item.radiusRatio);
  if (
    !Number.isFinite(xRatio) ||
    !Number.isFinite(yRatio) ||
    !Number.isFinite(radiusRatio)
  )
    return null;
  const width = Number(canvasWidth);
  const height = Number(canvasHeight);
  const minCanvasSize =
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
      ? Math.min(width, height)
      : 500;
  const minRadiusRatio = RUNNER_CIRCLE_MIN_RADIUS / minCanvasSize;
  const maxRadiusRatio = RUNNER_CIRCLE_MAX_RADIUS / minCanvasSize;

  return {
    xRatio: Math.min(1, Math.max(0, xRatio)),
    yRatio: Math.min(1, Math.max(0, yRatio)),
    radiusRatio: Math.min(maxRadiusRatio, Math.max(minRadiusRatio, radiusRatio)),
    baseColor:
      typeof item.baseColor === "string"
        ? item.baseColor.slice(0, 32)
        : "#FFFFFF",
  };
}

function submitArtwork(
  socket: Socket,
  payload: {
    character?: unknown;
    canvasWidth?: unknown;
    canvasHeight?: unknown;
    paintDataUrl?: string;
  } = {},
): void {
  const room = findJoinedRoom(socket);
  if (!room || room.state !== "playing" || !room.game) {
    socket.emit("room_error", { message: "진행 중인 게임이 없습니다." });
    return;
  }

  if (room.game.phase !== "decorate" && room.game.phase !== "submit") {
    socket.emit("room_error", {
      message: "현재 단계에서는 제출할 수 없습니다.",
    });
    return;
  }

  const player = room.players.find((item) => item.socketId === socket.id);
  if (!player) return;

  if (player.role === "artist") {
    const character = normalizeSnapshot(
      payload.character,
      payload.canvasWidth,
      payload.canvasHeight,
    );
    const paintDataUrl =
      typeof payload.paintDataUrl === "string" ? payload.paintDataUrl : "";
    if (!character || !paintDataUrl.startsWith("data:image/png;base64,")) {
      socket.emit("room_error", {
        message: "아티스트 제출 데이터가 올바르지 않습니다.",
      });
      return;
    }
    room.submissions[player.socketId] = {
      playerId: player.socketId,
      playerName: player.name,
      character,
      paintDataUrl,
      submittedAt: Date.now(),
    };
  }

  player.submitted = true;
  if (room.game.phase === "decorate") {
    // Keep phaseStartedAt from DECORATE so submitting early does not extend the 1-minute drawing timer.
    room.game.phase = "submit";
  }

  if (room.players.every((item) => item.submitted)) {
    room.game.phase = "reveal";
    room.game.phaseStartedAt = Date.now();
    scheduleFindPhase(room.code);
  }

  room.updatedAt = Date.now();
  emitRoomState(room);
}

function getRunnerIds(room: Room): string[] {
  return room.players
    .filter((player) => player.role === "artist")
    .map((player) => player.socketId);
}

function getCaughtRunnerCount(room: Room): number {
  const runnerIds = new Set(getRunnerIds(room));
  return room.caughtTargetIds.filter((id) => runnerIds.has(id)).length;
}

function areAllRunnersCaught(room: Room): boolean {
  const runnerIds = getRunnerIds(room);
  return (
    runnerIds.length > 0 &&
    runnerIds.every((id) => room.caughtTargetIds.includes(id))
  );
}

function findTarget(socket: Socket, payload: { targetId?: string } = {}): void {
  const room = findJoinedRoom(socket);
  if (!room || room.state !== "playing" || !room.game) {
    socket.emit("room_error", { message: "진행 중인 게임이 없습니다." });
    return;
  }
  const player = room.players.find((item) => item.socketId === socket.id);
  if (!player || player.role !== "spy") {
    socket.emit("room_error", { message: "술래만 원을 선택할 수 있습니다." });
    return;
  }
  if (room.game.phase !== "find") {
    socket.emit("room_error", {
      message: "현재 단계에서는 찾기를 할 수 없습니다.",
    });
    return;
  }
  const targetId =
    typeof payload.targetId === "string" && room.submissions[payload.targetId]
      ? payload.targetId
      : null;
  if (!targetId) {
    socket.emit("room_error", {
      message: "선택할 수 있는 원을 클릭해 주세요.",
    });
    return;
  }
  if (room.caughtTargetIds.includes(targetId)) {
    socket.emit("room_error", {
      message: "이미 잡힌 도망자입니다. 다른 원을 찾아주세요.",
    });
    return;
  }

  const target = room.players.find((item) => item.socketId === targetId);
  if (!target || target.role !== "artist") {
    socket.emit("room_error", { message: "도망자 원만 잡을 수 있습니다." });
    return;
  }

  const caughtAt = Date.now();
  room.selectedTargetId = targetId;
  room.caughtTargetIds.push(targetId);
  room.caughtAtByTargetId[targetId] = caughtAt;

  if (areAllRunnersCaught(room)) {
    room.resultRankings = computeSurvivalRankings(room, caughtAt);
    room.result = {
      selectedTargetId: targetId,
      success: true,
      message: `도망자 ${getCaughtRunnerCount(room)}명을 모두 잡았습니다. 술래 승리!`,
    };
    room.game.phase = "result";
    room.game.phaseStartedAt = caughtAt;
  } else {
    room.result = null;
  }

  room.updatedAt = Date.now();
  emitRoomState(room);
}

function confirmFind(socket: Socket): void {
  const room = findJoinedRoom(socket);
  if (!room || room.state !== "playing" || !room.game) {
    socket.emit("room_error", { message: "진행 중인 게임이 없습니다." });
    return;
  }
  const player = room.players.find((item) => item.socketId === socket.id);
  if (!player || player.role !== "spy") {
    socket.emit("room_error", { message: "술래만 결과를 확정할 수 있습니다." });
    return;
  }
  socket.emit("room_error", {
    message:
      "이제 원을 클릭하면 즉시 잡힘 처리됩니다. 모든 도망자를 잡으면 게임이 종료됩니다.",
  });
}

function updateGameSettings(
  socket: Socket,
  payload: Partial<GameSettings> = {},
): void {
  const room = findJoinedRoom(socket);
  if (!room) {
    socket.emit("room_error", { message: "먼저 방에 입장해 주세요." });
    return;
  }
  if (room.hostSocketId !== socket.id) {
    socket.emit("room_error", {
      message: "방장만 게임 시간을 변경할 수 있습니다.",
    });
    return;
  }
  if (room.state !== "lobby") {
    socket.emit("room_error", {
      message: "게임 시간은 로비에서만 변경할 수 있습니다.",
    });
    return;
  }
  room.settings = normalizeGameSettings(payload);
  room.updatedAt = Date.now();
  emitRoomState(room);
}

function restartGame(socket: Socket): void {
  const room = findJoinedRoom(socket);
  if (!room || !room.game) {
    socket.emit("room_error", { message: "다시 시작할 게임이 없습니다." });
    return;
  }

  if (room.hostSocketId !== socket.id) {
    socket.emit("room_error", { message: "방장만 다시 시작할 수 있습니다." });
    return;
  }

  if (room.game.phase !== "result") {
    socket.emit("room_error", {
      message: "RESULT 단계에서만 다시 시작할 수 있습니다.",
    });
    return;
  }

  const now = Date.now();
  const nextRound = room.game.round + 1;
  rotateSpy(room);
  assignRoles(room);
  room.state = "playing";
  room.game = {
    round: nextRound,
    phase: "role_assignment",
    artwork: room.artwork,
    startedAt: now,
    phaseStartedAt: now,
  };
  room.updatedAt = now;

  emitRoomState(room);
  io.to(room.code).emit("game_restarted", toPublicRoom(room));

  setTimeout(() => {
    const latestRoom = rooms.get(room.code);
    if (
      !latestRoom ||
      latestRoom.state !== "playing" ||
      latestRoom.game?.round !== nextRound ||
      latestRoom.game.phase !== "role_assignment"
    )
      return;
    setGamePhase(latestRoom, "decorate");
  }, ROLE_ASSIGN_DELAY_MS);
}

function updateFocusPointer(
  socket: Socket,
  payload: {
    xRatio?: number;
    yRatio?: number;
    canvasWidth?: number;
    canvasHeight?: number;
  } = {},
): void {
  const room = findJoinedRoom(socket);
  if (!room || room.state !== "playing" || room.game?.phase !== "find") return;

  const player = room.players.find((item) => item.socketId === socket.id);
  if (!player || player.role !== "spy") return;

  const xRatio = Number(payload.xRatio);
  const yRatio = Number(payload.yRatio);
  const canvasWidth = Number(payload.canvasWidth);
  const canvasHeight = Number(payload.canvasHeight);

  if (
    !Number.isFinite(xRatio) ||
    !Number.isFinite(yRatio) ||
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight)
  )
    return;
  if (canvasWidth <= 0 || canvasHeight <= 0) return;

  room.focusPointer = {
    xRatio: Math.min(1, Math.max(0, xRatio)),
    yRatio: Math.min(1, Math.max(0, yRatio)),
    canvasWidth: Math.min(5000, Math.max(1, canvasWidth)),
    canvasHeight: Math.min(5000, Math.max(1, canvasHeight)),
    updatedAt: Date.now(),
  };
}

function getSubmissionCircleSizePx(submission: ArtworkSubmission): number {
  const fallbackCanvasSize = 760;
  const rawSize = submission.character.radiusRatio * fallbackCanvasSize * 2;
  return Math.round(
    Math.min(
      RUNNER_CIRCLE_MAX_SIZE,
      Math.max(RUNNER_CIRCLE_MIN_SIZE, Number.isFinite(rawSize) ? rawSize : RUNNER_CIRCLE_MIN_SIZE),
    ),
  );
}

function getSizeBonusMs(circleSizePx: number): number {
  const range = RUNNER_CIRCLE_MAX_SIZE - RUNNER_CIRCLE_MIN_SIZE;
  if (range <= 0) return 0;
  const normalized =
    (Math.min(RUNNER_CIRCLE_MAX_SIZE, Math.max(RUNNER_CIRCLE_MIN_SIZE, circleSizePx)) -
      RUNNER_CIRCLE_MIN_SIZE) /
    range;
  return Math.round(normalized * MAX_SIZE_BONUS_MS);
}

function computeSurvivalRankings(room: Room, endedAt: number): SurvivalRankingItem[] {
  if (!room.game) return [];
  const findStartedAt = room.game.phase === "find" ? room.game.phaseStartedAt : room.game.startedAt;
  return Object.values(room.submissions)
    .map((submission) => {
      const survivalEndedAt = room.caughtAtByTargetId[submission.playerId] || endedAt;
      const survivalMs = Math.max(0, survivalEndedAt - findStartedAt);
      const circleSizePx = getSubmissionCircleSizePx(submission);
      const sizeBonusMs = getSizeBonusMs(circleSizePx);
      return {
        playerId: submission.playerId,
        playerName: submission.playerName,
        rank: 0,
        survivalMs,
        circleSizePx,
        sizeBonusMs,
        score: survivalMs + sizeBonusMs,
      };
    })
    .sort((a, b) =>
      b.score - a.score ||
      b.survivalMs - a.survivalMs ||
      b.circleSizePx - a.circleSizePx ||
      a.playerName.localeCompare(b.playerName),
    )
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function getFocusScoreItems(room: Room): FocusScoreItem[] {
  return Object.values(room.submissions)
    .map((submission) => ({
      playerId: submission.playerId,
      playerName: submission.playerName,
      score: Math.round((room.focusScores[submission.playerId] || 0) * 10) / 10,
    }))
    .sort((a, b) => b.score - a.score);
}

function emitArtistFocusScores(room: Room): void {
  const scores = getFocusScoreItems(room);
  room.players
    .filter((player) => player.role === "artist")
    .forEach((artist) => {
      const ownScore = scores.find(
        (item) => item.playerId === artist.socketId,
      ) || {
        playerId: artist.socketId,
        playerName: artist.name,
        score: 0,
      };
      io.to(artist.socketId).emit("focus_scores", {
        audience: "artist_live",
        round: room.game?.round || 0,
        phase: room.game?.phase || "loading",
        radiusPx: FOCUS_RADIUS_PX,
        scores: [ownScore],
      });
    });
}

function emitSpyFocusSnapshot(room: Room): void {
  const spy = room.players.find((player) => player.role === "spy");
  if (!spy) return;
  io.to(spy.socketId).emit("focus_scores", {
    audience: "spy_snapshot",
    round: room.game?.round || 0,
    phase: room.game?.phase || "loading",
    radiusPx: FOCUS_RADIUS_PX,
    scores: getFocusScoreItems(room),
  });
}

function tickFocusScores(): void {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (
      room.state !== "playing" ||
      room.game?.phase !== "find" ||
      !room.focusPointer
    )
      continue;
    if (now - room.focusPointer.updatedAt > 30000) continue;

    const pointerX = room.focusPointer.xRatio * room.focusPointer.canvasWidth;
    const pointerY = room.focusPointer.yRatio * room.focusPointer.canvasHeight;
    const minSize = Math.min(
      room.focusPointer.canvasWidth,
      room.focusPointer.canvasHeight,
    );

    Object.values(room.submissions).forEach((submission) => {
      const targetX =
        submission.character.xRatio * room.focusPointer!.canvasWidth;
      const targetY =
        submission.character.yRatio * room.focusPointer!.canvasHeight;
      const targetRadius = submission.character.radiusRatio * minSize;
      const dx = pointerX - targetX;
      const dy = pointerY - targetY;
      const distanceToCircle = Math.max(
        0,
        Math.sqrt(dx * dx + dy * dy) - targetRadius,
      );
      if (distanceToCircle > FOCUS_RADIUS_PX) return;

      const closeness = 1 - distanceToCircle / FOCUS_RADIUS_PX;
      const addScore = Math.max(
        1,
        Math.ceil(closeness * FOCUS_MAX_SCORE_PER_TICK),
      );
      room.focusScores[submission.playerId] =
        (room.focusScores[submission.playerId] || 0) + addScore;
    });

    emitArtistFocusScores(room);
    if (now - room.lastSpyFocusSnapshotAt >= SPY_FOCUS_SNAPSHOT_MS) {
      room.lastSpyFocusSnapshotAt = now;
      emitSpyFocusSnapshot(room);
    }
  }
}

setInterval(tickFocusScores, FOCUS_SCORE_TICK_MS);

function forceNextPhase(socket: Socket): void {
  const room = findJoinedRoom(socket);
  if (!room || room.state !== "playing" || !room.game) {
    socket.emit("room_error", { message: "진행 중인 게임이 없습니다." });
    return;
  }
  if (room.hostSocketId !== socket.id) {
    socket.emit("room_error", { message: "방장만 단계를 넘길 수 있습니다." });
    return;
  }

  const flow: GamePhase[] = [
    "role_assignment",
    "decorate",
    "submit",
    "reveal",
    "find",
    "result",
  ];
  const index = flow.indexOf(room.game.phase);
  const next = flow[Math.min(flow.length - 1, index + 1)];
  setGamePhase(room, next);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "bobartist-server",
    version: VERSION,
    rooms: rooms.size,
    images: images.size,
    storage: "memory-only",
  });
});

app.get("/images/:imageId", (req, res) => {
  const image = images.get(req.params.imageId);
  if (!image) {
    res.status(404).send("Image not found");
    return;
  }

  res.setHeader("Content-Type", image.mimeType);
  res.setHeader("Cache-Control", "no-store");
  res.send(image.buffer);
});

registerSharedChat(io);
registerYachtDice(io);

io.on("connection", (socket) => {
  socket.emit("server_ready", { socketId: socket.id, version: VERSION });

  socket.on("create_room", (payload: CreateRoomRequest = {}) => {
    try {
      leaveJoinedRooms(socket);

      const artwork = parseArtwork(payload.artwork);
      const code = generateRoomCode();
      const now = Date.now();
      const room: Room = {
        code,
        hostSocketId: socket.id,
        state: "lobby",
        artwork,
        settings: normalizeGameSettings(payload.settings),
        game: null,
        submissions: {},
        caughtTargetIds: [],
        caughtAtByTargetId: {},
        selectedTargetId: null,
        result: null,
        resultRankings: [],
        focusScores: {},
        focusPointer: null,
        lastSpyFocusSnapshotAt: 0,
        currentSpyIndex: 0,
        players: [
          {
            socketId: socket.id,
            name: normalizeName(payload.playerName),
            ready: true,
            role: null,
            submitted: false,
            joinedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      rooms.set(code, room);
      socket.join(code);
      socket.emit("room_created", toPublicRoom(room));
      emitRoomState(room);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "방 생성 중 오류가 발생했습니다.";
      socket.emit("room_error", { message });
    }
  });

  socket.on("join_room", (payload: ClientRoomRequest = {}) =>
    joinRoom(socket, payload),
  );
  socket.on("leave_room", () => {
    leaveJoinedRooms(socket);
    socket.emit("room_left");
  });
  socket.on("toggle_ready", () => toggleReady(socket));
  socket.on("update_game_settings", (payload = {}) =>
    updateGameSettings(socket, payload),
  );
  socket.on("start_game", () => startGame(socket));
  socket.on("submit_artwork", (payload = {}) => submitArtwork(socket, payload));
  socket.on("find_target", (payload = {}) => findTarget(socket, payload));
  socket.on("confirm_find", () => confirmFind(socket));
  socket.on("focus_pointer", (payload = {}) =>
    updateFocusPointer(socket, payload),
  );
  socket.on("restart_game", () => restartGame(socket));
  socket.on("force_next_phase", () => forceNextPhase(socket));
  socket.on("disconnect", () => leaveJoinedRooms(socket));
});

httpServer.listen(PORT, () => {
  console.log(
    `[BobPlatform] server v${VERSION} running on http://localhost:${PORT}`,
  );
});
