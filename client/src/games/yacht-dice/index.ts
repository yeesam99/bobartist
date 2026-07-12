import { io, type Socket } from "socket.io-client";
import "./style.css";

export const YACHT_DICE_MODULE_VERSION = "0.0.52";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

type PublicRoom = {
  code: string;
  state: "lobby" | "playing";
  playerCount: number;
  maxPlayers: number;
  canStart: boolean;
  players: Array<{ id: string; name: string; ready: boolean; isHost: boolean }>;
};

let socket: Socket | null = null;
let currentRoom: PublicRoom | null = null;
let roomList: PublicRoom[] = [];
let statusMessage = "서버에 연결 중입니다.";

function getPlayerName(): string {
  return (localStorage.getItem("bobplatform.playerName") || localStorage.getItem("bobartist.playerName") || "").trim();
}

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
  if (currentRoom) renderRoom();
  else renderLobby();
}

function renderLobby(): void {
  const savedName = getPlayerName();
  app().innerHTML = `
    <main class="yacht-shell">
      <header class="yacht-header">
        <button id="backPlatform" class="yacht-back" type="button">← BobPlatform</button>
        <div><h1>Yacht Dice</h1><span>v${YACHT_DICE_MODULE_VERSION}</span></div>
      </header>

      <section class="yacht-lobby-grid">
        <article class="yacht-panel yacht-create-panel">
          <p class="yacht-kicker">MULTIPLAYER LOBBY</p>
          <h2>게임 참가</h2>
          <label>닉네임<input id="playerName" maxlength="16" value="${savedName}" placeholder="닉네임을 입력하세요" /></label>
          <button id="createRoom" class="yacht-primary" type="button">새 방 만들기</button>
          <div class="yacht-divider"><span>또는 방 코드로 입장</span></div>
          <div class="yacht-code-row">
            <input id="roomCode" inputmode="numeric" maxlength="6" placeholder="6자리 방 코드" />
            <button id="joinRoom" type="button">입장</button>
          </div>
          <p class="yacht-status">${statusMessage}</p>
        </article>

        <article class="yacht-panel">
          <div class="yacht-panel-title"><div><p class="yacht-kicker">OPEN ROOMS</p><h2>방 목록</h2></div><button id="refreshRooms" type="button">새로고침</button></div>
          <div class="yacht-room-list">
            ${roomList.length ? roomList.map((room) => `
              <button class="yacht-room-item" data-room-code="${room.code}" type="button">
                <span><strong>${room.code}</strong><small>${room.state === "lobby" ? "대기 중" : "게임 중"}</small></span>
                <em>${room.playerCount} / ${room.maxPlayers}</em>
              </button>`).join("") : '<p class="yacht-empty">현재 참가 가능한 방이 없습니다.</p>'}
          </div>
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
      <header class="yacht-header">
        <button id="leaveRoom" class="yacht-back" type="button">← 방 나가기</button>
        <div><h1>Yacht Dice</h1><span>v${YACHT_DICE_MODULE_VERSION}</span></div>
      </header>
      <section class="yacht-room-layout">
        <article class="yacht-panel yacht-room-main">
          <p class="yacht-kicker">ROOM CODE</p>
          <h2 class="yacht-room-code">${currentRoom.code}</h2>
          <p>친구에게 방 코드를 알려주세요.</p>
          <div class="yacht-rule-summary"><strong>이번 버전 범위</strong><span>방 생성 · 입장 · Ready · Start</span><small>Roll/Hold/점수판은 v0.0.53 이후 추가됩니다.</small></div>
        </article>
        <article class="yacht-panel">
          <div class="yacht-panel-title"><div><p class="yacht-kicker">PLAYERS</p><h2>플레이어 ${currentRoom.playerCount}/${currentRoom.maxPlayers}</h2></div></div>
          <div class="yacht-player-list">${currentRoom.players.map((player) => `
            <div class="yacht-player ${player.id === socket?.id ? "me" : ""}">
              <span><strong>${player.name}</strong>${player.isHost ? "<small>방장</small>" : ""}</span>
              <em class="${player.ready ? "ready" : "waiting"}">${player.isHost ? "HOST" : player.ready ? "READY" : "WAITING"}</em>
            </div>`).join("")}</div>
          ${isHost
            ? `<button id="startGame" class="yacht-primary" type="button" ${currentRoom.canStart ? "" : "disabled"}>게임 시작</button><p class="yacht-help">2명 이상이며 모든 참가자가 Ready여야 시작할 수 있습니다.</p>`
            : `<button id="toggleReady" class="yacht-primary" type="button">${me?.ready ? "Ready 취소" : "Ready"}</button>`}
          <p class="yacht-status">${statusMessage}</p>
        </article>
      </section>
    </main>`;
  document.querySelector<HTMLButtonElement>("#leaveRoom")?.addEventListener("click", () => socket?.emit("yacht:leave-room"));
  document.querySelector<HTMLButtonElement>("#toggleReady")?.addEventListener("click", () => socket?.emit("yacht:toggle-ready"));
  document.querySelector<HTMLButtonElement>("#startGame")?.addEventListener("click", () => socket?.emit("yacht:start-game"));
}

function playerNameInput(): string {
  const name = document.querySelector<HTMLInputElement>("#playerName")?.value.trim() || "";
  if (!name) { statusMessage = "닉네임을 입력해 주세요."; render(); return ""; }
  savePlayerName(name);
  return name;
}

function createRoom(): void {
  const playerName = playerNameInput();
  if (playerName) socket?.emit("yacht:create-room", { playerName });
}

function joinRoom(code?: string): void {
  const playerName = playerNameInput();
  if (!playerName) return;
  const roomCode = (code || document.querySelector<HTMLInputElement>("#roomCode")?.value || "").replace(/\D/g, "").slice(0, 6);
  if (roomCode.length !== 6) { statusMessage = "6자리 방 코드를 입력해 주세요."; render(); return; }
  socket?.emit("yacht:join-room", { roomCode, playerName });
}

export function mountYachtDice(): void {
  socket = io(SERVER_URL, { transports: ["websocket", "polling"] });
  socket.on("connect", () => { statusMessage = "서버에 연결되었습니다."; socket?.emit("yacht:request-room-list"); render(); });
  socket.on("connect_error", () => { statusMessage = "서버 연결에 실패했습니다."; render(); });
  socket.on("yacht:room-list", (rooms: PublicRoom[]) => { roomList = rooms; if (!currentRoom) render(); });
  socket.on("yacht:room-created", (room: PublicRoom) => { currentRoom = room; statusMessage = "방을 만들었습니다."; render(); });
  socket.on("yacht:room-joined", (room: PublicRoom) => { currentRoom = room; statusMessage = "방에 입장했습니다."; render(); });
  socket.on("yacht:room-state", (room: PublicRoom) => { if (currentRoom?.code === room.code || room.players.some((p) => p.id === socket?.id)) { currentRoom = room; render(); } });
  socket.on("yacht:room-left", () => { currentRoom = null; statusMessage = "방에서 나왔습니다."; socket?.emit("yacht:request-room-list"); render(); });
  socket.on("yacht:game-started", (payload: { message?: string }) => { statusMessage = payload.message || "게임이 시작되었습니다."; render(); });
  socket.on("yacht:error", (payload: { message?: string }) => { statusMessage = payload.message || "오류가 발생했습니다."; render(); });
  render();
}
