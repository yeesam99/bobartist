import type { Server, Socket } from "socket.io";

type Suit = "spades" | "hearts" | "diamonds" | "clubs";
type Rank = "A" | "K" | "Q" | "J" | "10" | "9" | "8" | "7" | "6" | "5" | "4" | "3" | "2";
type Card = { suit: Suit; rank: Rank; value: number };
type PokerPlayer = {
  id: string; name: string; ready: boolean; isHost: boolean; joinedAt: number;
  chips: number; roundBet: number; contribution: number; folded: boolean; allIn: boolean;
};
type PotResult = { amount: number; eligibleIds: string[]; winnerIds: string[] };
type PokerState = {
  phase: "betting" | "revealed"; round: number; cards: Record<string, Card>; winnerIds: string[];
  pot: number; ante: number; currentBet: number; currentTurnId: string; actedIds: string[];
  lastAction: string; potResults: PotResult[]; tournamentWinnerId: string; nextRoundAt: number;
};
type PokerRoom = {
  code: string; hostId: string; state: "lobby" | "playing" | "revealed"; startingChips: number;
  players: PokerPlayer[]; game: PokerState | null; nextStarterIndex: number; createdAt: number; updatedAt: number;
};
type PlayerRequest = { playerName?: string; roomCode?: string; startingChips?: number };
type BetRequest = { amount?: number };

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const ANTE = 100;
const STARTING_CHIP_OPTIONS = [1000, 3000, 5000, 10000] as const;
const BET_OPTIONS = [100, 500, 1000] as const;
const AUTO_NEXT_ROUND_DELAY_MS = 5000;
const rooms = new Map<string, PokerRoom>();
const roundTimers = new Map<string, NodeJS.Timeout>();
const ranks: Rank[] = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];

const freshRoundFields = () => ({ roundBet: 0, contribution: 0, folded: false, allIn: false });
function normalizeName(value?: string): string { const name = (value || "").trim(); return name ? name.slice(0, 16) : "익명"; }
function normalizeCode(value?: string): string { return (value || "").replace(/\D/g, "").slice(0, 6); }
function normalizeStartingChips(value?: number): number { return STARTING_CHIP_OPTIONS.includes(value as never) ? Number(value) : 10000; }
function createCode(): string { let code = ""; do code = String(Math.floor(100000 + Math.random() * 900000)); while (rooms.has(code)); return code; }
function buildDeck(): Card[] { return suits.flatMap((suit) => ranks.map((rank, index) => ({ suit, rank, value: ranks.length - index }))); }
function shuffle<T>(items: T[]): T[] { const copy = [...items]; for (let i = copy.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
function clearRoundTimer(roomCode: string): void { const timer=roundTimers.get(roomCode); if(timer){clearTimeout(timer);roundTimers.delete(roomCode);} }
function canStart(room: PokerRoom): boolean { return room.state === "lobby" && room.players.length >= MIN_PLAYERS && room.players.length <= MAX_PLAYERS && room.players.every((p) => p.isHost || p.ready); }
function roundPlayers(room: PokerRoom): PokerPlayer[] { return room.players.filter((p) => Boolean(room.game?.cards[p.id])); }
function contenders(room: PokerRoom): PokerPlayer[] { return roundPlayers(room).filter((p) => !p.folded); }
function actionable(room: PokerRoom): PokerPlayer[] { return contenders(room).filter((p) => !p.allIn && p.chips > 0); }
function toPublic(room: PokerRoom) {
  return { code: room.code, state: room.state, playerCount: room.players.length, maxPlayers: MAX_PLAYERS, canStart: canStart(room), startingChips: room.startingChips,
    players: room.players.map((p) => ({ id:p.id,name:p.name,ready:p.ready,isHost:p.isHost,chips:p.chips,roundBet:p.roundBet,contribution:p.contribution,folded:p.folded,allIn:p.allIn })),
    createdAt: room.createdAt, updatedAt: room.updatedAt };
}
function toPublicGame(room: PokerRoom, viewerId: string) {
  if (!room.game) return null;
  const revealed = room.game.phase === "revealed";
  return { roomCode:room.code,phase:room.game.phase,round:room.game.round,
    cards:Object.fromEntries(room.players.map((p)=>[p.id,p.id===viewerId&&!revealed?null:room.game?.cards[p.id]||null])),
    winnerIds:[...room.game.winnerIds],pot:room.game.pot,ante:room.game.ante,currentBet:room.game.currentBet,currentTurnId:room.game.currentTurnId,
    actedIds:[...room.game.actedIds],lastAction:room.game.lastAction,potResults:room.game.potResults.map((p)=>({...p,eligibleIds:[...p.eligibleIds],winnerIds:[...p.winnerIds]})),tournamentWinnerId:room.game.tournamentWinnerId,nextRoundAt:room.game.nextRoundAt };
}
function emitRoomList(io: Server): void { io.emit("indian-poker:room-list", [...rooms.values()].filter((r)=>r.state==="lobby").sort((a,b)=>b.createdAt-a.createdAt).map(toPublic)); }
function emitRoom(io: Server, room: PokerRoom): void { io.to(`indian-poker:${room.code}`).emit("indian-poker:room-state",toPublic(room)); for(const p of room.players) io.to(p.id).emit("indian-poker:game-state",toPublicGame(room,p.id)); emitRoomList(io); }
function emitError(socket: Socket, message: string): void { socket.emit("indian-poker:error", { message }); }
function findRoom(socketId: string): PokerRoom|undefined { return [...rooms.values()].find((r)=>r.players.some((p)=>p.id===socketId)); }
function nextPlayerId(room: PokerRoom, currentId: string): string {
  const candidates = actionable(room); if (!candidates.length) return "";
  const all = room.players; const start = all.findIndex((p)=>p.id===currentId);
  for(let step=1; step<=all.length; step+=1){ const candidate=all[(start+step+all.length)%all.length]; if(candidates.some((p)=>p.id===candidate.id)) return candidate.id; }
  return candidates[0].id;
}
function bettingComplete(room: PokerRoom): boolean {
  if(!room.game) return false;
  const live=contenders(room); if(live.length<=1) return true;
  const canAct=actionable(room); if(!canAct.length) return true;
  return canAct.every((p)=>room.game?.actedIds.includes(p.id)&&p.roundBet===room.game?.currentBet);
}
function buildPotResults(room: PokerRoom): PotResult[] {
  if(!room.game) return [];
  const participants=roundPlayers(room).filter((p)=>p.contribution>0);
  const levels=[...new Set(participants.map((p)=>p.contribution))].sort((a,b)=>a-b);
  const results:PotResult[]=[]; let previous=0;
  for(const level of levels){
    const contributors=participants.filter((p)=>p.contribution>=level);
    const amount=(level-previous)*contributors.length; previous=level; if(amount<=0) continue;
    const eligible=contributors.filter((p)=>!p.folded);
    if(!eligible.length) continue;
    const best=Math.max(...eligible.map((p)=>room.game?.cards[p.id]?.value||0));
    const winners=eligible.filter((p)=>(room.game?.cards[p.id]?.value||0)===best);
    const share=Math.floor(amount/winners.length); let remainder=amount-share*winners.length;
    for(const winner of winners){ winner.chips+=share+(remainder>0?1:0); if(remainder>0) remainder-=1; }
    results.push({amount,eligibleIds:eligible.map((p)=>p.id),winnerIds:winners.map((p)=>p.id)});
  }
  return results;
}
function scheduleAutomaticNextRound(io: Server, room: PokerRoom): void {
  clearRoundTimer(room.code);
  if(!room.game || room.game.tournamentWinnerId) return;
  room.game.nextRoundAt=Date.now()+AUTO_NEXT_ROUND_DELAY_MS;
  const timer=setTimeout(()=>{
    roundTimers.delete(room.code);
    const current=rooms.get(room.code);
    if(!current?.game || current.state!=="revealed" || current.game.tournamentWinnerId) return;
    startRound(io,current);
  },AUTO_NEXT_ROUND_DELAY_MS);
  roundTimers.set(room.code,timer);
}
function revealAndPay(io: Server, room: PokerRoom): void {
  if(!room.game) return;
  const live=contenders(room);
  if(!live.length) return;
  room.game.potResults=buildPotResults(room);
  room.game.winnerIds=[...new Set(room.game.potResults.flatMap((p)=>p.winnerIds))];
  room.game.phase="revealed"; room.game.currentTurnId=""; room.state="revealed";
  const winnerNames=room.players.filter((p)=>room.game?.winnerIds.includes(p.id)).map((p)=>p.name);
  const remaining=room.players.filter((p)=>p.chips>0);
  room.game.tournamentWinnerId=remaining.length===1?remaining[0].id:"";
  room.game.lastAction=room.game.tournamentWinnerId?`${remaining[0].name} 최종 우승`:`${winnerNames.join(", ")} 승리 · Pot ${room.game.pot.toLocaleString()} 정산`;
  room.game.nextRoundAt=0;
  scheduleAutomaticNextRound(io,room);
  room.updatedAt=Date.now(); emitRoom(io,room);
}
function advanceTurnOrReveal(io: Server, room: PokerRoom): void {
  if(!room.game) return;
  if(bettingComplete(room)){ revealAndPay(io,room); return; }
  room.game.currentTurnId=nextPlayerId(room,room.game.currentTurnId);
  if(!room.game.currentTurnId){ revealAndPay(io,room); return; }
  room.updatedAt=Date.now(); emitRoom(io,room);
}
function leaveRoom(io: Server, socket: Socket): void {
  const room=findRoom(socket.id); if(!room) return;
  room.players=room.players.filter((p)=>p.id!==socket.id); socket.leave(`indian-poker:${room.code}`);
  if(!room.players.length){clearRoundTimer(room.code);rooms.delete(room.code);emitRoomList(io);return;}
  if(room.hostId===socket.id){room.hostId=room.players[0].id;room.players=room.players.map((p,i)=>({...p,isHost:i===0,ready:i===0?true:p.ready}));}
  if(room.state!=="lobby"){clearRoundTimer(room.code);room.state="lobby";room.game=null;room.players=room.players.map((p)=>({...p,ready:p.isHost,chips:room.startingChips,...freshRoundFields()}));}
  room.updatedAt=Date.now();emitRoom(io,room);
}
function startRound(io: Server, room: PokerRoom): void {
  clearRoundTimer(room.code);
  const playing=room.players.filter((p)=>p.chips>0);
  if(playing.length<MIN_PLAYERS){ if(room.game){room.game.tournamentWinnerId=playing[0]?.id||"";room.game.lastAction=playing[0]?`${playing[0].name} 최종 우승`:"게임 종료";emitRoom(io,room);} return; }
  const deck=shuffle(buildDeck()); const cards=Object.fromEntries(playing.map((p,i)=>[p.id,deck[i]])); let pot=0;
  room.players=room.players.map((p)=>{ if(p.chips<=0)return{...p,...freshRoundFields()};const paid=Math.min(ANTE,p.chips);pot+=paid;return{...p,chips:p.chips-paid,roundBet:0,contribution:paid,folded:false,allIn:p.chips-paid===0};});
  let first="";
  for(let step=0;step<room.players.length;step+=1){const index=(room.nextStarterIndex+step)%room.players.length;const candidate=room.players[index];if(cards[candidate.id]&&!candidate.allIn){first=candidate.id;room.nextStarterIndex=(index+1)%room.players.length;break;}}
  room.state="playing";room.game={phase:"betting",round:(room.game?.round||0)+1,cards,winnerIds:[],pot,ante:ANTE,currentBet:0,currentTurnId:first,actedIds:[],lastAction:`Ante ${ANTE.toLocaleString()} Chips가 Pot에 모였습니다.`,potResults:[],tournamentWinnerId:"",nextRoundAt:0};
  room.updatedAt=Date.now();emitRoom(io,room);io.to(`indian-poker:${room.code}`).emit("indian-poker:game-started",{message:`Ante ${ANTE.toLocaleString()} Chips를 내고 베팅 라운드를 시작합니다.`});
  if(!first) revealAndPay(io,room);
}
function ensureTurn(socket:Socket,room:PokerRoom):boolean{if(!room.game||room.game.phase!=="betting"||room.state!=="playing"){emitError(socket,"현재 베팅 중인 라운드가 아닙니다.");return false;}if(room.game.currentTurnId!==socket.id){emitError(socket,"현재 본인의 차례가 아닙니다.");return false;}return true;}
function pay(player:PokerPlayer,amount:number,room:PokerRoom):void{player.chips-=amount;player.roundBet+=amount;player.contribution+=amount;if(room.game)room.game.pot+=amount;if(player.chips===0)player.allIn=true;}

export function getIndianPokerAdminRooms(){return[...rooms.values()].map((room)=>({gameId:"indian-poker" as const,roomCode:room.code,state:room.state,playerCount:room.players.length,maxPlayers:MAX_PLAYERS,players:room.players.map((p)=>({id:p.id,nickname:p.name,isHost:p.isHost})),detail:{phase:room.game?.phase||room.state,round:room.game?.round||0,pot:room.game?.pot||0},updatedAt:room.updatedAt}));}

export function registerIndianPoker(io:Server):void{
  io.on("connection",(socket)=>{
    socket.on("indian-poker:request-room-list",()=>emitRoomList(io));
    socket.on("indian-poker:create-room",(payload:PlayerRequest={})=>{leaveRoom(io,socket);const now=Date.now(),startingChips=normalizeStartingChips(payload.startingChips);const room:PokerRoom={code:createCode(),hostId:socket.id,state:"lobby",startingChips,players:[{id:socket.id,name:normalizeName(payload.playerName),ready:true,isHost:true,joinedAt:now,chips:startingChips,...freshRoundFields()}],game:null,nextStarterIndex:0,createdAt:now,updatedAt:now};rooms.set(room.code,room);socket.join(`indian-poker:${room.code}`);socket.emit("indian-poker:room-created",toPublic(room));emitRoom(io,room);});
    socket.on("indian-poker:join-room",(payload:PlayerRequest={})=>{const room=rooms.get(normalizeCode(payload.roomCode));if(!room)return emitError(socket,"존재하지 않는 방입니다.");if(room.state!=="lobby")return emitError(socket,"이미 게임이 시작된 방입니다.");if(room.players.length>=MAX_PLAYERS)return emitError(socket,"방 인원이 가득 찼습니다.");leaveRoom(io,socket);room.players.push({id:socket.id,name:normalizeName(payload.playerName),ready:false,isHost:false,joinedAt:Date.now(),chips:room.startingChips,...freshRoundFields()});room.updatedAt=Date.now();socket.join(`indian-poker:${room.code}`);socket.emit("indian-poker:room-joined",toPublic(room));emitRoom(io,room);});
    socket.on("indian-poker:leave-room",()=>{leaveRoom(io,socket);socket.emit("indian-poker:room-left");});
    socket.on("indian-poker:toggle-ready",()=>{const room=findRoom(socket.id);if(!room||room.state!=="lobby")return;room.players=room.players.map((p)=>p.id===socket.id&&!p.isHost?{...p,ready:!p.ready}:p);room.updatedAt=Date.now();emitRoom(io,room);});
    socket.on("indian-poker:start-game",()=>{const room=findRoom(socket.id);if(!room)return emitError(socket,"참여 중인 방이 없습니다.");if(room.hostId!==socket.id)return emitError(socket,"방장만 게임을 시작할 수 있습니다.");if(!canStart(room))return emitError(socket,"2~6명이 참가할 수 있으며 모든 참가자가 Ready여야 합니다.");room.nextStarterIndex=0;room.players=room.players.map((p)=>({...p,chips:room.startingChips,...freshRoundFields()}));startRound(io,room);});
    socket.on("indian-poker:check",()=>{const room=findRoom(socket.id);if(!room||!ensureTurn(socket,room)||!room.game)return;const p=room.players.find((x)=>x.id===socket.id);if(!p)return;if(p.roundBet!==room.game.currentBet)return emitError(socket,"현재 베팅 금액을 먼저 Call해야 합니다.");if(!room.game.actedIds.includes(p.id))room.game.actedIds.push(p.id);room.game.lastAction=`${p.name} Check`;advanceTurnOrReveal(io,room);});
    socket.on("indian-poker:bet",(payload:BetRequest={})=>{const room=findRoom(socket.id);if(!room||!ensureTurn(socket,room)||!room.game)return;const amount=Number(payload.amount);if(!BET_OPTIONS.includes(amount as never))return emitError(socket,"Bet은 100, 500, 1000 Chips만 가능합니다.");if(room.game.currentBet>0)return emitError(socket,"이미 Bet이 있습니다. Call 또는 Raise를 선택해 주세요.");const p=room.players.find((x)=>x.id===socket.id);if(!p)return;if(amount>=p.chips)return emitError(socket,"보유 Chips 전체를 베팅하려면 All In을 선택해 주세요.");pay(p,amount,room);room.game.currentBet=p.roundBet;room.game.actedIds=[p.id];room.game.lastAction=`${p.name} Bet ${amount.toLocaleString()}`;advanceTurnOrReveal(io,room);});
    socket.on("indian-poker:call",()=>{const room=findRoom(socket.id);if(!room||!ensureTurn(socket,room)||!room.game)return;const p=room.players.find((x)=>x.id===socket.id);if(!p)return;const amount=room.game.currentBet-p.roundBet;if(amount<=0)return emitError(socket,"Call할 금액이 없습니다. Check를 선택해 주세요.");if(p.chips<=amount)return emitError(socket,"보유 Chips 전체를 사용하려면 All In을 선택해 주세요.");pay(p,amount,room);if(!room.game.actedIds.includes(p.id))room.game.actedIds.push(p.id);room.game.lastAction=`${p.name} Call ${amount.toLocaleString()}`;advanceTurnOrReveal(io,room);});
    socket.on("indian-poker:raise",(payload:BetRequest={})=>{const room=findRoom(socket.id);if(!room||!ensureTurn(socket,room)||!room.game)return;const raise=Number(payload.amount);if(!BET_OPTIONS.includes(raise as never))return emitError(socket,"Raise는 100, 500, 1000 Chips 단위만 가능합니다.");if(room.game.currentBet<=0)return emitError(socket,"첫 베팅은 Bet을 선택해 주세요.");const p=room.players.find((x)=>x.id===socket.id);if(!p)return;const total=(room.game.currentBet-p.roundBet)+raise;if(total>=p.chips)return emitError(socket,"보유 Chips 전체를 사용하려면 All In을 선택해 주세요.");pay(p,total,room);room.game.currentBet=p.roundBet;room.game.actedIds=[p.id];room.game.lastAction=`${p.name} Raise +${raise.toLocaleString()} · ${p.roundBet.toLocaleString()}`;advanceTurnOrReveal(io,room);});
    socket.on("indian-poker:fold",()=>{const room=findRoom(socket.id);if(!room||!ensureTurn(socket,room)||!room.game)return;const p=room.players.find((x)=>x.id===socket.id);if(!p)return;p.folded=true;if(!room.game.actedIds.includes(p.id))room.game.actedIds.push(p.id);room.game.lastAction=`${p.name} Fold`;advanceTurnOrReveal(io,room);});
    socket.on("indian-poker:all-in",()=>{const room=findRoom(socket.id);if(!room||!ensureTurn(socket,room)||!room.game)return;const p=room.players.find((x)=>x.id===socket.id);if(!p||p.chips<=0)return emitError(socket,"All In할 Chips가 없습니다.");const amount=p.chips;pay(p,amount,room);if(p.roundBet>room.game.currentBet){room.game.currentBet=p.roundBet;room.game.actedIds=[p.id];}else if(!room.game.actedIds.includes(p.id))room.game.actedIds.push(p.id);room.game.lastAction=`${p.name} All In ${amount.toLocaleString()}`;advanceTurnOrReveal(io,room);});
    socket.on("indian-poker:next-round",()=>{const room=findRoom(socket.id);if(!room?.game||room.state!=="revealed")return emitError(socket,"현재 라운드가 아직 종료되지 않았습니다.");if(room.hostId!==socket.id)return emitError(socket,"방장만 다음 라운드를 시작할 수 있습니다.");if(room.game.tournamentWinnerId)return emitError(socket,"최종 우승자가 결정되었습니다. 새 게임을 시작해 주세요.");startRound(io,room);});
    socket.on("indian-poker:restart-game",()=>{const room=findRoom(socket.id);if(!room?.game||!room.game.tournamentWinnerId)return emitError(socket,"최종 우승이 결정된 뒤 새 게임을 시작할 수 있습니다.");if(room.hostId!==socket.id)return emitError(socket,"방장만 새 게임을 시작할 수 있습니다.");clearRoundTimer(room.code);room.nextStarterIndex=0;room.players=room.players.map((p)=>({...p,chips:room.startingChips,ready:p.isHost,...freshRoundFields()}));room.state="playing";startRound(io,room);});
    socket.on("disconnect",()=>leaveRoom(io,socket));
  });
}
