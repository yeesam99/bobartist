import { io, type Socket } from "socket.io-client";
import { syncRoomChat } from "../../shared/chat";
import "./style.css";

export const INDIAN_POKER_MODULE_VERSION = "0.0.63";
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";
type Card = { suit: "spades"|"hearts"|"diamonds"|"clubs"; rank: string; value: number };
type Room = { code:string; state:"lobby"|"playing"|"revealed"; playerCount:number; maxPlayers:number; canStart:boolean; players:Array<{id:string;name:string;ready:boolean;isHost:boolean}> };
type Game = { roomCode:string; phase:"playing"|"revealed"; round:number; cards:Record<string,Card|null>; winnerIds:string[] };
let socket: Socket | null = null; let room: Room | null = null; let game: Game | null = null; let roomList: Room[] = []; let status = "서버에 연결 중입니다.";
const app = () => { const el=document.querySelector<HTMLDivElement>("#app"); if(!el) throw new Error("#app element not found"); return el; };
const esc = (v:string) => v.replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]||c));
const getName=()=> (localStorage.getItem("bobplatform.playerName")||localStorage.getItem("bobartist.playerName")||"").trim();
function saveName(v:string){ const n=v.trim().slice(0,16); localStorage.setItem("bobplatform.playerName",n); localStorage.setItem("bobartist.playerName",n); }
function suitSymbol(card:Card){ return ({spades:"♠",hearts:"♥",diamonds:"♦",clubs:"♣"})[card.suit]; }
function cardHtml(card:Card|null, hidden=false){ if(hidden||!card) return `<div class="poker-card hidden"><strong>?</strong><span>내 카드는 볼 수 없습니다</span></div>`; const red=card.suit==="hearts"||card.suit==="diamonds"; return `<div class="poker-card ${red?"red":""}"><strong>${card.rank}</strong><b>${suitSymbol(card)}</b></div>`; }
function render(){ document.body.classList.add("poker-body"); syncRoomChat(socket&&room?{socket,gameId:"indian-poker",roomCode:room.code,nickname:getName()}:null); if(room&&game) renderGame(); else if(room) renderRoom(); else renderLobby(); }
function header(backId:string,label:string){ return `<header class="poker-header"><button id="${backId}" class="poker-back" type="button">← ${label}</button><div><h1>Bob Indian Poker</h1><span>v${INDIAN_POKER_MODULE_VERSION}</span></div></header>`; }
function renderLobby(){ app().innerHTML=`<main class="poker-shell">${header("backPlatform","BobPlatform")}<section class="poker-grid"><article class="poker-panel"><p class="kicker">CLASSIC MULTIPLAYER</p><h2>게임 참가</h2><label>닉네임<input id="playerName" maxlength="16" value="${esc(getName())}" placeholder="닉네임을 입력하세요"></label><button id="createRoom" class="primary">새 방 만들기</button><div class="divider">또는 방 코드로 입장</div><div class="code-row"><input id="roomCode" maxlength="6" inputmode="numeric" placeholder="6자리 방 코드"><button id="joinRoom">입장</button></div><p class="status">${esc(status)}</p></article><article class="poker-panel"><div class="panel-title"><div><p class="kicker">OPEN ROOMS</p><h2>방 목록</h2></div><button id="refreshRooms">새로고침</button></div><div class="room-list">${roomList.length?roomList.map(r=>`<button class="room-item" data-code="${r.code}"><span><strong>${r.code}</strong><small>대기 중</small></span><em>${r.playerCount}/${r.maxPlayers}</em></button>`).join(""):`<p class="empty">현재 참가 가능한 방이 없습니다.</p>`}</div></article></section></main>`;
 document.querySelector<HTMLButtonElement>("#backPlatform")?.addEventListener("click",()=>{location.hash="/";location.reload();}); document.querySelector<HTMLButtonElement>("#createRoom")?.addEventListener("click",()=>joinOrCreate(true)); document.querySelector<HTMLButtonElement>("#joinRoom")?.addEventListener("click",()=>joinOrCreate(false)); document.querySelector<HTMLButtonElement>("#refreshRooms")?.addEventListener("click",()=>socket?.emit("indian-poker:request-room-list")); document.querySelectorAll<HTMLButtonElement>("[data-code]").forEach(b=>b.addEventListener("click",()=>joinOrCreate(false,b.dataset.code)));
}
function joinOrCreate(create:boolean,code?:string){ const input=document.querySelector<HTMLInputElement>("#playerName"); const name=(input?.value||getName()).trim(); if(!name){status="닉네임을 입력해 주세요.";render();return;} saveName(name); socket?.emit(create?"indian-poker:create-room":"indian-poker:join-room",{playerName:name,roomCode:code||document.querySelector<HTMLInputElement>("#roomCode")?.value}); }
function playersHtml(){ return room?.players.map(p=>`<div class="player ${p.id===socket?.id?"me":""}"><span><strong>${esc(p.name)}</strong>${p.isHost?"<small>방장</small>":""}</span><em class="${p.ready?"ready":"waiting"}">${p.isHost?"HOST":p.ready?"READY":"WAITING"}</em></div>`).join("")||""; }
function renderRoom(){ if(!room||!socket)return; const me=room.players.find(p=>p.id===socket?.id); app().innerHTML=`<main class="poker-shell">${header("leaveRoom","방 나가기")}<section class="poker-grid"><article class="poker-panel hero"><p class="kicker">ROOM CODE</p><h2 class="room-code">${room.code}</h2><p>친구에게 방 코드를 알려주세요.</p><div class="rule-box"><strong>v0.0.63 포커 테이블 UI</strong><span>2~6명 · 카드 분배 · 상대 카드 확인 · 카드 공개 · 승패 판정</span><small>칩과 베팅은 다음 버전에서 추가됩니다.</small></div></article><article class="poker-panel"><div class="panel-title"><div><p class="kicker">PLAYERS</p><h2>${room.playerCount}/${room.maxPlayers}</h2></div></div><div class="player-list">${playersHtml()}</div>${me?.isHost?`<button id="startGame" class="primary" ${room.canStart?"":"disabled"}>게임 시작</button><p class="help">2~6명, 방장을 제외한 모든 참가자가 Ready여야 합니다.</p>`:`<button id="toggleReady" class="primary">${me?.ready?"Ready 취소":"Ready"}</button>`}<p class="status">${esc(status)}</p></article></section></main>`; document.querySelector<HTMLButtonElement>("#leaveRoom")?.addEventListener("click",()=>socket?.emit("indian-poker:leave-room")); document.querySelector<HTMLButtonElement>("#toggleReady")?.addEventListener("click",()=>socket?.emit("indian-poker:toggle-ready")); document.querySelector<HTMLButtonElement>("#startGame")?.addEventListener("click",()=>socket?.emit("indian-poker:start-game")); }
function playerSeatHtml(player: Room["players"][number], seatClass: string, myId: string, revealed: boolean){
 const card=game?.cards[player.id]||null;
 const initial=esc(player.name.slice(0,1).toUpperCase()||"P");
 return `<article class="table-seat ${seatClass} ${player.id===myId?"is-me":""}">
   <div class="seat-profile"><span class="seat-avatar">${initial}</span><div><strong>${esc(player.name)}${player.id===myId?" (나)":""}</strong><small>${player.isHost?"HOST":"PLAYER"}</small></div></div>
   <div class="seat-card">${cardHtml(card,player.id===myId&&!revealed)}</div>
   <div class="seat-meta"><span>${revealed&&game?.winnerIds.includes(player.id)?"WINNER":"IN GAME"}</span><em>${player.ready||player.isHost?"READY":"WAITING"}</em></div>
 </article>`;
}
function renderGame(){
 if(!room||!game||!socket)return;
 const currentRoom=room; const currentGame=game; const currentSocket=socket;
 const myId=currentSocket.id||""; const me=currentRoom.players.find(p=>p.id===myId);
 const revealed=currentGame.phase==="revealed";
 const winners=currentRoom.players.filter(p=>currentGame.winnerIds.includes(p.id)).map(p=>p.name);
 const opponents=currentRoom.players.filter(p=>p.id!==myId);
 const opponentLayouts:Record<number,string[]>={1:["seat-top"],2:["seat-upper-left","seat-upper-right"],3:["seat-top","seat-left","seat-right"],4:["seat-top","seat-upper-left","seat-upper-right","seat-right"],5:["seat-top","seat-upper-right","seat-lower-right","seat-lower-left","seat-upper-left"]};
 const layout=opponentLayouts[opponents.length]||opponentLayouts[5];
 app().innerHTML=`<main class="poker-shell game-shell">
   ${header("leaveRoom","방 나가기")}
   ${revealed?`<section class="result"><p class="kicker">ROUND ${currentGame.round} RESULT</p><h2>${winners.length>1?`${esc(winners.join(", "))} 공동 승리`:`${esc(winners[0]||"")} 승리`}</h2><p>문양 우열 없이 가장 높은 숫자의 카드가 승리합니다.</p></section>`:""}
   <section class="poker-game-stage">
     <div class="poker-table-wrap">
       <div class="poker-table-felt">
         <div class="table-brand"><span>BOB</span><strong>INDIAN POKER</strong></div>
         <div class="table-center-info">
           <p>ROUND ${currentGame.round}</p>
           <strong>${revealed?"SHOWDOWN":"상대 카드만 확인하세요"}</strong>
           <small>${revealed?"카드 공개가 완료되었습니다.":"자신의 카드는 볼 수 없습니다."}</small>
         </div>
         <div class="deck-stack" aria-hidden="true"><i></i><i></i><i></i></div>
         ${opponents.map((p,i)=>playerSeatHtml(p,layout[i]||"seat-top",myId,revealed)).join("")}
         ${me?playerSeatHtml(me,"seat-bottom",myId,revealed):""}
       </div>
     </div>
     <aside class="game-side-panel">
       <div class="side-summary"><p class="kicker">GAME INFO</p><h2>Round ${currentGame.round}</h2><dl><div><dt>플레이어</dt><dd>${currentRoom.playerCount}/${currentRoom.maxPlayers}</dd></div><div><dt>상태</dt><dd>${revealed?"공개 완료":"진행 중"}</dd></div><div><dt>방 코드</dt><dd>${currentRoom.code}</dd></div></dl></div>
       <div class="turn-message"><span class="turn-dot"></span><strong>${me?.isHost?"방장 조작 가능":"방장 진행 대기"}</strong><small>${revealed?"다음 라운드를 준비합니다.":"현재 버전은 베팅 전 UI 단계입니다."}</small></div>
     </aside>
   </section>
   <section class="poker-action-bar">
     <div class="future-actions" aria-label="다음 버전 베팅 버튼 자리"><button disabled>Check</button><button disabled>Bet</button><button disabled>Call</button><button disabled>Raise</button><button disabled>Fold</button><button disabled>All In</button></div>
     <div class="round-control">${me?.isHost?(revealed?`<button id="nextRound" class="primary">다음 라운드</button>`:`<button id="revealCards" class="primary">카드 공개</button>`):`<p>${revealed?"방장이 다음 라운드를 시작할 수 있습니다.":"방장이 카드를 공개할 때까지 기다려 주세요."}</p>`}</div>
     <p class="status">${esc(status)}</p>
   </section>
 </main>`;
 document.querySelector<HTMLButtonElement>("#leaveRoom")?.addEventListener("click",()=>currentSocket.emit("indian-poker:leave-room"));
 document.querySelector<HTMLButtonElement>("#revealCards")?.addEventListener("click",()=>currentSocket.emit("indian-poker:reveal-cards"));
 document.querySelector<HTMLButtonElement>("#nextRound")?.addEventListener("click",()=>currentSocket.emit("indian-poker:next-round"));
}
export function mountIndianPoker(){ socket=io(SERVER_URL); socket.on("connect",()=>{status="서버에 연결되었습니다.";socket?.emit("indian-poker:request-room-list");render();}); socket.on("connect_error",()=>{status="서버 연결에 실패했습니다.";render();}); socket.on("indian-poker:room-list",(list:Room[])=>{roomList=list;if(!room)render();}); socket.on("indian-poker:room-created",(r:Room)=>{room=r;game=null;status="방을 만들었습니다.";render();}); socket.on("indian-poker:room-joined",(r:Room)=>{room=r;game=null;status="방에 입장했습니다.";render();}); socket.on("indian-poker:room-state",(r:Room)=>{if(room?.code===r.code||r.players.some(p=>p.id===socket?.id)){room=r;render();}}); socket.on("indian-poker:game-started",(p:{message?:string})=>{status=p.message||"게임이 시작되었습니다.";render();}); socket.on("indian-poker:game-state",(g:Game|null)=>{game=g;render();}); socket.on("indian-poker:room-left",()=>{room=null;game=null;status="방에서 나왔습니다.";socket?.emit("indian-poker:request-room-list");render();}); socket.on("indian-poker:error",(p:{message?:string})=>{status=p.message||"오류가 발생했습니다.";render();}); render(); }
