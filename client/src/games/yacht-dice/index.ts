import { io, type Socket } from "socket.io-client";
import "./style.css";
import { syncRoomChat } from "../../shared/chat";

export const YACHT_DICE_MODULE_VERSION = "0.0.59";
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

type ScoreCategory =
  | "ones" | "twos" | "threes" | "fours" | "fives" | "sixes"
  | "threeKind" | "fourKind" | "fullHouse" | "smallStraight" | "largeStraight" | "yacht" | "chance";
type ScoreCard = Partial<Record<ScoreCategory, number>>;
type PublicRoom = {
  code: string;
  state: "lobby" | "playing" | "finished";
  playerCount: number;
  maxPlayers: number;
  canStart: boolean;
  players: Array<{ id: string; name: string; ready: boolean; isHost: boolean }>;
};
type YachtGameState = {
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
  scores: Record<string, ScoreCard>;
  previewScores: Record<ScoreCategory, number>;
  totals: Record<string, { upper: number; bonus: number; lower: number; total: number }>;
  winnerIds: string[];
};

const SCORE_ROWS: Array<{ category: ScoreCategory; label: string; hint: string }> = [
  { category: "ones", label: "Ones", hint: "1의 합" },
  { category: "twos", label: "Twos", hint: "2의 합" },
  { category: "threes", label: "Threes", hint: "3의 합" },
  { category: "fours", label: "Fours", hint: "4의 합" },
  { category: "fives", label: "Fives", hint: "5의 합" },
  { category: "sixes", label: "Sixes", hint: "6의 합" },
  { category: "threeKind", label: "Three of a Kind", hint: "같은 눈 3개 이상" },
  { category: "fourKind", label: "Four of a Kind", hint: "같은 눈 4개 이상" },
  { category: "fullHouse", label: "Full House", hint: "3개 + 2개 · 25점" },
  { category: "smallStraight", label: "Small Straight", hint: "연속 4개 · 30점" },
  { category: "largeStraight", label: "Large Straight", hint: "연속 5개 · 40점" },
  { category: "yacht", label: "Yacht", hint: "같은 눈 5개 · 50점" },
  { category: "chance", label: "Chance", hint: "주사위 총합" },
];

let socket: Socket | null = null;
let currentRoom: PublicRoom | null = null;
let gameState: YachtGameState | null = null;
let roomList: PublicRoom[] = [];
let statusMessage = "서버에 연결 중입니다.";
function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] || char);
}
function getPlayerName(): string { return (localStorage.getItem("bobplatform.playerName") || localStorage.getItem("bobartist.playerName") || "").trim(); }
function savePlayerName(value: string): void {
  const name = value.trim().slice(0, 16);
  localStorage.setItem("bobplatform.playerName", name);
  localStorage.setItem("bobartist.playerName", name);
}
function app(): HTMLDivElement {
  const element = document.querySelector<HTMLDivElement>("#app");
  if (!element) throw new Error("#app element not found");
  return element;
}
function render(): void {
  document.body.classList.add("yacht-body");
  syncRoomChat(socket && currentRoom ? { socket, gameId: "yacht-dice", roomCode: currentRoom.code, nickname: getPlayerName() } : null);
  if ((currentRoom?.state === "playing" || currentRoom?.state === "finished") && gameState) renderGame();
  else if (currentRoom) renderRoom();
  else renderLobby();
}

function renderLobby(): void {
  const savedName = escapeHtml(getPlayerName());
  app().innerHTML = `
    <main class="yacht-shell">
      <header class="yacht-header"><button id="backPlatform" class="yacht-back" type="button">← BobPlatform</button><div><h1>Yacht Dice</h1><span>v${YACHT_DICE_MODULE_VERSION}</span></div></header>
      <section class="yacht-lobby-grid">
        <article class="yacht-panel yacht-create-panel">
          <p class="yacht-kicker">MULTIPLAYER LOBBY</p><h2>게임 참가</h2>
          <label>닉네임<input id="playerName" maxlength="16" value="${savedName}" placeholder="닉네임을 입력하세요" /></label>
          <button id="createRoom" class="yacht-primary" type="button">새 방 만들기</button>
          <div class="yacht-divider"><span>또는 방 코드로 입장</span></div>
          <div class="yacht-code-row"><input id="roomCode" inputmode="numeric" maxlength="6" placeholder="6자리 방 코드" /><button id="joinRoom" type="button">입장</button></div>
          <p class="yacht-status">${escapeHtml(statusMessage)}</p>
        </article>
        <article class="yacht-panel">
          <div class="yacht-panel-title"><div><p class="yacht-kicker">OPEN ROOMS</p><h2>방 목록</h2></div><button id="refreshRooms" type="button">새로고침</button></div>
          <div class="yacht-room-list">${roomList.length ? roomList.map((room) => `<button class="yacht-room-item" data-room-code="${room.code}" type="button"><span><strong>${room.code}</strong><small>대기 중</small></span><em>${room.playerCount} / ${room.maxPlayers}</em></button>`).join("") : '<p class="yacht-empty">현재 참가 가능한 방이 없습니다.</p>'}</div>
        </article>
      </section>
    </main>`;
  document.querySelector<HTMLButtonElement>("#backPlatform")?.addEventListener("click", () => { window.location.hash = "/"; window.location.reload(); });
  document.querySelector<HTMLButtonElement>("#createRoom")?.addEventListener("click", createRoom);
  document.querySelector<HTMLButtonElement>("#joinRoom")?.addEventListener("click", () => joinRoom());
  document.querySelector<HTMLButtonElement>("#refreshRooms")?.addEventListener("click", () => socket?.emit("yacht:request-room-list"));
  document.querySelectorAll<HTMLButtonElement>("[data-room-code]").forEach((button) => button.addEventListener("click", () => joinRoom(button.dataset.roomCode || "")));
}

function renderRoom(): void {
  if (!currentRoom || !socket) return;
  const me = currentRoom.players.find((player) => player.id === socket?.id);
  const isHost = Boolean(me?.isHost);
  app().innerHTML = `
    <main class="yacht-shell">
      <header class="yacht-header"><button id="leaveRoom" class="yacht-back" type="button">← 방 나가기</button><div><h1>Yacht Dice</h1><span>v${YACHT_DICE_MODULE_VERSION}</span></div></header>
      <section class="yacht-room-layout">
        <article class="yacht-panel yacht-room-main"><p class="yacht-kicker">ROOM CODE</p><h2 class="yacht-room-code">${currentRoom.code}</h2><p>친구에게 방 코드를 알려주세요.</p><div class="yacht-rule-summary"><strong>v0.0.59 플레이 범위</strong><span>클래식 13개 점수 · 턴 순환</span><small>점수 선택 시 서버에 저장되고 다음 플레이어로 이동합니다.</small></div></article>
        <article class="yacht-panel"><div class="yacht-panel-title"><div><p class="yacht-kicker">PLAYERS</p><h2>플레이어 ${currentRoom.playerCount}/${currentRoom.maxPlayers}</h2></div></div><div class="yacht-player-list">${renderPlayers(currentRoom)}</div>
          ${isHost ? `<button id="startGame" class="yacht-primary" type="button" ${currentRoom.canStart ? "" : "disabled"}>게임 시작</button><p class="yacht-help">2~6명이 참가할 수 있으며, 방장을 제외한 모든 참가자가 Ready여야 시작할 수 있습니다.</p>` : `<button id="toggleReady" class="yacht-primary" type="button">${me?.ready ? "Ready 취소" : "Ready"}</button>`}
          <p class="yacht-status">${escapeHtml(statusMessage)}</p></article>
      </section>
    </main>`;
  document.querySelector<HTMLButtonElement>("#leaveRoom")?.addEventListener("click", leaveRoom);
  document.querySelector<HTMLButtonElement>("#toggleReady")?.addEventListener("click", () => socket?.emit("yacht:toggle-ready"));
  document.querySelector<HTMLButtonElement>("#startGame")?.addEventListener("click", () => socket?.emit("yacht:start-game"));
}

function renderPlayers(room: PublicRoom, currentPlayerId?: string): string {
  return room.players.map((player) => `
    <div class="yacht-player ${player.id === socket?.id ? "me" : ""} ${player.id === currentPlayerId ? "current" : ""}">
      <span><strong>${escapeHtml(player.name)}</strong>${player.isHost ? "<small>방장</small>" : ""}</span>
      <em class="${player.id === currentPlayerId ? "turn" : player.ready ? "ready" : "waiting"}">${player.id === currentPlayerId ? "TURN" : player.isHost ? "HOST" : player.ready ? "READY" : "WAITING"}</em>
    </div>`).join("");
}
function dieFace(value: number): string {
  const faces = ["?", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
  return faces[value] || "?";
}

function renderScoreRows(game: YachtGameState, playerId: string, selectable: boolean): string {
  const card = game.scores[playerId] || {};
  return SCORE_ROWS.map(({ category, label, hint }) => {
    const saved = card[category];
    const preview = game.previewScores[category] ?? 0;
    const isUsed = saved !== undefined;
    const canSelect = selectable && !isUsed;
    return `<button class="yacht-score-row ${isUsed ? "used" : canSelect ? "selectable" : ""}" data-score-category="${category}" type="button" ${canSelect ? "" : "disabled"}>
      <span><strong>${label}</strong><small>${hint}</small></span><em>${isUsed ? saved : selectable ? preview : "-"}</em>
    </button>`;
  }).join("");
}

function renderGame(): void {
  if (!currentRoom || !gameState || !socket) return;
  const room = currentRoom;
  const game = gameState;
  const socketId = socket.id;
  if (!socketId) return;
  const isMyTurn = game.currentPlayerId === socketId;
  const currentPlayer = room.players.find((player) => player.id === game.currentPlayerId);
  const canHold = isMyTurn && game.phase === "rolling" && game.rollCount > 0 && game.rollCount < game.maxRolls;
  const canRoll = isMyTurn && game.phase === "rolling" && game.rollCount < game.maxRolls;
  const canScore = isMyTurn && game.phase === "rolling" && game.rollCount > 0;
  const isFinished = game.phase === "finished";
  const winners = room.players.filter((player) => game.winnerIds.includes(player.id)).map((player) => player.name).join(", ");
  const myTotals = game.totals[socketId] || { upper: 0, bonus: 0, lower: 0, total: 0 };

  app().innerHTML = `
    <main class="yacht-shell yacht-game-shell">
      <header class="yacht-header"><button id="leaveRoom" class="yacht-back" type="button">← 방 나가기</button><div><h1>Yacht Dice</h1><span>v${YACHT_DICE_MODULE_VERSION}</span></div></header>
      ${isFinished ? `<section class="yacht-result-banner"><p class="yacht-kicker">GAME FINISHED</p><h2>${escapeHtml(winners || "플레이어")} 승리</h2><p>최종 점수표를 확인해 주세요.</p></section>` : ""}
      <section class="yacht-game-layout yacht-score-layout">
        <article class="yacht-panel yacht-game-board">
          <div class="yacht-turn-header"><div><p class="yacht-kicker">ROUND ${game.round} / ${game.maxRounds}</p><h2>${escapeHtml(currentPlayer?.name || "플레이어")}</h2></div><strong>ROLL ${game.rollCount} / ${game.maxRolls}</strong></div>
          <div class="yacht-dice-row" aria-label="주사위 5개">${game.dice.map((value, index) => `<button class="yacht-die ${game.held[index] ? "held" : ""}" data-die-index="${index}" type="button" aria-label="${value === 0 ? "굴리지 않은 주사위" : `${value} 눈 주사위`}${game.held[index] ? ", 고정됨" : ""}" ${canHold ? "" : "disabled"}><span aria-hidden="true">${dieFace(value)}</span><small>${game.held[index] ? "HOLD" : value === 0 ? "ROLL" : "고정"}</small></button>`).join("")}</div>
          <button id="rollDice" class="yacht-primary yacht-roll-button" type="button" ${canRoll ? "" : "disabled"}>${game.rollCount === 0 ? "첫 Roll" : game.rollCount >= game.maxRolls ? "점수를 선택하세요" : `Roll ${game.rollCount + 1}`}</button>
          <p class="yacht-help">${isFinished ? "게임이 종료되었습니다." : isMyTurn ? game.rollCount === 0 ? "Roll을 눌러 주사위를 굴려 주세요." : "점수 항목을 선택하면 저장 후 다음 플레이어로 넘어갑니다." : "현재 턴 플레이어의 동작을 실시간으로 관전 중입니다."}</p>
          <p class="yacht-status">${escapeHtml(statusMessage)}</p>
        </article>

        <aside class="yacht-panel yacht-score-panel">
          <div class="yacht-panel-title"><div><p class="yacht-kicker">MY SCORE CARD</p><h2>점수표</h2></div><strong class="yacht-room-mini">${room.code}</strong></div>
          <div class="yacht-score-list">${renderScoreRows(game, socketId, canScore)}</div>
          <div class="yacht-score-total"><span>상단 ${myTotals.upper}${myTotals.bonus ? ` + 보너스 ${myTotals.bonus}` : ""}</span><span>하단 ${myTotals.lower}</span><strong>총점 ${myTotals.total}</strong></div>
          <div class="yacht-standing-compact">
            <div class="yacht-standing-title"><p class="yacht-kicker">LIVE STANDINGS</p><strong>플레이어 점수</strong></div>
            <div class="yacht-standing-grid">${room.players.map((player) => { const total = game.totals[player.id] || { total: 0 }; const filled = Object.keys(game.scores[player.id] || {}).length; return `<div class="yacht-standing ${player.id === game.currentPlayerId ? "current" : ""}"><span><strong>${escapeHtml(player.name)}</strong><small>${filled}/${game.maxRounds}</small></span><em>${total.total}점</em></div>`; }).join("")}</div>
          </div>
        </aside>
      </section>
    </main>`;

  document.querySelector<HTMLButtonElement>("#leaveRoom")?.addEventListener("click", leaveRoom);
  document.querySelector<HTMLButtonElement>("#rollDice")?.addEventListener("click", () => {
    socket?.emit("yacht:roll-dice");
  });
  document.querySelectorAll<HTMLButtonElement>("[data-die-index]").forEach((button) => button.addEventListener("click", () => {
    const dieIndex = Number(button.dataset.dieIndex);
    socket?.emit("yacht:toggle-hold", { dieIndex });
  }));
  document.querySelectorAll<HTMLButtonElement>("[data-score-category]").forEach((button) => button.addEventListener("click", () => socket?.emit("yacht:select-score", { category: button.dataset.scoreCategory })));
}

function leaveRoom(): void { socket?.emit("yacht:leave-room"); }
function playerNameInput(): string {
  const name = document.querySelector<HTMLInputElement>("#playerName")?.value.trim() || "";
  if (!name) { statusMessage = "닉네임을 입력해 주세요."; render(); return ""; }
  savePlayerName(name); return name;
}
function createRoom(): void { const playerName = playerNameInput(); if (playerName) socket?.emit("yacht:create-room", { playerName }); }
function joinRoom(code?: string): void {
  const playerName = playerNameInput(); if (!playerName) return;
  const roomCode = (code || document.querySelector<HTMLInputElement>("#roomCode")?.value || "").replace(/\D/g, "").slice(0, 6);
  if (roomCode.length !== 6) { statusMessage = "6자리 방 코드를 입력해 주세요."; render(); return; }
  socket?.emit("yacht:join-room", { roomCode, playerName });
}

export function mountYachtDice(): void {
  socket = io(SERVER_URL, { transports: ["websocket", "polling"] });
  socket.on("connect", () => { statusMessage = "서버에 연결되었습니다."; socket?.emit("yacht:request-room-list"); render(); });
  socket.on("connect_error", () => { statusMessage = "서버 연결에 실패했습니다."; render(); });
  socket.on("yacht:room-list", (rooms: PublicRoom[]) => { roomList = rooms; if (!currentRoom) render(); });
  socket.on("yacht:room-created", (room: PublicRoom) => { currentRoom = room; gameState = null; statusMessage = "방을 만들었습니다."; render(); });
  socket.on("yacht:room-joined", (room: PublicRoom) => { currentRoom = room; gameState = null; statusMessage = "방에 입장했습니다."; render(); });
  socket.on("yacht:room-state", (room: PublicRoom) => { if (currentRoom?.code === room.code || room.players.some((p) => p.id === socket?.id)) { currentRoom = room; render(); } });
  socket.on("yacht:room-left", () => { currentRoom = null; gameState = null; statusMessage = "방에서 나왔습니다."; socket?.emit("yacht:request-room-list"); render(); });
  socket.on("yacht:game-started", (payload: { game?: YachtGameState; message?: string }) => { if (payload.game) gameState = payload.game; statusMessage = payload.message || "게임이 시작되었습니다."; render(); });
  socket.on("yacht:game-state", (state: YachtGameState) => {
    const previousPlayer = gameState?.currentPlayerId;
    gameState = state;
    if (currentRoom) currentRoom = { ...currentRoom, state: state.phase === "finished" ? "finished" : "playing" };
    if (state.phase === "finished") statusMessage = "모든 점수 항목이 채워져 게임이 종료되었습니다.";
    else if (previousPlayer && previousPlayer !== state.currentPlayerId) statusMessage = "점수가 저장되고 다음 플레이어의 턴으로 넘어갔습니다.";
    else statusMessage = state.rollCount >= state.maxRolls ? "세 번째 Roll이 완료되었습니다. 점수를 선택해 주세요." : "게임 상태가 동기화되었습니다.";
    render();
  });
  socket.on("yacht:error", (payload: { message?: string }) => { statusMessage = payload.message || "오류가 발생했습니다."; render(); });
  render();
}
