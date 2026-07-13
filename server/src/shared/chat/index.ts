import type { Server, Socket } from "socket.io";
import { createHash, randomUUID } from "crypto";

export type ChatMessage = {
  id: string;
  channel: string;
  type: "user" | "system";
  playerId?: string;
  nickname?: string;
  text: string;
  createdAt: number;
};

export type AdminGameRoom = {
  gameId: "bobartist" | "yacht-dice" | "indian-poker";
  roomCode: string;
  state: string;
  playerCount: number;
  maxPlayers: number;
  players: Array<{ id: string; nickname: string; isHost: boolean }>;
  detail: Record<string, string | number | boolean | null>;
  updatedAt: number;
};

type JoinPayload = { channel?: string; nickname?: string; clientId?: string };
type SendPayload = { channel?: string; text?: string };
type AdminChannelSummary = { channel: string; gameId: string; roomCode: string; messageCount: number; activeUsers: number; lastMessageAt: number };
type NicknameHistory = { nickname: string; firstUsedAt: number; lastUsedAt: number; useCount: number };
type AccessHistory = { gameId: string; roomCode: string; joinedAt: number; lastSeenAt: number };
type PlayerAccessRecord = {
  clientId: string;
  connectionKey: string;
  maskedIp: string;
  firstSeenAt: number;
  lastSeenAt: number;
  connectionCount: number;
  nicknames: NicknameHistory[];
  accesses: AccessHistory[];
};

const MAX_CHANNEL_MESSAGES = 100;
const MAX_TEXT_LENGTH = 200;
const MAX_PLAYER_RECORDS = 1000;
const MAX_NICKNAMES = 20;
const MAX_ACCESS_HISTORY = 100;
const PLAYER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ADMIN_ROOM = "chat-admin-monitor";
const histories = new Map<string, ChatMessage[]>();
const lastSentAt = new Map<string, number>();
const activeMembers = new Map<string, Set<string>>();
const playerAccessRecords = new Map<string, PlayerAccessRecord>();

function normalizeChannel(value: unknown): string {
  const channel = String(value || "").trim().toLowerCase();
  if (!/^\/chat\/game\/(bobartist|yacht-dice|indian-poker)\/\d{6}$/.test(channel)) throw new Error("유효하지 않은 채팅 채널입니다.");
  return channel;
}
function normalizeNickname(value: unknown): string { const nickname = String(value || "").trim().slice(0, 16); return nickname || "익명"; }
function normalizeClientId(value: unknown): string {
  const clientId = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(clientId) ? clientId : `legacy_${randomUUID()}`;
}
function chatRoom(channel: string): string { return `chat-channel:${channel}`; }
function channelInfo(channel: string): { gameId: "bobartist" | "yacht-dice" | "indian-poker"; roomCode: string } {
  const parts = channel.split("/");
  return { gameId: parts[3] === "bobartist" ? "bobartist" : "yacht-dice", roomCode: parts[4] || "" };
}
function canAccess(socket: Socket, channel: string): boolean {
  const { gameId, roomCode } = channelInfo(channel);
  if (gameId === "bobartist") return socket.rooms.has(roomCode);
  if (gameId === "indian-poker") return socket.rooms.has(`indian-poker:${roomCode}`);
  return socket.rooms.has(`yacht:${roomCode}`);
}
function rawIp(socket: Socket): string {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || socket.handshake.address || "unknown");
  return value.split(",")[0].trim().replace(/^::ffff:/, "");
}
function maskIp(ip: string): string {
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return parts.length === 4 ? `${parts[0]}.***.***.${parts[3]}` : "IPv4 masked";
  }
  if (ip.includes(":")) {
    const parts = ip.split(":").filter(Boolean);
    return `${parts.slice(0, 2).join(":")}:****:****`;
  }
  return "unknown";
}
function connectionKey(clientId: string): string {
  return `USR-${createHash("sha256").update(clientId).digest("hex").slice(0, 8).toUpperCase()}`;
}
function cleanPlayerRecords(): void {
  const cutoff = Date.now() - PLAYER_RETENTION_MS;
  for (const [key, record] of playerAccessRecords) if (record.lastSeenAt < cutoff) playerAccessRecords.delete(key);
  if (playerAccessRecords.size <= MAX_PLAYER_RECORDS) return;
  [...playerAccessRecords.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt).slice(0, playerAccessRecords.size - MAX_PLAYER_RECORDS).forEach((record) => playerAccessRecords.delete(record.clientId));
}
function trackPlayer(socket: Socket, clientId: string, nickname: string, channel: string): void {
  cleanPlayerRecords();
  const now = Date.now();
  const info = channelInfo(channel);
  const existing = playerAccessRecords.get(clientId);
  const record: PlayerAccessRecord = existing || {
    clientId,
    connectionKey: connectionKey(clientId),
    maskedIp: maskIp(rawIp(socket)),
    firstSeenAt: now,
    lastSeenAt: now,
    connectionCount: 0,
    nicknames: [],
    accesses: [],
  };
  record.lastSeenAt = now;
  record.maskedIp = maskIp(rawIp(socket));
  record.connectionCount += 1;
  const nick = record.nicknames.find((item) => item.nickname === nickname);
  if (nick) { nick.lastUsedAt = now; nick.useCount += 1; }
  else record.nicknames.unshift({ nickname, firstUsedAt: now, lastUsedAt: now, useCount: 1 });
  record.nicknames = record.nicknames.sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_NICKNAMES);
  const latest = record.accesses[0];
  if (latest && latest.gameId === info.gameId && latest.roomCode === info.roomCode && now - latest.lastSeenAt < 60_000) latest.lastSeenAt = now;
  else record.accesses.unshift({ ...info, joinedAt: now, lastSeenAt: now });
  record.accesses = record.accesses.slice(0, MAX_ACCESS_HISTORY);
  playerAccessRecords.set(clientId, record);
}
function channelSummaries(): AdminChannelSummary[] {
  const channels = new Set([...histories.keys(), ...activeMembers.keys()]);
  return [...channels].map((channel) => {
    const list = histories.get(channel) || [];
    const info = channelInfo(channel);
    return { channel, ...info, messageCount: list.length, activeUsers: activeMembers.get(channel)?.size || 0, lastMessageAt: list.at(-1)?.createdAt || 0 };
  }).sort((a, b) => b.lastMessageAt - a.lastMessageAt || a.channel.localeCompare(b.channel));
}
function buildSnapshot(getGameRooms: () => AdminGameRoom[]) {
  cleanPlayerRecords();
  return {
    channels: channelSummaries(),
    histories: Object.fromEntries(histories),
    gameRooms: getGameRooms(),
    players: [...playerAccessRecords.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt),
  };
}
function emitAdminSnapshot(io: Server, getGameRooms: () => AdminGameRoom[]): void { io.to(ADMIN_ROOM).emit("admin:chat:snapshot", buildSnapshot(getGameRooms)); }
function append(io: Server, getGameRooms: () => AdminGameRoom[], message: ChatMessage): void {
  const list = histories.get(message.channel) || [];
  list.push(message);
  if (list.length > MAX_CHANNEL_MESSAGES) list.splice(0, list.length - MAX_CHANNEL_MESSAGES);
  histories.set(message.channel, list);
  io.to(chatRoom(message.channel)).emit("chat:message", message);
  io.to(ADMIN_ROOM).emit("admin:chat:message", message);
  emitAdminSnapshot(io, getGameRooms);
}
function system(io: Server, getGameRooms: () => AdminGameRoom[], channel: string, text: string): void { append(io, getGameRooms, { id: randomUUID(), channel, type: "system", text, createdAt: Date.now() }); }
function addMember(channel: string, socketId: string): void { const members = activeMembers.get(channel) || new Set<string>(); members.add(socketId); activeMembers.set(channel, members); }
function removeMember(channel: string, socketId: string): void { const members = activeMembers.get(channel); if (!members) return; members.delete(socketId); if (!members.size) activeMembers.delete(channel); }

export function registerSharedChat(io: Server, getGameRooms: () => AdminGameRoom[] = () => []): void {
  io.on("connection", (socket) => {
    const joined = new Map<string, { nickname: string; clientId: string }>();

    socket.on("admin:chat:login", (payload: { password?: string } = {}, callback?: (result: { ok: boolean; message?: string }) => void) => {
      const configured = process.env.ADMIN_CHAT_PASSWORD || "bobadmin";
      if (String(payload.password || "") !== configured) { callback?.({ ok: false, message: "관리자 비밀번호가 올바르지 않습니다." }); return; }
      socket.data.chatAdmin = true;
      socket.join(ADMIN_ROOM);
      callback?.({ ok: true });
      socket.emit("admin:chat:snapshot", buildSnapshot(getGameRooms));
    });
    socket.on("admin:chat:request-snapshot", () => {
      if (!socket.data.chatAdmin) { socket.emit("admin:chat:error", { message: "관리자 인증이 필요합니다." }); return; }
      socket.emit("admin:chat:snapshot", buildSnapshot(getGameRooms));
    });

    socket.on("chat:join", (payload: JoinPayload = {}) => {
      try {
        const channel = normalizeChannel(payload.channel);
        if (!canAccess(socket, channel)) throw new Error("해당 게임 방의 참가자만 채팅에 참여할 수 있습니다.");
        const nickname = normalizeNickname(payload.nickname);
        const clientId = normalizeClientId(payload.clientId);
        if (!joined.has(channel)) {
          joined.set(channel, { nickname, clientId });
          trackPlayer(socket, clientId, nickname, channel);
          addMember(channel, socket.id);
          socket.join(chatRoom(channel));
          socket.emit("chat:history", { channel, messages: histories.get(channel) || [] });
          system(io, getGameRooms, channel, `${nickname}님이 채팅에 참여했습니다.`);
        }
      } catch (error) { socket.emit("chat:error", { message: error instanceof Error ? error.message : "채팅 참여에 실패했습니다." }); }
    });
    socket.on("chat:leave", (payload: { channel?: string } = {}) => {
      try {
        const channel = normalizeChannel(payload.channel); const member = joined.get(channel); if (!member) return;
        joined.delete(channel); removeMember(channel, socket.id); socket.leave(chatRoom(channel)); system(io, getGameRooms, channel, `${member.nickname}님이 채팅에서 나갔습니다.`);
      } catch { /* ignore invalid leave */ }
    });
    socket.on("chat:send", (payload: SendPayload = {}) => {
      try {
        const channel = normalizeChannel(payload.channel); const member = joined.get(channel);
        if (!member || !canAccess(socket, channel)) throw new Error("채팅방에 참여 중이 아닙니다.");
        const text = String(payload.text || "").trim().slice(0, MAX_TEXT_LENGTH); if (!text) return;
        const now = Date.now(); const key = `${socket.id}:${channel}`;
        if (now - (lastSentAt.get(key) || 0) < 400) throw new Error("메시지를 너무 빠르게 보내고 있습니다.");
        lastSentAt.set(key, now);
        append(io, getGameRooms, { id: randomUUID(), channel, type: "user", playerId: socket.id, nickname: member.nickname, text, createdAt: now });
      } catch (error) { socket.emit("chat:error", { message: error instanceof Error ? error.message : "메시지 전송에 실패했습니다." }); }
    });
    socket.on("disconnect", () => {
      joined.forEach((member, channel) => { removeMember(channel, socket.id); system(io, getGameRooms, channel, `${member.nickname}님의 연결이 종료되었습니다.`); });
      joined.clear();
    });
  });
}
