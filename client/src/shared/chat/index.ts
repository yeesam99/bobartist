import type { Socket } from "socket.io-client";
import "./style.css";

type ChatMessage = { id: string; channel: string; type: "user" | "system"; playerId?: string; nickname?: string; text: string; createdAt: number };
type ChatContext = { socket: Socket; gameId: "bobartist" | "yacht-dice"; roomCode: string; nickname: string };

let context: ChatContext | null = null;
let channel = "";
let messages: ChatMessage[] = [];
let open = false;
let unread = 0;
let boundSocket: Socket | null = null;

function getClientId(): string {
  const key = "bobPlatformClientId";
  let value = localStorage.getItem(key);
  if (!value) { value = `c_${crypto.randomUUID().replace(/-/g, "")}`; localStorage.setItem(key, value); }
  return value;
}

function pathOf(ctx: ChatContext): string { return `/chat/game/${ctx.gameId}/${ctx.roomCode}`; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c] || c)); }
function timeOf(value: number): string { return new Date(value).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }); }

function ensureRoot(): HTMLElement {
  let root = document.querySelector<HTMLElement>("#bob-common-chat");
  if (!root) { root = document.createElement("section"); root.id = "bob-common-chat"; document.body.appendChild(root); }
  return root;
}

function render(): void {
  const root = ensureRoot();
  const previousInput = root.querySelector<HTMLInputElement>(".chat-form input");
  const draft = previousInput?.value || "";
  const restoreFocus = document.activeElement === previousInput;
  if (!context) { root.innerHTML = ""; root.className = ""; return; }
  root.className = open ? "chat-open" : "";
  root.innerHTML = `<button class="chat-toggle" type="button" aria-label="채팅 열기">💬${unread ? `<b>${unread > 99 ? "99+" : unread}</b>` : ""}</button>
    <aside class="chat-panel" aria-hidden="${!open}">
      <header><div><strong>방 채팅</strong><small>${escapeHtml(context.gameId)} &gt; ${escapeHtml(context.roomCode)}</small></div><button class="chat-close" type="button">×</button></header>
      <div class="chat-messages">${messages.map((m) => m.type === "system"
        ? `<p class="chat-system"><span>${timeOf(m.createdAt)}</span>${escapeHtml(m.text)}</p>`
        : `<article class="chat-message ${m.playerId === context?.socket.id ? "mine" : ""}"><div><strong>${escapeHtml(m.nickname || "익명")}</strong><time>${timeOf(m.createdAt)}</time></div><p>${escapeHtml(m.text)}</p></article>`).join("") || `<p class="chat-empty">아직 메시지가 없습니다.</p>`}</div>
      <form class="chat-form"><input maxlength="200" autocomplete="off" placeholder="메시지를 입력하세요" aria-label="채팅 메시지"><button type="submit">전송</button></form>
      <p class="chat-error" aria-live="polite"></p>
    </aside>`;
  root.querySelector<HTMLButtonElement>(".chat-toggle")?.addEventListener("click", () => { open = !open; if (open) unread = 0; render(); });
  root.querySelector<HTMLButtonElement>(".chat-close")?.addEventListener("click", () => { open = false; render(); });
  const input = root.querySelector<HTMLInputElement>(".chat-form input");
  if (input) input.value = draft;
  root.querySelector<HTMLFormElement>(".chat-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input?.value.trim() || "";
    if (text && context) {
      context.socket.emit("chat:send", { channel, text });
      if (input) { input.value = ""; input.focus(); }
    }
  });
  requestAnimationFrame(() => {
    const list = root.querySelector<HTMLElement>(".chat-messages"); if (list) list.scrollTop = list.scrollHeight;
    if (restoreFocus && input) input.focus();
  });
}

function bind(socket: Socket): void {
  if (boundSocket === socket) return;
  boundSocket = socket;
  socket.on("chat:history", (payload: { channel: string; messages: ChatMessage[] }) => { if (payload.channel === channel) { messages = payload.messages; render(); } });
  socket.on("chat:message", (message: ChatMessage) => { if (message.channel !== channel) return; messages.push(message); if (messages.length > 100) messages.shift(); if (!open && message.playerId !== socket.id) unread += 1; render(); });
  socket.on("chat:error", (payload: { message?: string }) => { const error = document.querySelector<HTMLElement>("#bob-common-chat .chat-error"); if (error) error.textContent = payload.message || "채팅 오류가 발생했습니다."; });
}

export function syncRoomChat(next: ChatContext | null): void {
  const nextChannel = next ? pathOf(next) : "";
  if (context && channel && channel !== nextChannel) context.socket.emit("chat:leave", { channel });
  if (!next) { context = null; channel = ""; messages = []; unread = 0; open = false; render(); return; }
  bind(next.socket);
  context = next;
  if (channel !== nextChannel) { channel = nextChannel; messages = []; unread = 0; next.socket.emit("chat:join", { channel, nickname: next.nickname, clientId: getClientId() }); }
  render();
}
