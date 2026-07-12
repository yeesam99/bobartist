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
type AdminChannelSummary = { channel: string; gameId: string; roomCode: string; messageCount: number; activeUsers: number; lastMessageAt: number };

const MAX_CHANNEL_MESSAGES = 100;
const MAX_TEXT_LENGTH = 200;
const ADMIN_ROOM = "chat-admin-monitor";
const histories = new Map<string, ChatMessage[]>();
const lastSentAt = new Map<string, number>();
const activeMembers = new Map<string, Set<string>>();

function normalizeChannel(value: unknown): string {
  const channel = String(value || "").trim().toLowerCase();
  if (!/^\/chat\/game\/(bobartist|yacht-dice)\/\d{6}$/.test(channel)) throw new Error("유효하지 않은 채팅 채널입니다.");
  return channel;
}
function normalizeNickname(value: unknown): string { const nickname = String(value || "").trim().slice(0, 16); return nickname || "익명"; }
function chatRoom(channel: string): string { return `chat-channel:${channel}`; }
function channelInfo(channel: string): { gameId: string; roomCode: string } { const parts = channel.split("/"); return { gameId: parts[3] || "", roomCode: parts[4] || "" }; }
function canAccess(socket: Socket, channel: string): boolean {
  const { gameId, roomCode } = channelInfo(channel);
  return gameId === "bobartist" ? socket.rooms.has(roomCode) : socket.rooms.has(`yacht:${roomCode}`);
}
function channelSummaries(): AdminChannelSummary[] {
  const channels = new Set([...histories.keys(), ...activeMembers.keys()]);
  return [...channels].map((channel) => {
    const list = histories.get(channel) || [];
    const info = channelInfo(channel);
    return { channel, ...info, messageCount: list.length, activeUsers: activeMembers.get(channel)?.size || 0, lastMessageAt: list.at(-1)?.createdAt || 0 };
  }).sort((a, b) => b.lastMessageAt - a.lastMessageAt || a.channel.localeCompare(b.channel));
}
function snapshot() { return { channels: channelSummaries(), histories: Object.fromEntries(histories) }; }
function emitAdminSnapshot(io: Server): void { io.to(ADMIN_ROOM).emit("admin:chat:snapshot", snapshot()); }
function append(io: Server, message: ChatMessage): void {
  const list = histories.get(message.channel) || [];
  list.push(message);
  if (list.length > MAX_CHANNEL_MESSAGES) list.splice(0, list.length - MAX_CHANNEL_MESSAGES);
  histories.set(message.channel, list);
  io.to(chatRoom(message.channel)).emit("chat:message", message);
  io.to(ADMIN_ROOM).emit("admin:chat:message", message);
  emitAdminSnapshot(io);
}
function system(io: Server, channel: string, text: string): void { append(io, { id: randomUUID(), channel, type: "system", text, createdAt: Date.now() }); }
function addMember(channel: string, socketId: string): void { const members = activeMembers.get(channel) || new Set<string>(); members.add(socketId); activeMembers.set(channel, members); }
function removeMember(channel: string, socketId: string): void { const members = activeMembers.get(channel); if (!members) return; members.delete(socketId); if (!members.size) activeMembers.delete(channel); }

export function registerSharedChat(io: Server): void {
  io.on("connection", (socket) => {
    const joined = new Map<string, string>();

    socket.on("admin:chat:login", (payload: { password?: string } = {}, callback?: (result: { ok: boolean; message?: string }) => void) => {
      const configured = process.env.ADMIN_CHAT_PASSWORD || "bobadmin";
      if (String(payload.password || "") !== configured) { callback?.({ ok: false, message: "관리자 비밀번호가 올바르지 않습니다." }); return; }
      socket.data.chatAdmin = true;
      socket.join(ADMIN_ROOM);
      callback?.({ ok: true });
      socket.emit("admin:chat:snapshot", snapshot());
    });
    socket.on("admin:chat:request-snapshot", () => {
      if (!socket.data.chatAdmin) { socket.emit("admin:chat:error", { message: "관리자 인증이 필요합니다." }); return; }
      socket.emit("admin:chat:snapshot", snapshot());
    });

    socket.on("chat:join", (payload: JoinPayload = {}) => {
      try {
        const channel = normalizeChannel(payload.channel);
        if (!canAccess(socket, channel)) throw new Error("해당 게임 방의 참가자만 채팅에 참여할 수 있습니다.");
        const nickname = normalizeNickname(payload.nickname);
        if (!joined.has(channel)) {
          joined.set(channel, nickname); addMember(channel, socket.id); socket.join(chatRoom(channel));
          socket.emit("chat:history", { channel, messages: histories.get(channel) || [] });
          system(io, channel, `${nickname}님이 채팅에 참여했습니다.`);
        }
      } catch (error) { socket.emit("chat:error", { message: error instanceof Error ? error.message : "채팅 참여에 실패했습니다." }); }
    });
    socket.on("chat:leave", (payload: { channel?: string } = {}) => {
      try {
        const channel = normalizeChannel(payload.channel); const nickname = joined.get(channel); if (!nickname) return;
        joined.delete(channel); removeMember(channel, socket.id); socket.leave(chatRoom(channel)); system(io, channel, `${nickname}님이 채팅에서 나갔습니다.`);
      } catch { /* ignore invalid leave */ }
    });
    socket.on("chat:send", (payload: SendPayload = {}) => {
      try {
        const channel = normalizeChannel(payload.channel); const nickname = joined.get(channel);
        if (!nickname || !canAccess(socket, channel)) throw new Error("채팅방에 참여 중이 아닙니다.");
        const text = String(payload.text || "").trim().slice(0, MAX_TEXT_LENGTH); if (!text) return;
        const now = Date.now(); const key = `${socket.id}:${channel}`;
        if (now - (lastSentAt.get(key) || 0) < 400) throw new Error("메시지를 너무 빠르게 보내고 있습니다.");
        lastSentAt.set(key, now);
        append(io, { id: randomUUID(), channel, type: "user", playerId: socket.id, nickname, text, createdAt: now });
      } catch (error) { socket.emit("chat:error", { message: error instanceof Error ? error.message : "메시지 전송에 실패했습니다." }); }
    });
    socket.on("disconnect", () => {
      joined.forEach((nickname, channel) => { removeMember(channel, socket.id); system(io, channel, `${nickname}님의 연결이 종료되었습니다.`); });
      joined.clear();
    });
  });
}
