import type { Server, Socket } from "socket.io";

type Suit = "spades" | "hearts" | "diamonds" | "clubs";
type Rank = "A" | "K" | "Q" | "J" | "10" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2";
type Card = { suit: Suit; rank: Rank; value: number };
type PokerPlayer = { id: string; name: string; ready: boolean; isHost: boolean; joinedAt: number };
type PokerState = {
  phase: "playing" | "revealed";
  round: number;
  cards: Record<string, Card>;
  winnerIds: string[];
};
type PokerRoom = {
  code: string;
  hostId: string;
  state: "lobby" | "playing" | "revealed";
  players: PokerPlayer[];
  game: PokerState | null;
  createdAt: number;
  updatedAt: number;
};
type PlayerRequest = { playerName?: string; roomCode?: string };

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const rooms = new Map<string, PokerRoom>();
const ranks: Rank[] = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];

function normalizeName(value?: string): string {
  const name = (value || "").trim();
  return name ? name.slice(0, 16) : "익명";
}
function normalizeCode(value?: string): string { return (value || "").replace(/\D/g, "").slice(0, 6); }
function createCode(): string {
  let code = "";
  do code = String(Math.floor(100000 + Math.random() * 900000)); while (rooms.has(code));
  return code;
}
function buildDeck(): Card[] {
  return suits.flatMap((suit) => ranks.map((rank, index) => ({ suit, rank, value: ranks.length - index })));
}
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const next = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[next]] = [copy[next], copy[index]];
  }
  return copy;
}
function canStart(room: PokerRoom): boolean {
  return room.state === "lobby" && room.players.length >= MIN_PLAYERS && room.players.length <= MAX_PLAYERS && room.players.every((p) => p.isHost || p.ready);
}
function toPublic(room: PokerRoom) {
  return {
    code: room.code,
    state: room.state,
    playerCount: room.players.length,
    maxPlayers: MAX_PLAYERS,
    canStart: canStart(room),
    players: room.players.map((p) => ({ id: p.id, name: p.name, ready: p.ready, isHost: p.isHost })),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}
function toPublicGame(room: PokerRoom, viewerId: string) {
  if (!room.game) return null;
  const revealed = room.game.phase === "revealed";
  return {
    roomCode: room.code,
    phase: room.game.phase,
    round: room.game.round,
    cards: Object.fromEntries(room.players.map((player) => {
      const card = room.game?.cards[player.id];
      return [player.id, player.id === viewerId && !revealed ? null : card];
    })),
    winnerIds: [...room.game.winnerIds],
  };
}
function emitRoomList(io: Server): void {
  io.emit("indian-poker:room-list", [...rooms.values()].filter((r) => r.state === "lobby").sort((a,b) => b.createdAt-a.createdAt).map(toPublic));
}
function emitRoom(io: Server, room: PokerRoom): void {
  io.to(`indian-poker:${room.code}`).emit("indian-poker:room-state", toPublic(room));
  for (const player of room.players) io.to(player.id).emit("indian-poker:game-state", toPublicGame(room, player.id));
  emitRoomList(io);
}
function emitError(socket: Socket, message: string): void { socket.emit("indian-poker:error", { message }); }
function findRoom(socketId: string): PokerRoom | undefined { return [...rooms.values()].find((r) => r.players.some((p) => p.id === socketId)); }
function leaveRoom(io: Server, socket: Socket): void {
  const room = findRoom(socket.id);
  if (!room) return;
  room.players = room.players.filter((p) => p.id !== socket.id);
  socket.leave(`indian-poker:${room.code}`);
  if (!room.players.length) { rooms.delete(room.code); emitRoomList(io); return; }
  if (room.hostId === socket.id) {
    room.hostId = room.players[0].id;
    room.players = room.players.map((p, i) => ({ ...p, isHost: i === 0, ready: i === 0 ? true : p.ready }));
  }
  if (room.state !== "lobby") {
    room.state = "lobby";
    room.game = null;
    room.players = room.players.map((p) => ({ ...p, ready: p.isHost }));
  }
  room.updatedAt = Date.now();
  emitRoom(io, room);
}
function startRound(io: Server, room: PokerRoom): void {
  const deck = shuffle(buildDeck());
  const cards = Object.fromEntries(room.players.map((p, i) => [p.id, deck[i]]));
  room.state = "playing";
  room.game = { phase: "playing", round: (room.game?.round || 0) + 1, cards, winnerIds: [] };
  room.updatedAt = Date.now();
  emitRoom(io, room);
  io.to(`indian-poker:${room.code}`).emit("indian-poker:game-started", { message: "카드가 분배되었습니다. 자신의 카드는 보이지 않고 상대 카드만 확인할 수 있습니다." });
}

export function getIndianPokerAdminRooms() {
  return [...rooms.values()].map((room) => ({
    gameId: "indian-poker" as const,
    roomCode: room.code,
    state: room.state,
    playerCount: room.players.length,
    maxPlayers: MAX_PLAYERS,
    players: room.players.map((p) => ({ id: p.id, nickname: p.name, isHost: p.isHost })),
    detail: { phase: room.game?.phase || room.state, round: room.game?.round || 0 },
    updatedAt: room.updatedAt,
  }));
}

export function registerIndianPoker(io: Server): void {
  io.on("connection", (socket) => {
    socket.on("indian-poker:request-room-list", () => emitRoomList(io));
    socket.on("indian-poker:create-room", (payload: PlayerRequest = {}) => {
      leaveRoom(io, socket);
      const now = Date.now();
      const room: PokerRoom = { code: createCode(), hostId: socket.id, state: "lobby", players: [{ id: socket.id, name: normalizeName(payload.playerName), ready: true, isHost: true, joinedAt: now }], game: null, createdAt: now, updatedAt: now };
      rooms.set(room.code, room); socket.join(`indian-poker:${room.code}`);
      socket.emit("indian-poker:room-created", toPublic(room)); emitRoom(io, room);
    });
    socket.on("indian-poker:join-room", (payload: PlayerRequest = {}) => {
      const room = rooms.get(normalizeCode(payload.roomCode));
      if (!room) return emitError(socket, "존재하지 않는 방입니다.");
      if (room.state !== "lobby") return emitError(socket, "이미 게임이 시작된 방입니다.");
      if (room.players.length >= MAX_PLAYERS) return emitError(socket, "방 인원이 가득 찼습니다.");
      leaveRoom(io, socket);
      room.players.push({ id: socket.id, name: normalizeName(payload.playerName), ready: false, isHost: false, joinedAt: Date.now() });
      room.updatedAt = Date.now(); socket.join(`indian-poker:${room.code}`);
      socket.emit("indian-poker:room-joined", toPublic(room)); emitRoom(io, room);
    });
    socket.on("indian-poker:leave-room", () => { leaveRoom(io, socket); socket.emit("indian-poker:room-left"); });
    socket.on("indian-poker:toggle-ready", () => {
      const room = findRoom(socket.id); if (!room || room.state !== "lobby") return;
      room.players = room.players.map((p) => p.id === socket.id && !p.isHost ? { ...p, ready: !p.ready } : p);
      room.updatedAt = Date.now(); emitRoom(io, room);
    });
    socket.on("indian-poker:start-game", () => {
      const room = findRoom(socket.id); if (!room) return emitError(socket, "참여 중인 방이 없습니다.");
      if (room.hostId !== socket.id) return emitError(socket, "방장만 게임을 시작할 수 있습니다.");
      if (!canStart(room)) return emitError(socket, "2~6명이 참가할 수 있으며 모든 참가자가 Ready여야 합니다.");
      startRound(io, room);
    });
    socket.on("indian-poker:reveal-cards", () => {
      const room = findRoom(socket.id); if (!room?.game || room.state !== "playing") return emitError(socket, "공개할 카드가 없습니다.");
      if (room.hostId !== socket.id) return emitError(socket, "이번 버전에서는 방장만 카드를 공개할 수 있습니다.");
      const best = Math.max(...Object.values(room.game.cards).map((card) => card.value));
      room.game.winnerIds = room.players.filter((p) => room.game?.cards[p.id].value === best).map((p) => p.id);
      room.game.phase = "revealed"; room.state = "revealed"; room.updatedAt = Date.now(); emitRoom(io, room);
    });
    socket.on("indian-poker:next-round", () => {
      const room = findRoom(socket.id); if (!room?.game || room.state !== "revealed") return emitError(socket, "현재 라운드가 아직 종료되지 않았습니다.");
      if (room.hostId !== socket.id) return emitError(socket, "방장만 다음 라운드를 시작할 수 있습니다.");
      startRound(io, room);
    });
    socket.on("disconnect", () => leaveRoom(io, socket));
  });
}
