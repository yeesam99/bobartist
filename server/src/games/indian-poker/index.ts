import type { Server, Socket } from "socket.io";

type Suit = "spades" | "hearts" | "diamonds" | "clubs";
type Rank = "A" | "K" | "Q" | "J" | "10" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2";
type Card = { suit: Suit; rank: Rank; value: number };
type PokerPlayer = {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
  joinedAt: number;
  chips: number;
  roundBet: number;
};
type PokerState = {
  phase: "betting" | "revealed";
  round: number;
  cards: Record<string, Card>;
  winnerIds: string[];
  pot: number;
  ante: number;
  currentBet: number;
  currentTurnId: string;
  actedIds: string[];
  lastAction: string;
};
type PokerRoom = {
  code: string;
  hostId: string;
  state: "lobby" | "playing" | "revealed";
  startingChips: number;
  players: PokerPlayer[];
  game: PokerState | null;
  createdAt: number;
  updatedAt: number;
};
type PlayerRequest = { playerName?: string; roomCode?: string; startingChips?: number };
type BetRequest = { amount?: number };

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const ANTE = 100;
const STARTING_CHIP_OPTIONS = [1000, 3000, 5000, 10000] as const;
const BET_OPTIONS = [100, 500, 1000] as const;
const rooms = new Map<string, PokerRoom>();
const ranks: Rank[] = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];

function normalizeName(value?: string): string {
  const name = (value || "").trim();
  return name ? name.slice(0, 16) : "익명";
}
function normalizeCode(value?: string): string { return (value || "").replace(/\D/g, "").slice(0, 6); }
function normalizeStartingChips(value?: number): number {
  return STARTING_CHIP_OPTIONS.includes(value as (typeof STARTING_CHIP_OPTIONS)[number]) ? Number(value) : 10000;
}
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
    startingChips: room.startingChips,
    players: room.players.map((p) => ({ id: p.id, name: p.name, ready: p.ready, isHost: p.isHost, chips: p.chips, roundBet: p.roundBet })),
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
    pot: room.game.pot,
    ante: room.game.ante,
    currentBet: room.game.currentBet,
    currentTurnId: room.game.currentTurnId,
    actedIds: [...room.game.actedIds],
    lastAction: room.game.lastAction,
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
function activePlayers(room: PokerRoom): PokerPlayer[] { return room.players.filter((player) => player.chips > 0 || player.roundBet > 0); }
function nextPlayerId(room: PokerRoom, currentId: string): string {
  const players = activePlayers(room);
  if (!players.length) return "";
  const currentIndex = players.findIndex((player) => player.id === currentId);
  return players[(currentIndex + 1 + players.length) % players.length].id;
}
function bettingComplete(room: PokerRoom): boolean {
  if (!room.game) return false;
  const players = activePlayers(room);
  return players.length > 0 && players.every((player) => room.game?.actedIds.includes(player.id) && player.roundBet === room.game?.currentBet);
}
function revealAndPay(io: Server, room: PokerRoom): void {
  if (!room.game) return;
  const contenders = activePlayers(room);
  const best = Math.max(...contenders.map((player) => room.game?.cards[player.id].value || 0));
  const winners = contenders.filter((player) => room.game?.cards[player.id].value === best);
  room.game.winnerIds = winners.map((player) => player.id);
  const share = Math.floor(room.game.pot / winners.length);
  let remainder = room.game.pot - share * winners.length;
  for (const winner of winners) {
    winner.chips += share + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  room.game.phase = "revealed";
  room.game.currentTurnId = "";
  room.game.lastAction = `${winners.map((player) => player.name).join(", ")} 승리 · Pot ${room.game.pot.toLocaleString()} 지급`;
  room.state = "revealed";
  room.updatedAt = Date.now();
  emitRoom(io, room);
}
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
    room.players = room.players.map((p) => ({ ...p, ready: p.isHost, chips: room.startingChips, roundBet: 0 }));
  }
  room.updatedAt = Date.now();
  emitRoom(io, room);
}
function startRound(io: Server, room: PokerRoom): void {
  const playingPlayers = room.players.filter((player) => player.chips > 0);
  if (playingPlayers.length < MIN_PLAYERS) {
    room.state = "lobby";
    room.game = null;
    room.players = room.players.map((player) => ({ ...player, ready: player.isHost, chips: room.startingChips, roundBet: 0 }));
    room.updatedAt = Date.now();
    emitRoom(io, room);
    return;
  }
  const deck = shuffle(buildDeck());
  const cards = Object.fromEntries(playingPlayers.map((p, i) => [p.id, deck[i]]));
  let pot = 0;
  room.players = room.players.map((player) => {
    if (player.chips <= 0) return { ...player, roundBet: 0 };
    const paidAnte = Math.min(ANTE, player.chips);
    pot += paidAnte;
    return { ...player, chips: player.chips - paidAnte, roundBet: 0 };
  });
  room.state = "playing";
  room.game = {
    phase: "betting",
    round: (room.game?.round || 0) + 1,
    cards,
    winnerIds: [],
    pot,
    ante: ANTE,
    currentBet: 0,
    currentTurnId: playingPlayers[0].id,
    actedIds: [],
    lastAction: `Ante ${ANTE.toLocaleString()} Chips가 Pot에 모였습니다.`,
  };
  room.updatedAt = Date.now();
  emitRoom(io, room);
  io.to(`indian-poker:${room.code}`).emit("indian-poker:game-started", { message: `Ante ${ANTE.toLocaleString()} Chips를 내고 베팅 라운드를 시작합니다.` });
}
function ensureTurn(socket: Socket, room: PokerRoom): boolean {
  if (!room.game || room.game.phase !== "betting" || room.state !== "playing") { emitError(socket, "현재 베팅 중인 라운드가 아닙니다."); return false; }
  if (room.game.currentTurnId !== socket.id) { emitError(socket, "현재 본인의 차례가 아닙니다."); return false; }
  return true;
}
function advanceTurnOrReveal(io: Server, room: PokerRoom): void {
  if (!room.game) return;
  if (bettingComplete(room)) { revealAndPay(io, room); return; }
  room.game.currentTurnId = nextPlayerId(room, room.game.currentTurnId);
  room.updatedAt = Date.now();
  emitRoom(io, room);
}

export function getIndianPokerAdminRooms() {
  return [...rooms.values()].map((room) => ({
    gameId: "indian-poker" as const,
    roomCode: room.code,
    state: room.state,
    playerCount: room.players.length,
    maxPlayers: MAX_PLAYERS,
    players: room.players.map((p) => ({ id: p.id, nickname: p.name, isHost: p.isHost })),
    detail: { phase: room.game?.phase || room.state, round: room.game?.round || 0, pot: room.game?.pot || 0 },
    updatedAt: room.updatedAt,
  }));
}

export function registerIndianPoker(io: Server): void {
  io.on("connection", (socket) => {
    socket.on("indian-poker:request-room-list", () => emitRoomList(io));
    socket.on("indian-poker:create-room", (payload: PlayerRequest = {}) => {
      leaveRoom(io, socket);
      const now = Date.now();
      const startingChips = normalizeStartingChips(payload.startingChips);
      const room: PokerRoom = {
        code: createCode(), hostId: socket.id, state: "lobby", startingChips,
        players: [{ id: socket.id, name: normalizeName(payload.playerName), ready: true, isHost: true, joinedAt: now, chips: startingChips, roundBet: 0 }],
        game: null, createdAt: now, updatedAt: now,
      };
      rooms.set(room.code, room); socket.join(`indian-poker:${room.code}`);
      socket.emit("indian-poker:room-created", toPublic(room)); emitRoom(io, room);
    });
    socket.on("indian-poker:join-room", (payload: PlayerRequest = {}) => {
      const room = rooms.get(normalizeCode(payload.roomCode));
      if (!room) return emitError(socket, "존재하지 않는 방입니다.");
      if (room.state !== "lobby") return emitError(socket, "이미 게임이 시작된 방입니다.");
      if (room.players.length >= MAX_PLAYERS) return emitError(socket, "방 인원이 가득 찼습니다.");
      leaveRoom(io, socket);
      room.players.push({ id: socket.id, name: normalizeName(payload.playerName), ready: false, isHost: false, joinedAt: Date.now(), chips: room.startingChips, roundBet: 0 });
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
      room.players = room.players.map((player) => ({ ...player, chips: room.startingChips, roundBet: 0 }));
      startRound(io, room);
    });
    socket.on("indian-poker:check", () => {
      const room = findRoom(socket.id); if (!room || !ensureTurn(socket, room) || !room.game) return;
      const player = room.players.find((item) => item.id === socket.id); if (!player) return;
      if (player.roundBet !== room.game.currentBet) return emitError(socket, "현재 베팅 금액을 먼저 Call해야 합니다.");
      if (!room.game.actedIds.includes(socket.id)) room.game.actedIds.push(socket.id);
      room.game.lastAction = `${player.name} Check`;
      advanceTurnOrReveal(io, room);
    });
    socket.on("indian-poker:bet", (payload: BetRequest = {}) => {
      const room = findRoom(socket.id); if (!room || !ensureTurn(socket, room) || !room.game) return;
      const amount = Number(payload.amount);
      if (!BET_OPTIONS.includes(amount as (typeof BET_OPTIONS)[number])) return emitError(socket, "Bet은 100, 500, 1000 Chips만 가능합니다.");
      if (room.game.currentBet > 0) return emitError(socket, "이미 Bet이 있습니다. Call을 선택해 주세요.");
      const player = room.players.find((item) => item.id === socket.id); if (!player) return;
      const minimumAvailable = Math.min(...activePlayers(room).map((item) => item.chips));
      if (amount > player.chips || amount > minimumAvailable) return emitError(socket, "모든 플레이어가 Call할 수 있는 금액만 Bet할 수 있습니다.");
      player.chips -= amount; player.roundBet += amount; room.game.pot += amount; room.game.currentBet = amount;
      room.game.actedIds = [socket.id]; room.game.lastAction = `${player.name} Bet ${amount.toLocaleString()}`;
      advanceTurnOrReveal(io, room);
    });
    socket.on("indian-poker:call", () => {
      const room = findRoom(socket.id); if (!room || !ensureTurn(socket, room) || !room.game) return;
      const player = room.players.find((item) => item.id === socket.id); if (!player) return;
      const amount = room.game.currentBet - player.roundBet;
      if (amount <= 0) return emitError(socket, "Call할 금액이 없습니다. Check를 선택해 주세요.");
      if (player.chips < amount) return emitError(socket, "칩이 부족합니다. All In은 다음 버전에서 지원됩니다.");
      player.chips -= amount; player.roundBet += amount; room.game.pot += amount;
      if (!room.game.actedIds.includes(socket.id)) room.game.actedIds.push(socket.id);
      room.game.lastAction = `${player.name} Call ${amount.toLocaleString()}`;
      advanceTurnOrReveal(io, room);
    });
    socket.on("indian-poker:next-round", () => {
      const room = findRoom(socket.id); if (!room?.game || room.state !== "revealed") return emitError(socket, "현재 라운드가 아직 종료되지 않았습니다.");
      if (room.hostId !== socket.id) return emitError(socket, "방장만 다음 라운드를 시작할 수 있습니다.");
      startRound(io, room);
    });
    socket.on("disconnect", () => leaveRoom(io, socket));
  });
}
