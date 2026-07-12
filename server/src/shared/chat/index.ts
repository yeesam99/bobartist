import type { Server, Socket } from "socket.io";
import { randomUUID } from "crypto";

export type ChatMessage = {
  id: string;
  channel: string;
  type: "user" | "system";
  playerId?: string;
  nickname?: string;
  text: string;
  createdAt: number;
};

type JoinPayload = { channel?: string; nickname?: string };
type SendPayload = { channel?: string; text?: string };

const MAX_CHANNEL_MESSAGES = 100;
const MAX_TEXT_LENGTH = 200;
const histories = new Map<string, ChatMessage[]>();
const lastSentAt = new Map<string, number>();

function normalizeChannel(value: unknown): string {
  const channel = String(value || "").trim().toLowerCase();
  if (!/^\/chat\/game\/(bobartist|yacht-dice)\/\d{6}$/.test(channel)) {
    throw new Error("유효하지 않은 채팅 채널입니다.");
  }
  return channel;
}

function normalizeNickname(value: unknown): string {
  const nickname = String(value || "").trim().slice(0, 16);
  return nickname || "익명";
}

function chatRoom(channel: string): string { return `chat-channel:${channel}`; }

function canAccess(socket: Socket, channel: string): boolean {
  const parts = channel.split("/");
  const gameId = parts[3];
  const roomCode = parts[4];
  return gameId === "bobartist"
    ? socket.rooms.has(roomCode)
    : socket.rooms.has(`yacht:${roomCode}`);
}

function append(io: Server, message: ChatMessage): void {
  const list = histories.get(message.channel) || [];
  list.push(message);
  if (list.length > MAX_CHANNEL_MESSAGES) list.splice(0, list.length - MAX_CHANNEL_MESSAGES);
  histories.set(message.channel, list);
  io.to(chatRoom(message.channel)).emit("chat:message", message);
}

function system(io: Server, channel: string, text: string): void {
  append(io, { id: randomUUID(), channel, type: "system", text, createdAt: Date.now() });
}

export function registerSharedChat(io: Server): void {
  io.on("connection", (socket) => {
    const joined = new Map<string, string>();

    socket.on("chat:join", (payload: JoinPayload = {}) => {
      try {
        const channel = normalizeChannel(payload.channel);
        if (!canAccess(socket, channel)) throw new Error("해당 게임 방의 참가자만 채팅에 참여할 수 있습니다.");
        const nickname = normalizeNickname(payload.nickname);
        if (!joined.has(channel)) {
          joined.set(channel, nickname);
          socket.join(chatRoom(channel));
          socket.emit("chat:history", { channel, messages: histories.get(channel) || [] });
          system(io, channel, `${nickname}님이 채팅에 참여했습니다.`);
        }
      } catch (error) {
        socket.emit("chat:error", { message: error instanceof Error ? error.message : "채팅 참여에 실패했습니다." });
      }
    });

    socket.on("chat:leave", (payload: { channel?: string } = {}) => {
      try {
        const channel = normalizeChannel(payload.channel);
        const nickname = joined.get(channel);
        if (!nickname) return;
        joined.delete(channel);
        socket.leave(chatRoom(channel));
        system(io, channel, `${nickname}님이 채팅에서 나갔습니다.`);
      } catch { /* ignore invalid leave */ }
    });

    socket.on("chat:send", (payload: SendPayload = {}) => {
      try {
        const channel = normalizeChannel(payload.channel);
        const nickname = joined.get(channel);
        if (!nickname || !canAccess(socket, channel)) throw new Error("채팅방에 참여 중이 아닙니다.");
        const text = String(payload.text || "").trim().slice(0, MAX_TEXT_LENGTH);
        if (!text) return;
        const now = Date.now();
        const key = `${socket.id}:${channel}`;
        if (now - (lastSentAt.get(key) || 0) < 400) throw new Error("메시지를 너무 빠르게 보내고 있습니다.");
        lastSentAt.set(key, now);
        append(io, { id: randomUUID(), channel, type: "user", playerId: socket.id, nickname, text, createdAt: now });
      } catch (error) {
        socket.emit("chat:error", { message: error instanceof Error ? error.message : "메시지 전송에 실패했습니다." });
      }
    });

    socket.on("disconnect", () => {
      joined.forEach((nickname, channel) => system(io, channel, `${nickname}님의 연결이 종료되었습니다.`));
      joined.clear();
    });
  });
}
