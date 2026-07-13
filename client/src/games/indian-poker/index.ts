import { io, type Socket } from "socket.io-client";
import { syncRoomChat } from "../../shared/chat";
import "./style.css";

export const INDIAN_POKER_MODULE_VERSION = "0.0.67";
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";
type Card = { suit: "spades"|"hearts"|"diamonds"|"clubs"; rank: string; value: number };
type Player = { id:string; name:string; ready:boolean; isHost:boolean; chips:number; roundBet:number; contribution:number; folded:boolean; allIn:boolean };
type Room = { code:string; state:"lobby"|"playing"|"revealed"; playerCount:number; maxPlayers:number; canStart:boolean; startingChips:number; players:Player[] };
type PotResult = { amount:number; eligibleIds:string[]; winnerIds:string[] };
type Game = { roomCode:string; phase:"betting"|"revealed"; round:number; cards:Record<string,Card|null>; winnerIds:string[]; pot:number; ante:number; currentBet:number; currentTurnId:string; actedIds:string[]; lastAction:string; potResults:PotResult[]; tournamentWinnerId:string; nextRoundAt:number };
let socket: Socket | null = null;
let room: Room | null = null;
let game: Game | null = null;
let roomList: Room[] = [];
let status = "서버에 연결 중입니다.";
let selectedBet = 100;
let countdownTimer: number | null = null;
let actionLockedUntil = 0;
type ChipAnimation = { kind:"to-pot"|"to-player"; playerId:string; amount:number; key:number };
let pendingChipAnimations: ChipAnimation[] = [];
let animationSequence = 0;

const app = () => { const el=document.querySelector<HTMLDivElement>("#app"); if(!el) throw new Error("#app element not found"); return el; };
const esc = (v:string) => v.replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]||c));
const formatChips = (value:number) => Math.max(0,value||0).toLocaleString("ko-KR");
const getName=()=> (localStorage.getItem("bobplatform.playerName")||localStorage.getItem("bobartist.playerName")||"").trim();
function saveName(v:string){ const n=v.trim().slice(0,16); localStorage.setItem("bobplatform.playerName",n); localStorage.setItem("bobartist.playerName",n); }

const CHIP_DENOMINATIONS = [500,100,50,10] as const;
function chipBreakdown(amount:number, maxVisible=14){
  let rest=Math.max(0,Math.floor(amount/10)*10);
  const result:{value:number;count:number;shown:number}[]=[];
  let budget=maxVisible;
  for(const value of CHIP_DENOMINATIONS){
    const count=Math.floor(rest/value); rest-=count*value;
    if(count>0){const shown=Math.min(count,budget);result.push({value,count,shown});budget=Math.max(0,budget-shown);}
  }
  return result;
}
function chipVisualHtml(amount:number, compact=false){
  const groups=chipBreakdown(amount,compact?8:14);
  if(!groups.length)return `<span class="chip-empty">No Chips</span>`;
  return groups.map(group=>`<span class="chip-group chip-${group.value}" title="${group.value} Chips × ${group.count}">${Array.from({length:group.shown},(_,i)=>`<i style="--chip-index:${i}"><b>${group.value}</b></i>`).join("")}${group.count>group.shown?`<em>×${group.count}</em>`:""}</span>`).join("");
}
function queueChipAnimation(kind:"to-pot"|"to-player",playerId:string,amount:number){
  if(amount<=0)return;
  pendingChipAnimations.push({kind,playerId,amount,key:++animationSequence});
  actionLockedUntil=Math.max(actionLockedUntil,Date.now()+720);
}
function playPendingChipAnimations(){
  if(!pendingChipAnimations.length)return;
  const stage=document.querySelector<HTMLElement>(".poker-table-felt");
  const pot=document.querySelector<HTMLElement>(".pot-chip-bank");
  if(!stage||!pot){pendingChipAnimations=[];return;}
  const stageRect=stage.getBoundingClientRect();
  const potRect=pot.getBoundingClientRect();
  const animations=pendingChipAnimations.splice(0);
  animations.forEach((animation,index)=>{
    const seat=document.querySelector<HTMLElement>(`[data-player-id="${CSS.escape(animation.playerId)}"]`);
    if(!seat)return;
    const seatRect=seat.getBoundingClientRect();
    const from=animation.kind==="to-pot"?seatRect:potRect;
    const to=animation.kind==="to-pot"?potRect:seatRect;
    const token=document.createElement("div");
    token.className=`flying-chip chip-${chipBreakdown(animation.amount,1)[0]?.value||100}`;
    token.innerHTML=`<b>${animation.amount>=1000?"+"+formatChips(animation.amount):formatChips(animation.amount)}</b>`;
    token.style.left=`${from.left-stageRect.left+from.width/2-18}px`;
    token.style.top=`${from.top-stageRect.top+from.height/2-18}px`;
    token.style.setProperty("--fly-x",`${to.left-from.left+(to.width-from.width)/2}px`);
    token.style.setProperty("--fly-y",`${to.top-from.top+(to.height-from.height)/2}px`);
    token.style.animationDelay=`${index*90}ms`;
    stage.appendChild(token);
    window.setTimeout(()=>token.remove(),900+index*90);
  });
}
function lockAndEmit(event:string,payload?:unknown){
  if(Date.now()<actionLockedUntil)return;
  actionLockedUntil=Date.now()+700;
  render();
  if(payload===undefined)socket?.emit(event);else socket?.emit(event,payload);
  window.setTimeout(()=>{if(Date.now()>=actionLockedUntil)render();},720);
}

function suitSymbol(card:Card){ return ({spades:"♠",hearts:"♥",diamonds:"♦",clubs:"♣"})[card.suit]; }
function cardHtml(card:Card|null, hidden=false){
  if(hidden||!card) return `<div class="poker-card hidden"><strong>?</strong><span>MY CARD</span></div>`;
  const red=card.suit==="hearts"||card.suit==="diamonds";
  return `<div class="poker-card ${red?"red":""}"><strong>${card.rank}</strong><b>${suitSymbol(card)}</b></div>`;
}
function syncCountdown(){
  const shouldRun=Boolean(game?.phase==="revealed"&&game.nextRoundAt>0&&!game.tournamentWinnerId);
  if(shouldRun&&countdownTimer===null)countdownTimer=window.setInterval(()=>render(),250);
  if(!shouldRun&&countdownTimer!==null){window.clearInterval(countdownTimer);countdownTimer=null;}
}
function render(){
  syncCountdown();
  document.body.classList.add("poker-body");
  syncRoomChat(socket&&room?{socket,gameId:"indian-poker",roomCode:room.code,nickname:getName()}:null);
  if(room&&game) renderGame(); else if(room) renderRoom(); else renderLobby();
}
function header(backId:string,label:string){
  return `<header class="poker-header"><button id="${backId}" class="poker-back" type="button">← ${label}</button><div><h1>Bob Indian Poker</h1><span>v${INDIAN_POKER_MODULE_VERSION}</span></div></header>`;
}
function renderLobby(){
  app().innerHTML=`<main class="poker-shell lobby-shell">${header("backPlatform","BobPlatform")}<section class="poker-grid"><article class="poker-panel"><p class="kicker">CLASSIC MULTIPLAYER</p><h2>게임 참가</h2><label>닉네임<input id="playerName" maxlength="16" value="${esc(getName())}" placeholder="닉네임을 입력하세요"></label><label>시작 Chips<select id="startingChips"><option value="1000">1,000 Chips</option><option value="3000">3,000 Chips</option><option value="5000">5,000 Chips</option><option value="10000" selected>10,000 Chips</option></select></label><button id="createRoom" class="primary">새 방 만들기</button><div class="divider">또는 방 코드로 입장</div><div class="code-row"><input id="roomCode" maxlength="6" inputmode="numeric" placeholder="6자리 방 코드"><button id="joinRoom">입장</button></div><p class="status">${esc(status)}</p></article><article class="poker-panel"><div class="panel-title"><div><p class="kicker">OPEN ROOMS</p><h2>방 목록</h2></div><button id="refreshRooms">새로고침</button></div><div class="room-list">${roomList.length?roomList.map(r=>`<button class="room-item" data-code="${r.code}"><span><strong>${r.code}</strong><small>${formatChips(r.startingChips)} Chips</small></span><em>${r.playerCount}/${r.maxPlayers}</em></button>`).join(""):`<p class="empty">현재 참가 가능한 방이 없습니다.</p>`}</div></article></section></main>`;
  document.querySelector<HTMLButtonElement>("#backPlatform")?.addEventListener("click",()=>{location.hash="/";location.reload();});
  document.querySelector<HTMLButtonElement>("#createRoom")?.addEventListener("click",()=>joinOrCreate(true));
  document.querySelector<HTMLButtonElement>("#joinRoom")?.addEventListener("click",()=>joinOrCreate(false));
  document.querySelector<HTMLButtonElement>("#refreshRooms")?.addEventListener("click",()=>socket?.emit("indian-poker:request-room-list"));
  document.querySelectorAll<HTMLButtonElement>("[data-code]").forEach(b=>b.addEventListener("click",()=>joinOrCreate(false,b.dataset.code)));
}
function joinOrCreate(create:boolean,code?:string){
  const input=document.querySelector<HTMLInputElement>("#playerName");
  const name=(input?.value||getName()).trim();
  if(!name){status="닉네임을 입력해 주세요.";render();return;}
  saveName(name);
  const startingChips=Number(document.querySelector<HTMLSelectElement>("#startingChips")?.value||10000);
  socket?.emit(create?"indian-poker:create-room":"indian-poker:join-room",{playerName:name,roomCode:code||document.querySelector<HTMLInputElement>("#roomCode")?.value,startingChips});
}
function playersHtml(){
  return room?.players.map(p=>`<div class="player ${p.id===socket?.id?"me":""}"><span><strong>${esc(p.name)}</strong>${p.isHost?"<small>방장</small>":""}</span><b>${formatChips(p.chips)} Chips</b><em class="${p.ready?"ready":"waiting"}">${p.isHost?"HOST":p.ready?"READY":"WAITING"}</em></div>`).join("")||"";
}
function renderRoom(){
  if(!room||!socket)return;
  const me=room.players.find(p=>p.id===socket?.id);
  app().innerHTML=`<main class="poker-shell lobby-shell">${header("leaveRoom","방 나가기")}<section class="poker-grid"><article class="poker-panel hero"><p class="kicker">ROOM CODE</p><h2 class="room-code">${room.code}</h2><p>친구에게 방 코드를 알려주세요.</p><div class="rule-box"><strong>시작 Chips ${formatChips(room.startingChips)}</strong><span>Ante 100 · Check · Bet · Call · Raise · Fold · All In</span><small>Main Pot과 Side Pot이 자동으로 정산됩니다.</small></div></article><article class="poker-panel"><div class="panel-title"><div><p class="kicker">PLAYERS</p><h2>${room.playerCount}/${room.maxPlayers}</h2></div></div><div class="player-list">${playersHtml()}</div>${me?.isHost?`<button id="startGame" class="primary" ${room.canStart?"":"disabled"}>게임 시작</button><p class="help">2~6명, 방장을 제외한 모든 참가자가 Ready여야 합니다.</p>`:`<button id="toggleReady" class="primary">${me?.ready?"Ready 취소":"Ready"}</button>`}<p class="status">${esc(status)}</p></article></section></main>`;
  document.querySelector<HTMLButtonElement>("#leaveRoom")?.addEventListener("click",()=>socket?.emit("indian-poker:leave-room"));
  document.querySelector<HTMLButtonElement>("#toggleReady")?.addEventListener("click",()=>socket?.emit("indian-poker:toggle-ready"));
  document.querySelector<HTMLButtonElement>("#startGame")?.addEventListener("click",()=>socket?.emit("indian-poker:start-game"));
}
function playerSeatHtml(player:Player, seatClass:string, myId:string, revealed:boolean){
  const card=game?.cards[player.id]||null;
  const initial=esc(player.name.slice(0,1).toUpperCase()||"P");
  const isTurn=game?.currentTurnId===player.id;
  const isWinner=revealed&&game?.winnerIds.includes(player.id);
  const stateLabel=player.folded?"FOLD":player.allIn?"ALL IN":isWinner?"WINNER":player.roundBet>0?`BET ${formatChips(player.roundBet)}`:"IN GAME";
  return `<article data-player-id="${player.id}" class="table-seat ${seatClass} ${player.id===myId?"is-me":""} ${isTurn?"is-turn":""} ${isWinner?"is-winner":""} ${player.folded?"is-folded":""} ${player.allIn?"is-all-in":""}">
    <div class="seat-profile"><span class="seat-avatar">${initial}</span><div><strong>${esc(player.name)}${player.id===myId?" (나)":""}</strong><small>${isTurn?"현재 차례":player.folded?"FOLDED":player.allIn?"ALL IN":player.isHost?"HOST":"PLAYER"}</small></div></div>
    <div class="seat-card">${cardHtml(card,player.id===myId&&!revealed)}</div>
    <div class="seat-chips"><strong>${formatChips(player.chips)}</strong><span>Chips</span></div>
    <div class="seat-meta"><span>${stateLabel}</span><em>${game?.actedIds.includes(player.id)||player.folded||player.allIn?"ACTED":"WAIT"}</em></div>
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
  const myTurn=!revealed&&currentGame.currentTurnId===myId;
  const callAmount=Math.max(0,currentGame.currentBet-(me?.roundBet||0));
  const animationLocked=Date.now()<actionLockedUntil;
  const canCheck=myTurn&&callAmount===0&&!animationLocked;
  const canBet=myTurn&&currentGame.currentBet===0&&!animationLocked;
  const canCall=myTurn&&callAmount>0&&(me?.chips||0)>callAmount&&!animationLocked;
  const canRaise=myTurn&&currentGame.currentBet>0&&(me?.chips||0)>callAmount+selectedBet&&!animationLocked;
  const canFold=myTurn&&!animationLocked;
  const canAllIn=myTurn&&(me?.chips||0)>0&&!animationLocked;
  const turnPlayer=currentRoom.players.find(p=>p.id===currentGame.currentTurnId);
  const finalWinner=currentRoom.players.find(p=>p.id===currentGame.tournamentWinnerId);
  const nextRoundSeconds=currentGame.nextRoundAt>0?Math.max(0,Math.ceil((currentGame.nextRoundAt-Date.now())/1000)):0;
  const autoRoundText=revealed&&!currentGame.tournamentWinnerId?`${nextRoundSeconds}초 후 다음 라운드가 자동 시작됩니다.`:"";
  app().innerHTML=`<main class="poker-shell game-shell">
    ${header("leaveRoom","방 나가기")}
    <section class="compact-status ${revealed?"revealed":""}"><div><p class="kicker">ROUND ${currentGame.round}</p><strong>${currentGame.tournamentWinnerId?`${esc(finalWinner?.name||"")} 최종 우승`:revealed?(winners.length>1?`${esc(winners.join(", "))} 공동 승리`:`${esc(winners[0]||"")} 승리`):myTurn?"내 차례입니다":`${esc(turnPlayer?.name||"")}님 차례`}</strong></div><span>${esc(currentGame.lastAction)}</span></section>
    <section class="poker-game-stage">
      <div class="poker-table-wrap">
        <div class="poker-table-felt">
          <div class="table-brand"><span>BOB</span><strong>INDIAN POKER</strong></div>
          <div class="table-center-info"><p>POT</p><strong>${formatChips(currentGame.pot)}</strong><div class="pot-chip-bank" aria-label="Pot Chips">${chipVisualHtml(currentGame.pot)}</div><small>Ante ${formatChips(currentGame.ante)} · Current Bet ${formatChips(currentGame.currentBet)}</small></div>
          <div class="deck-stack" aria-hidden="true"><i></i><i></i><i></i></div>
          ${opponents.map((p,i)=>playerSeatHtml(p,layout[i]||"seat-top",myId,revealed)).join("")}
          ${me?playerSeatHtml(me,"seat-bottom",myId,revealed):""}
        </div>
      </div>
      <aside class="game-side-panel">
        <div class="side-summary"><p class="kicker">GAME INFO</p><h2>Round ${currentGame.round}</h2><dl><div><dt>Pot</dt><dd>${formatChips(currentGame.pot)}</dd></div><div><dt>내 Chips</dt><dd>${formatChips(me?.chips||0)}</dd></div><div><dt>현재 Bet</dt><dd>${formatChips(currentGame.currentBet)}</dd></div><div><dt>방 코드</dt><dd>${currentRoom.code}</dd></div></dl>${revealed&&currentGame.potResults.length?`<div class="pot-breakdown">${currentGame.potResults.map((pot,index)=>`<span>${index===0?"Main Pot":`Side Pot ${index}`} <b>${formatChips(pot.amount)}</b></span>`).join("")}</div>`:""}</div>
        <div class="turn-message"><span class="turn-dot"></span><strong>${revealed?"라운드 종료":myTurn?"행동을 선택하세요":`${esc(turnPlayer?.name||"")}님을 기다리는 중`}</strong><small>${revealed?(currentGame.tournamentWinnerId?"새 게임을 시작할 수 있습니다.":autoRoundText):callAmount>0?`Call ${formatChips(callAmount)} 필요`:"Check 또는 Bet을 선택할 수 있습니다."}</small></div>
      </aside>
    </section>
    <section class="poker-action-bar">
      <div class="action-main"><button id="checkAction" ${canCheck?"":"disabled"}>Check</button><button id="betAction" ${canBet?"":"disabled"}>Bet ${formatChips(selectedBet)}</button><button id="callAction" ${canCall?"":"disabled"}>Call${callAmount?` ${formatChips(callAmount)}`:""}</button><button id="raiseAction" ${canRaise?"":"disabled"}>Raise +${formatChips(selectedBet)}</button><button id="foldAction" ${canFold?"":"disabled"}>Fold</button><button id="allInAction" ${canAllIn?"":"disabled"}>All In${me?.chips?` ${formatChips(me.chips)}`:""}</button></div>
      <div class="bet-presets"><span>Bet 금액</span>${[100,500,1000].map(amount=>`<button class="${selectedBet===amount?"selected":""}" data-bet="${amount}" ${!(canBet||canRaise)?"disabled":""}>+${formatChips(amount)}</button>`).join("")}</div>
      <div class="round-control">${currentGame.tournamentWinnerId?(me?.isHost?`<button id="restartGame" class="primary">새 게임</button>`:`<p>방장이 새 게임을 준비합니다.</p>`):revealed?`<div class="auto-round"><strong>${nextRoundSeconds}</strong><span>초 후 자동 시작</span></div>`:`<p>${myTurn?"시간 제한 없이 천천히 선택하세요.":"현재 플레이어의 행동을 기다리고 있습니다."}</p>`}</div>
      <p class="status">${esc(status)}</p>
    </section>
  </main>`;
  document.querySelector<HTMLButtonElement>("#leaveRoom")?.addEventListener("click",()=>currentSocket.emit("indian-poker:leave-room"));
  document.querySelector<HTMLButtonElement>("#checkAction")?.addEventListener("click",()=>lockAndEmit("indian-poker:check"));
  document.querySelector<HTMLButtonElement>("#betAction")?.addEventListener("click",()=>lockAndEmit("indian-poker:bet",{amount:selectedBet}));
  document.querySelector<HTMLButtonElement>("#callAction")?.addEventListener("click",()=>lockAndEmit("indian-poker:call"));
  document.querySelector<HTMLButtonElement>("#raiseAction")?.addEventListener("click",()=>lockAndEmit("indian-poker:raise",{amount:selectedBet}));
  document.querySelector<HTMLButtonElement>("#foldAction")?.addEventListener("click",()=>lockAndEmit("indian-poker:fold"));
  document.querySelector<HTMLButtonElement>("#allInAction")?.addEventListener("click",()=>lockAndEmit("indian-poker:all-in"));
  document.querySelectorAll<HTMLButtonElement>("[data-bet]").forEach(button=>button.addEventListener("click",()=>{selectedBet=Number(button.dataset.bet||100);render();}));
  document.querySelector<HTMLButtonElement>("#restartGame")?.addEventListener("click",()=>currentSocket.emit("indian-poker:restart-game"));
  window.requestAnimationFrame(playPendingChipAnimations);
}
function connect(){
  socket=io(SERVER_URL,{transports:["websocket","polling"]});
  socket.on("connect",()=>{status="서버에 연결되었습니다.";socket?.emit("indian-poker:request-room-list");render();});
  socket.on("disconnect",()=>{status="서버 연결이 끊겼습니다.";render();});
  socket.on("indian-poker:room-list",(payload:Room[])=>{roomList=payload; if(!room)render();});
  socket.on("indian-poker:room-created",(payload:Room)=>{room=payload;game=null;status="방을 만들었습니다.";render();});
  socket.on("indian-poker:room-joined",(payload:Room)=>{room=payload;game=null;status="방에 입장했습니다.";render();});
  socket.on("indian-poker:room-state",(payload:Room)=>{
    if(room&&game){
      for(const next of payload.players){
        const prev=room.players.find(player=>player.id===next.id);
        if(!prev)continue;
        const contributionDelta=next.contribution-prev.contribution;
        const chipsGain=next.chips-prev.chips;
        if(contributionDelta>0)queueChipAnimation("to-pot",next.id,contributionDelta);
        else if(chipsGain>0&&prev.contribution>0)queueChipAnimation("to-player",next.id,chipsGain);
      }
    }
    room=payload;render();
  });
  socket.on("indian-poker:game-state",(payload:Game|null)=>{game=payload;render();});
  socket.on("indian-poker:room-left",()=>{room=null;game=null;status="방에서 나왔습니다.";socket?.emit("indian-poker:request-room-list");render();});
  socket.on("indian-poker:game-started",(payload:{message?:string})=>{status=payload.message||"게임이 시작되었습니다.";render();});
  socket.on("indian-poker:error",(payload:{message?:string})=>{status=payload.message||"요청을 처리하지 못했습니다.";render();});
}
export function mountIndianPoker(){room=null;game=null;roomList=[];status="서버에 연결 중입니다.";selectedBet=100;render();connect();}
export function unmountIndianPoker(){syncRoomChat(null);if(countdownTimer!==null){window.clearInterval(countdownTimer);countdownTimer=null;}socket?.disconnect();socket=null;room=null;game=null;document.body.classList.remove("poker-body");}
