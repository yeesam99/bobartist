import type { Server, Socket } from "socket.io";

type YachtRoomState = "lobby" | "playing";
type YachtPlayer = { id: string; name: string; ready: boolean; isHost: boolean; joinedAt: number };
type YachtRoom = { code: string; hostId: string; state: YachtRoomState; players: YachtPlayer[]; createdAt: number; updatedAt: number };

type PlayerRequest = { roomCode?: string; playerName?: string };

type PublicYachtRoom = {
  code: string;
  state: YachtRoomState;
  playerCount: number;
  maxPlayers: number;
  canStart: boolean;
  players: Array<{ id: string; name: string; ready: boolean; isHost: boolean }>;
};

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const rooms = new Map<string, YachtRoom>();

function normalizeName(value?: string): string {
  const name = (value || "").trim();
  return name ? name.slice(0, 16) : "익명";
}

function normalizeCode(value?: string): string {
  return (value || "").replace(/\D/g, "").slice(0, 6);
}

function createCode(): string {
  for (let i = 0; i < 100; i += 1) {
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    if (!rooms.has(code)) return code;
  }
  throw new Error("방 코드 생성에 실패했습니다.");
}

function canStart(room: YachtRoom): boolean {
  return room.state === "lobby" && room.players.length >= MIN_PLAYERS && room.players.every((p) => p.isHost || p.ready);
}

function toPublic(room: YachtRoom): PublicYachtRoom {
  return {
    code: room.code,
    state: room.state,
    playerCount: room.players.length,
    maxPlayers: MAX_PLAYERS,
    canStart: canStart(room),
    players: room.players.map(({ id, name, ready, isHost }) => ({ id, name, ready, isHost })),
  };
}

function emitRoom(io: Server, room: YachtRoom): void {
  io.to(`yacht:${room.code}`).emit("yacht:room-state", toPublic(room));
  emitRoomList(io);
}

function emitRoomList(io: Server): void {
  const list = [...rooms.values()]
    .filter((room) => room.state === "lobby")
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toPublic);
  io.emit("yacht:room-list", list);
}

function findJoinedRoom(socketId: string): YachtRoom | undefined {
  return [...rooms.values()].find((room) => room.players.some((player) => player.id === socketId));
}

function leaveRoom(io: Server, socket: Socket): void {
  const room = findJoinedRoom(socket.id);
  if (!room) return;
  room.players = room.players.filter((player) => player.id !== socket.id);
  socket.leave(`yacht:${room.code}`);
  if (room.players.length === 0) {
    rooms.delete(room.code);
    emitRoomList(io);
    return;
  }
  if (room.hostId === socket.id) {
    room.hostId = room.players[0].id;
    room.players = room.players.map((player, index) => ({ ...player, isHost: index === 0, ready: index === 0 ? true : player.ready }));
  }
  room.updatedAt = Date.now();
  emitRoom(io, room);
}

export function registerYachtDice(io: Server): void {
  io.on("connection", (socket) => {
    socket.on("yacht:request-room-list", () => emitRoomList(io));

    socket.on("yacht:create-room", (payload: PlayerRequest = {}) => {
      try {
        leaveRoom(io, socket);
        const now = Date.now();
        const code = createCode();
        const room: YachtRoom = {
          code,
          hostId: socket.id,
          state: "lobby",
          players: [{ id: socket.id, name: normalizeName(payload.playerName), ready: true, isHost: true, joinedAt: now }],
          createdAt: now,
          updatedAt: now,
        };
        rooms.set(code, room);
        socket.join(`yacht:${code}`);
        socket.emit("yacht:room-created", toPublic(room));
        emitRoom(io, room);
      } catch (error) {
        socket.emit("yacht:error", { message: error instanceof Error ? error.message : "방 생성에 실패했습니다." });
      }
    });

    socket.on("yacht:join-room", (payload: PlayerRequest = {}) => {
      const code = normalizeCode(payload.roomCode);
      const room = rooms.get(code);
      if (!room) return socket.emit("yacht:error", { message: "존재하지 않는 방입니다." });
      if (room.state !== "lobby") return socket.emit("yacht:error", { message: "이미 게임이 시작된 방입니다." });
      if (room.players.length >= MAX_PLAYERS) return socket.emit("yacht:error", { message: "방 인원이 가득 찼습니다." });
      leaveRoom(io, socket);
      room.players.push({ id: socket.id, name: normalizeName(payload.playerName), ready: false, isHost: false, joinedAt: Date.now() });
      room.updatedAt = Date.now();
      socket.join(`yacht:${code}`);
      socket.emit("yacht:room-joined", toPublic(room));
      emitRoom(io, room);
    });

    socket.on("yacht:leave-room", () => {
      leaveRoom(io, socket);
      socket.emit("yacht:room-left");
    });

    socket.on("yacht:toggle-ready", () => {
      const room = findJoinedRoom(socket.id);
      if (!room || room.state !== "lobby") return;
      room.players = room.players.map((player) => player.id === socket.id && !player.isHost ? { ...player, ready: !player.ready } : player);
      room.updatedAt = Date.now();
      emitRoom(io, room);
    });

    socket.on("yacht:start-game", () => {
      const room = findJoinedRoom(socket.id);
      if (!room) return socket.emit("yacht:error", { message: "참여 중인 방이 없습니다." });
      if (room.hostId !== socket.id) return socket.emit("yacht:error", { message: "방장만 시작할 수 있습니다." });
      if (!canStart(room)) return socket.emit("yacht:error", { message: "2명 이상이며 모든 참가자가 Ready여야 합니다." });
      room.state = "playing";
      room.updatedAt = Date.now();
      emitRoom(io, room);
      io.to(`yacht:${room.code}`).emit("yacht:game-started", { room: toPublic(room), message: "주사위 기능은 v0.0.53에서 추가됩니다." });
    });

    socket.on("disconnect", () => leaveRoom(io, socket));
  });
}
