import type { Server, Socket } from "socket.io";

type YachtRoomState = "lobby" | "playing" | "finished";
type ScoreCategory =
  | "ones" | "twos" | "threes" | "fours" | "fives" | "sixes"
  | "threeKind" | "fourKind" | "fullHouse" | "smallStraight" | "largeStraight" | "yacht" | "chance";

type YachtPlayer = { id: string; name: string; ready: boolean; isHost: boolean; joinedAt: number };
type PlayerScoreCard = Partial<Record<ScoreCategory, number>>;
type YachtGameState = {
  currentPlayerId: string;
  currentPlayerIndex: number;
  dice: number[];
  held: boolean[];
  rollCount: number;
  maxRolls: number;
  round: number;
  maxRounds: number;
  phase: "rolling" | "finished";
  scores: Record<string, PlayerScoreCard>;
  winnerIds: string[];
};
type YachtRoom = {
  code: string;
  hostId: string;
  state: YachtRoomState;
  players: YachtPlayer[];
  game: YachtGameState | null;
  createdAt: number;
  updatedAt: number;
};

type PlayerRequest = { roomCode?: string; playerName?: string };
type ToggleHoldRequest = { dieIndex?: number };
type SelectScoreRequest = { category?: ScoreCategory };

type PublicYachtRoom = {
  code: string;
  state: YachtRoomState;
  playerCount: number;
  maxPlayers: number;
  canStart: boolean;
  players: Array<{ id: string; name: string; ready: boolean; isHost: boolean }>;
};

type PublicYachtGameState = {
  roomCode: string;
  currentPlayerId: string;
  currentPlayerIndex: number;
  dice: number[];
  held: boolean[];
  rollCount: number;
  maxRolls: number;
  round: number;
  maxRounds: number;
  phase: "rolling" | "finished";
  scores: Record<string, PlayerScoreCard>;
  previewScores: Record<ScoreCategory, number>;
  totals: Record<string, { upper: number; bonus: number; lower: number; total: number }>;
  winnerIds: string[];
};

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6; // Yacht Dice supports 2-6 players
const MAX_ROLLS = 3;
const MAX_ROUNDS = 13;
const DICE_COUNT = 5;
const UPPER_CATEGORIES: ScoreCategory[] = ["ones", "twos", "threes", "fours", "fives", "sixes"];
const SCORE_CATEGORIES: ScoreCategory[] = [
  ...UPPER_CATEGORIES,
  "threeKind", "fourKind", "fullHouse", "smallStraight", "largeStraight", "yacht", "chance",
];
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

function rollDie(): number { return Math.floor(Math.random() * 6) + 1; }

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

function countDice(dice: number[]): number[] {
  const counts = Array(7).fill(0) as number[];
  dice.forEach((value) => { if (value >= 1 && value <= 6) counts[value] += 1; });
  return counts;
}

function calculateScore(category: ScoreCategory, dice: number[]): number {
  const counts = countDice(dice);
  const sum = dice.reduce((total, value) => total + value, 0);
  const unique = [...new Set(dice)].sort((a, b) => a - b);
  const hasSmallStraight = [
    [1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6],
  ].some((pattern) => pattern.every((value) => unique.includes(value)));
  const hasLargeStraight = unique.length === 5 && (unique.join(",") === "1,2,3,4,5" || unique.join(",") === "2,3,4,5,6");

  switch (category) {
    case "ones": return counts[1] * 1;
    case "twos": return counts[2] * 2;
    case "threes": return counts[3] * 3;
    case "fours": return counts[4] * 4;
    case "fives": return counts[5] * 5;
    case "sixes": return counts[6] * 6;
    case "threeKind": return counts.some((count) => count >= 3) ? sum : 0;
    case "fourKind": return counts.some((count) => count >= 4) ? sum : 0;
    case "fullHouse": return counts.includes(3) && counts.includes(2) ? 25 : 0;
    case "smallStraight": return hasSmallStraight ? 30 : 0;
    case "largeStraight": return hasLargeStraight ? 40 : 0;
    case "yacht": return counts.includes(5) ? 50 : 0;
    case "chance": return sum;
  }
}

function previewScores(dice: number[]): Record<ScoreCategory, number> {
  return Object.fromEntries(SCORE_CATEGORIES.map((category) => [category, calculateScore(category, dice)])) as Record<ScoreCategory, number>;
}

function calculateTotals(card: PlayerScoreCard): { upper: number; bonus: number; lower: number; total: number } {
  const upper = UPPER_CATEGORIES.reduce((sum, category) => sum + (card[category] ?? 0), 0);
  const bonus = upper >= 63 ? 35 : 0;
  const lower = SCORE_CATEGORIES.filter((category) => !UPPER_CATEGORIES.includes(category))
    .reduce((sum, category) => sum + (card[category] ?? 0), 0);
  return { upper, bonus, lower, total: upper + bonus + lower };
}

function toPublicGame(room: YachtRoom): PublicYachtGameState | null {
  if (!room.game) return null;
  const totals = Object.fromEntries(room.players.map((player) => [player.id, calculateTotals(room.game!.scores[player.id] || {})]));
  return {
    roomCode: room.code,
    currentPlayerId: room.game.currentPlayerId,
    currentPlayerIndex: room.game.currentPlayerIndex,
    dice: [...room.game.dice],
    held: [...room.game.held],
    rollCount: room.game.rollCount,
    maxRolls: room.game.maxRolls,
    round: room.game.round,
    maxRounds: room.game.maxRounds,
    phase: room.game.phase,
    scores: Object.fromEntries(Object.entries(room.game.scores).map(([id, score]) => [id, { ...score }])),
    previewScores: previewScores(room.game.dice),
    totals,
    winnerIds: [...room.game.winnerIds],
  };
}

function emitGame(io: Server, room: YachtRoom): void {
  const game = toPublicGame(room);
  if (game) io.to(`yacht:${room.code}`).emit("yacht:game-state", game);
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

function emitError(socket: Socket, message: string): void { socket.emit("yacht:error", { message }); }

function resetTurn(game: YachtGameState): void {
  game.dice = Array(DICE_COUNT).fill(0);
  game.held = Array(DICE_COUNT).fill(false);
  game.rollCount = 0;
}

function finishOrAdvanceTurn(room: YachtRoom): void {
  const game = room.game;
  if (!game) return;
  const allComplete = room.players.every((player) => Object.keys(game.scores[player.id] || {}).length >= MAX_ROUNDS);
  if (allComplete) {
    game.phase = "finished";
    room.state = "finished";
    const totals = room.players.map((player) => ({ id: player.id, total: calculateTotals(game.scores[player.id] || {}).total }));
    const best = Math.max(...totals.map((entry) => entry.total));
    game.winnerIds = totals.filter((entry) => entry.total === best).map((entry) => entry.id);
    return;
  }

  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % room.players.length;
  if (game.currentPlayerIndex === 0) game.round = Math.min(game.round + 1, MAX_ROUNDS);
  game.currentPlayerId = room.players[game.currentPlayerIndex].id;
  resetTurn(game);
}

function leaveRoom(io: Server, socket: Socket): void {
  const room = findJoinedRoom(socket.id);
  if (!room) return;

  const leavingIndex = room.players.findIndex((player) => player.id === socket.id);
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

  if (room.game) {
    delete room.game.scores[socket.id];
    if (room.game.currentPlayerId === socket.id) {
      const nextIndex = Math.min(leavingIndex, room.players.length - 1);
      room.game.currentPlayerIndex = Math.max(0, nextIndex);
      room.game.currentPlayerId = room.players[room.game.currentPlayerIndex].id;
      resetTurn(room.game);
    } else if (leavingIndex < room.game.currentPlayerIndex) {
      room.game.currentPlayerIndex -= 1;
    }
  }

  room.updatedAt = Date.now();
  emitRoom(io, room);
  emitGame(io, room);
}


export function getYachtAdminRooms() {
  return [...rooms.values()].map((room) => ({
    gameId: "yacht-dice" as const,
    roomCode: room.code,
    state: room.state,
    playerCount: room.players.length,
    maxPlayers: MAX_PLAYERS,
    players: room.players.map((player) => ({ id: player.id, nickname: player.name, isHost: player.isHost })),
    detail: {
      round: room.game?.round ?? 0,
      maxRounds: room.game?.maxRounds ?? MAX_ROUNDS,
      currentTurn: room.players.find((player) => player.id === room.game?.currentPlayerId)?.name || "-",
      rollCount: room.game?.rollCount ?? 0,
      phase: room.game?.phase || room.state,
    },
    updatedAt: room.updatedAt,
  }));
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
          game: null,
          createdAt: now,
          updatedAt: now,
        };
        rooms.set(code, room);
        socket.join(`yacht:${code}`);
        socket.emit("yacht:room-created", toPublic(room));
        emitRoom(io, room);
      } catch (error) {
        emitError(socket, error instanceof Error ? error.message : "방 생성에 실패했습니다.");
      }
    });

    socket.on("yacht:join-room", (payload: PlayerRequest = {}) => {
      const code = normalizeCode(payload.roomCode);
      const room = rooms.get(code);
      if (!room) return emitError(socket, "존재하지 않는 방입니다.");
      if (room.state !== "lobby") return emitError(socket, "이미 게임이 시작된 방입니다.");
      if (room.players.length >= MAX_PLAYERS) return emitError(socket, "방 인원이 가득 찼습니다.");

      leaveRoom(io, socket);
      room.players.push({ id: socket.id, name: normalizeName(payload.playerName), ready: false, isHost: false, joinedAt: Date.now() });
      room.updatedAt = Date.now();
      socket.join(`yacht:${code}`);
      socket.emit("yacht:room-joined", toPublic(room));
      emitRoom(io, room);
    });

    socket.on("yacht:leave-room", () => { leaveRoom(io, socket); socket.emit("yacht:room-left"); });

    socket.on("yacht:toggle-ready", () => {
      const room = findJoinedRoom(socket.id);
      if (!room || room.state !== "lobby") return;
      room.players = room.players.map((player) => player.id === socket.id && !player.isHost ? { ...player, ready: !player.ready } : player);
      room.updatedAt = Date.now();
      emitRoom(io, room);
    });

    socket.on("yacht:start-game", () => {
      const room = findJoinedRoom(socket.id);
      if (!room) return emitError(socket, "참여 중인 방이 없습니다.");
      if (room.hostId !== socket.id) return emitError(socket, "방장만 시작할 수 있습니다.");
      if (!canStart(room)) return emitError(socket, "2~6명이 참가할 수 있으며, 방장을 제외한 모든 참가자가 Ready여야 합니다.");

      room.state = "playing";
      room.game = {
        currentPlayerId: room.players[0].id,
        currentPlayerIndex: 0,
        dice: Array(DICE_COUNT).fill(0),
        held: Array(DICE_COUNT).fill(false),
        rollCount: 0,
        maxRolls: MAX_ROLLS,
        round: 1,
        maxRounds: MAX_ROUNDS,
        phase: "rolling",
        scores: Object.fromEntries(room.players.map((player) => [player.id, {}])),
        winnerIds: [],
      };
      room.updatedAt = Date.now();
      emitRoom(io, room);
      io.to(`yacht:${room.code}`).emit("yacht:game-started", {
        room: toPublic(room),
        game: toPublicGame(room),
        message: "게임이 시작되었습니다. 첫 번째 플레이어가 주사위를 굴려 주세요.",
      });
      emitGame(io, room);
    });

    socket.on("yacht:roll-dice", () => {
      const room = findJoinedRoom(socket.id);
      if (!room || room.state !== "playing" || !room.game) return emitError(socket, "진행 중인 Yacht Dice 게임이 없습니다.");
      const game = room.game;
      if (game.phase !== "rolling") return emitError(socket, "이미 종료된 게임입니다.");
      if (game.currentPlayerId !== socket.id) return emitError(socket, "현재 턴 플레이어만 Roll할 수 있습니다.");
      if (game.rollCount >= game.maxRolls) return emitError(socket, "한 턴에 최대 3회까지만 Roll할 수 있습니다.");

      game.dice = game.dice.map((value, index) => game.held[index] ? value : rollDie());
      game.rollCount += 1;
      room.updatedAt = Date.now();
      emitGame(io, room);
    });

    socket.on("yacht:toggle-hold", (payload: ToggleHoldRequest = {}) => {
      const room = findJoinedRoom(socket.id);
      if (!room || room.state !== "playing" || !room.game) return emitError(socket, "진행 중인 Yacht Dice 게임이 없습니다.");
      const game = room.game;
      if (game.currentPlayerId !== socket.id) return emitError(socket, "현재 턴 플레이어만 Hold할 수 있습니다.");
      if (game.rollCount === 0) return emitError(socket, "첫 Roll 이후에 주사위를 Hold할 수 있습니다.");
      if (game.rollCount >= game.maxRolls) return emitError(socket, "세 번째 Roll 이후에는 Hold 상태를 변경할 수 없습니다.");

      const dieIndex = Number(payload.dieIndex);
      if (!Number.isInteger(dieIndex) || dieIndex < 0 || dieIndex >= DICE_COUNT) return emitError(socket, "올바르지 않은 주사위입니다.");
      game.held[dieIndex] = !game.held[dieIndex];
      room.updatedAt = Date.now();
      emitGame(io, room);
    });

    socket.on("yacht:select-score", (payload: SelectScoreRequest = {}) => {
      const room = findJoinedRoom(socket.id);
      if (!room || room.state !== "playing" || !room.game) return emitError(socket, "진행 중인 Yacht Dice 게임이 없습니다.");
      const game = room.game;
      if (game.currentPlayerId !== socket.id) return emitError(socket, "현재 턴 플레이어만 점수를 선택할 수 있습니다.");
      if (game.rollCount === 0) return emitError(socket, "최소 한 번 Roll한 뒤 점수를 선택해 주세요.");
      if (!payload.category || !SCORE_CATEGORIES.includes(payload.category)) return emitError(socket, "올바르지 않은 점수 항목입니다.");

      const card = game.scores[socket.id] || (game.scores[socket.id] = {});
      if (card[payload.category] !== undefined) return emitError(socket, "이미 선택한 점수 항목입니다.");
      card[payload.category] = calculateScore(payload.category, game.dice);
      finishOrAdvanceTurn(room);
      room.updatedAt = Date.now();
      emitRoom(io, room);
      emitGame(io, room);
    });

    socket.on("disconnect", () => leaveRoom(io, socket));
  });
}
