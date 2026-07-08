import { io, Socket } from 'socket.io-client';
import './style.css';

type RoomState = 'lobby' | 'playing' | 'ended';
type GamePhase = 'loading' | 'role_assignment' | 'decorate' | 'submit' | 'reveal' | 'find' | 'result';
type PlayerRole = 'artist' | 'spy';

type PublicPlayer = {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
  role: PlayerRole | null;
  submitted: boolean;
};

type Artwork = {
  imageId: string;
  imageUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type CharacterSnapshot = {
  xRatio: number;
  yRatio: number;
  radiusRatio: number;
  baseColor: string;
};

type ArtworkSubmission = {
  playerId: string;
  playerName: string;
  character: CharacterSnapshot;
  paintDataUrl: string;
  submittedAt: number;
  caught?: boolean;
};

type FindResult = {
  selectedTargetId: string | null;
  success: boolean;
  message: string;
};

type PublicRoom = {
  code: string;
  state: RoomState;
  canStart: boolean;
  playerCount: number;
  maxPlayers: number;
  players: PublicPlayer[];
  artwork: Artwork;
  game: null | {
    round: number;
    phase: GamePhase;
    startedAt: number;
    phaseStartedAt: number;
    artwork: Artwork;
    submissions: ArtworkSubmission[];
    caughtTargetIds: string[];
    selectedTargetId: string | null;
    result: FindResult | null;
  };
  createdAt: number;
  updatedAt: number;
};

type ServerReady = {
  socketId: string;
  version: string;
};

type SelectedArtwork = {
  dataUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type FocusScoreItem = {
  playerId: string;
  playerName: string;
  score: number;
};

type FocusScorePayload = {
  audience?: 'artist_live' | 'spy_snapshot';
  round: number;
  phase: GamePhase;
  radiusPx: number;
  scores: FocusScoreItem[];
};

type CharacterState = {
  x: number;
  y: number;
  radius: number;
  baseColor: string;
};

const STORAGE_KEYS = {
  playerName: 'bobartist.playerName',
  lastRoomCode: 'bobartist.lastRoomCode'
} as const;

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
const VERSION = '0.0.42';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element not found');

app.innerHTML = `
  <main id="lobbyPage" class="page">
    <section class="panel">
      <div class="title-row">
        <div>
          <p class="eyebrow">BobArtist</p>
          <h1>v${VERSION} Auto Submit HUD Engine</h1>
        </div>
        <span id="socketStatus" class="badge badge-wait">연결 대기</span>
      </div>

      <div class="form-grid">
        <label>
          닉네임
          <input id="playerNameInput" maxlength="16" placeholder="예: 밥화가" />
        </label>

        <label>
          방 코드
          <input id="roomCodeInput" maxlength="6" inputmode="numeric" placeholder="6자리 코드" />
        </label>
      </div>

      <div class="upload-box">
        <label class="upload-label">
          원본 이미지 업로드 <span>PNG/JPG/JPEG · 최대 5MB</span>
          <input id="artworkInput" type="file" accept="image/png,image/jpeg,image/jpg" />
        </label>
        <div id="uploadInfo" class="upload-info">방을 만들 사람은 원본 이미지를 먼저 선택해 주세요.</div>
      </div>

      <div class="button-row">
        <button id="createRoomButton" type="button">방 만들기</button>
        <button id="joinRoomButton" type="button" class="secondary">방 입장</button>
        <button id="leaveRoomButton" type="button" class="ghost">나가기</button>
      </div>

      <p id="messageBox" class="message">서버 연결을 확인하는 중입니다.</p>
    </section>

    <section class="room-layout">
      <div class="canvas-card lobby-preview">
        <canvas id="roomCanvas" width="720" height="420"></canvas>
      </div>

      <aside class="room-card">
        <p class="eyebrow">Room State</p>
        <h2 id="roomTitle">아직 입장한 방 없음</h2>
        <div id="roomCodeView" class="room-code">------</div>
        <div id="phaseView" class="phase phase-lobby">LOBBY</div>
        <div id="artworkView" class="artwork-view">원본 이미지 없음</div>
        <ul id="playerList" class="player-list"></ul>
        <div class="lobby-actions">
          <button id="readyButton" type="button" class="ready-button" disabled>참가자 준비</button>
          <button id="startGameButton" type="button" class="start-button" disabled>게임 시작</button>
        </div>
        <p id="startHint" class="hint">방에 입장하면 준비할 수 있습니다.</p>
      </aside>
    </section>
  </main>

  <main id="gamePage" class="game-page hidden">
    <section class="game-shell">
      <header class="game-header">
        <div>
          <p class="eyebrow">BobArtist Game</p>
          <h1 id="gameTitle">ROUND 1</h1>
          <p id="gameSubTitle" class="game-subtitle">원본 이미지 위에 내 원형 캐릭터 색칠</p>
        </div>
        <div class="game-header-actions">
          <div class="top-action-panel">
            <button id="submitArtworkButton" type="button">제출</button>
            <button id="confirmFindButton" type="button" class="find-button" disabled>찾기 단계 대기</button>
            <button id="restartGameButton" type="button" class="restart-button" disabled>다시 시작</button>
            <p id="submitStatusView" class="top-action-status">꾸미기가 끝나면 제출하세요.</p>
          </div>
          <div id="topScorePanel" class="top-score-panel">
            <span id="topScoreLabel">술래 점수</span>
            <strong id="topScoreView">대기</strong>
          </div>
          <div class="top-timer-panel">
            <span>남은 시간</span>
            <strong id="topTimerView">--:--</strong>
          </div>
          <span id="gameRoomCode" class="mini-code">------</span>
          <button id="gameLeaveButton" type="button" class="ghost">방 나가기</button>
        </div>
      </header>

      <section class="game-layout">
        <div class="draw-card">
          <div class="draw-toolbar">
            <strong>ARTWORK CANVAS</strong>
            <div id="focusScorePanel" class="focus-score-panel hidden">
              <span id="focusScoreLabel">Focus Score</span>
              <strong id="focusScoreView">아직 누적 점수 없음</strong>
            </div>
            <div class="draw-actions">
              <span id="zoomView" class="zoom-view">100%</span>
              <button id="resetCharacterButton" type="button" class="ghost small-button">초기화</button>
            </div>
          </div>
          <div id="gameCanvasViewport" class="game-canvas-viewport">
            <canvas id="gameCanvas" width="1200" height="760"></canvas>
            <div id="spyVisionOverlay" class="spy-vision-overlay" aria-hidden="true">
              <div class="spy-crosshair"></div>
            </div>
          </div>
        </div>

        <aside class="mission-card">
          <p class="eyebrow">Character Paint</p>
          <h2>내 원형 캐릭터</h2>
          <div id="roleCard" class="role-card role-unknown">
            <span>내 역할</span>
            <strong id="myRoleView">ROLE ASSIGNMENT</strong>
            <p id="roleDescriptionView">게임 시작 후 역할이 표시됩니다.</p>
          </div>
          <div class="color-status">
            <span id="selectedColorChip" class="color-chip"></span>
            <strong id="selectedColorText">#FFFFFF</strong>
          </div>
          <div class="range-control">
            <label for="brushSizeInput">붓 크기 <strong id="brushSizeView">5px</strong></label>
            <input id="brushSizeInput" type="range" min="1" max="20" value="5" />
          </div>
          <div class="range-control">
            <label for="characterSizeInput">원 크기 <strong id="characterSizeView">116px</strong></label>
            <input id="characterSizeInput" type="range" min="20" max="200" value="116" />
          </div>
          <p id="toolHint" class="mission-message">기본은 항상 붓입니다. Space로 색을 가져오고 WASD로 이동합니다.</p>

          <div class="hud-grid">
            <div class="hud-card" id="moveHud">
              <div class="hud-title">이동</div>
              <div class="key-row"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></div>
              <p>방향키도 가능 · Shift 빠르게 · Ctrl 정밀</p>
            </div>
            <div class="hud-card" id="sampleHud">
              <div class="hud-title">색 가져오기</div>
              <div class="key-row"><kbd>Space</kbd></div>
              <p>마우스 위치의 배경색을 붓 색으로 사용</p>
            </div>
            <div class="hud-card" id="brushHud">
              <div class="hud-title">붓 크기</div>
              <div class="key-row"><kbd>[</kbd><kbd>]</kbd></div>
              <p>1px ~ 20px</p>
            </div>
            <div class="hud-card" id="sizeHud">
              <div class="hud-title">원 크기</div>
              <div class="key-row"><kbd>Q</kbd><kbd>E</kbd></div>
              <p>20px ~ 200px</p>
            </div>
            <div class="hud-card" id="guideHud">
              <div class="hud-title">내 원 위치</div>
              <div class="key-row"><kbd>T</kbd></div>
              <p>내 화면에서만 가이드 테두리 표시/숨김</p>
            </div>
            <div class="hud-card" id="zoomHud">
              <div class="hud-title">확대/축소</div>
              <div class="key-row"><kbd>Shift</kbd><span>+</span><kbd>Wheel</kbd></div>
              <p>Shift + 0 으로 100%</p>
            </div>
            <div class="hud-card" id="resetHud">
              <div class="hud-title">초기화</div>
              <div class="key-row"><kbd>R</kbd></div>
              <p>확인 후 원 내부 칠하기 초기화</p>
            </div>
          </div>

          <div class="submit-panel submit-panel-guide">
            <p class="hint">제출/찾기/다시 시작 버튼은 항상 보이도록 상단 고정바로 이동했습니다.</p>
          </div>

          <div class="game-info-list">
            <div>
              <span>Game State</span>
              <strong id="gamePhaseView">DECORATE</strong>
            </div>
            <div>
              <span>남은 시간</span>
              <strong id="gameTimerView">05:00</strong>
            </div>
            <div>
              <span>원본</span>
              <strong id="gameArtworkNameView">-</strong>
            </div>
            <div>
              <span>참가자</span>
              <strong id="gamePlayerCountView">0/8</strong>
            </div>
          </div>

          <p class="hint">v0.0.42는 도망자 제출 버튼 상단 고정과 그리기 시간 종료 자동 제출을 보강한 버전입니다.</p>
        </aside>
      </section>
    </section>
  </main>
`;

const lobbyPage = document.querySelector<HTMLElement>('#lobbyPage')!;
const gamePage = document.querySelector<HTMLElement>('#gamePage')!;
const socketStatus = document.querySelector<HTMLSpanElement>('#socketStatus')!;
const playerNameInput = document.querySelector<HTMLInputElement>('#playerNameInput')!;
const roomCodeInput = document.querySelector<HTMLInputElement>('#roomCodeInput')!;
const artworkInput = document.querySelector<HTMLInputElement>('#artworkInput')!;
const uploadInfo = document.querySelector<HTMLDivElement>('#uploadInfo')!;
const createRoomButton = document.querySelector<HTMLButtonElement>('#createRoomButton')!;
const joinRoomButton = document.querySelector<HTMLButtonElement>('#joinRoomButton')!;
const leaveRoomButton = document.querySelector<HTMLButtonElement>('#leaveRoomButton')!;
const readyButton = document.querySelector<HTMLButtonElement>('#readyButton')!;
const startGameButton = document.querySelector<HTMLButtonElement>('#startGameButton')!;
const startHint = document.querySelector<HTMLParagraphElement>('#startHint')!;
const messageBox = document.querySelector<HTMLParagraphElement>('#messageBox')!;
const roomTitle = document.querySelector<HTMLHeadingElement>('#roomTitle')!;
const roomCodeView = document.querySelector<HTMLDivElement>('#roomCodeView')!;
const phaseView = document.querySelector<HTMLDivElement>('#phaseView')!;
const artworkView = document.querySelector<HTMLDivElement>('#artworkView')!;
const playerList = document.querySelector<HTMLUListElement>('#playerList')!;
const roomCanvas = document.querySelector<HTMLCanvasElement>('#roomCanvas')!;
const lobbyContext = roomCanvas.getContext('2d');

const gameTitle = document.querySelector<HTMLHeadingElement>('#gameTitle')!;
const gameSubTitle = document.querySelector<HTMLParagraphElement>('#gameSubTitle')!;
const gameRoomCode = document.querySelector<HTMLSpanElement>('#gameRoomCode')!;
const gameLeaveButton = document.querySelector<HTMLButtonElement>('#gameLeaveButton')!;
const topScorePanel = document.querySelector<HTMLElement>('#topScorePanel')!;
const topScoreLabel = document.querySelector<HTMLElement>('#topScoreLabel')!;
const topScoreView = document.querySelector<HTMLElement>('#topScoreView')!;
const topTimerView = document.querySelector<HTMLElement>('#topTimerView')!;
const gameCanvasViewport = document.querySelector<HTMLDivElement>('#gameCanvasViewport')!;
const spyVisionOverlay = document.querySelector<HTMLDivElement>('#spyVisionOverlay')!;
const gameCanvas = document.querySelector<HTMLCanvasElement>('#gameCanvas')!;
const gameContext = gameCanvas.getContext('2d', { willReadFrequently: true });
const resetCharacterButton = document.querySelector<HTMLButtonElement>('#resetCharacterButton')!;
const zoomView = document.querySelector<HTMLSpanElement>('#zoomView')!;
const brushSizeInput = document.querySelector<HTMLInputElement>('#brushSizeInput')!;
const brushSizeView = document.querySelector<HTMLElement>('#brushSizeView')!;
const characterSizeInput = document.querySelector<HTMLInputElement>('#characterSizeInput')!;
const characterSizeView = document.querySelector<HTMLElement>('#characterSizeView')!;
const roleCard = document.querySelector<HTMLElement>('#roleCard')!;
const myRoleView = document.querySelector<HTMLElement>('#myRoleView')!;
const roleDescriptionView = document.querySelector<HTMLParagraphElement>('#roleDescriptionView')!;
const selectedColorChip = document.querySelector<HTMLSpanElement>('#selectedColorChip')!;
const selectedColorText = document.querySelector<HTMLElement>('#selectedColorText')!;
const toolHint = document.querySelector<HTMLParagraphElement>('#toolHint')!;
const moveHud = document.querySelector<HTMLElement>('#moveHud')!;
const sampleHud = document.querySelector<HTMLElement>('#sampleHud')!;
const brushHud = document.querySelector<HTMLElement>('#brushHud')!;
const sizeHud = document.querySelector<HTMLElement>('#sizeHud')!;
const guideHud = document.querySelector<HTMLElement>('#guideHud')!;
const zoomHud = document.querySelector<HTMLElement>('#zoomHud')!;
const resetHud = document.querySelector<HTMLElement>('#resetHud')!;
const gamePhaseView = document.querySelector<HTMLElement>('#gamePhaseView')!;
const gameTimerView = document.querySelector<HTMLElement>('#gameTimerView')!;
const gameArtworkNameView = document.querySelector<HTMLElement>('#gameArtworkNameView')!;
const gamePlayerCountView = document.querySelector<HTMLElement>('#gamePlayerCountView')!;
const focusScorePanel = document.querySelector<HTMLElement>('#focusScorePanel')!;
const focusScoreLabel = document.querySelector<HTMLElement>('#focusScoreLabel')!;
const focusScoreView = document.querySelector<HTMLElement>('#focusScoreView')!;
const submitArtworkButton = document.querySelector<HTMLButtonElement>('#submitArtworkButton')!;
const confirmFindButton = document.querySelector<HTMLButtonElement>('#confirmFindButton')!;
const restartGameButton = document.querySelector<HTMLButtonElement>('#restartGameButton')!;
const submitStatusView = document.querySelector<HTMLParagraphElement>('#submitStatusView')!;

if (!lobbyContext || !gameContext) throw new Error('Canvas 2D context not available');
const lobbyCtx: CanvasRenderingContext2D = lobbyContext;
const gameCtx: CanvasRenderingContext2D = gameContext;
const paintCanvas = document.createElement('canvas');
paintCanvas.width = 512;
paintCanvas.height = 512;
const paintContext = paintCanvas.getContext('2d');
if (!paintContext) throw new Error('Paint canvas context not available');
const paintCtx: CanvasRenderingContext2D = paintContext;

function resetCanvasDrawState(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
}

function fillPaintCanvasWhite(): void {
  // Character artwork is stored as an opaque white canvas from the start.
  // This lets the spy screen draw only the submitted image pixels without a separate base circle,
  // preventing canvas stroke/clip artifacts from becoming a visible outline.
  paintCtx.save();
  resetCanvasDrawState(paintCtx);
  paintCtx.shadowBlur = 0;
  paintCtx.shadowColor = 'transparent';
  paintCtx.setLineDash([]);
  paintCtx.fillStyle = '#FFFFFF';
  paintCtx.fillRect(0, 0, paintCanvas.width, paintCanvas.height);
  paintCtx.restore();
}

fillPaintCanvasWhite();

let socket: Socket | null = null;
let currentRoom: PublicRoom | null = null;
let mySocketId = '';
let selectedArtwork: SelectedArtwork | null = null;
let gameImage: HTMLImageElement | null = null;
let gameImageUrl = '';
let selectedColor = '#FFFFFF';
let isPainting = false;
let lastMousePoint: { x: number; y: number } | null = null;
let lastPaintPoint: { x: number; y: number } | null = null;
let brushSize = 5;
let zoomLevel = 1;
let resizeTimer: number | null = null;
let spyVisionAnimationFrame: number | null = null;
let showCharacterGuide = false;
let lastRenderedRound = 0;
let lastFocusPointerSentAt = 0;
let latestFocusScores: FocusScorePayload | null = null;
let gameTimerInterval: number | null = null;
let autoSubmitTimeout: number | null = null;
let autoSubmitKey = '';
const DECORATE_DURATION_MS = 60 * 1000;
const FIND_DURATION_MS = 5 * 60 * 1000;
const SPY_FULL_VIEW_MS = 1000;
const SPY_DARKEN_MS = 1000;
const SPY_LIGHT_RADIUS = 170;
const SPY_LIGHT_EDGE = 34;
const submissionImageCache = new Map<string, HTMLImageElement>();
let character: CharacterState = {
  x: 450,
  y: 300,
  radius: 58,
  baseColor: '#FFFFFF'
};

playerNameInput.value = localStorage.getItem(STORAGE_KEYS.playerName) || '';
roomCodeInput.value = localStorage.getItem(STORAGE_KEYS.lastRoomCode) || '';

function setMessage(message: string, type: 'normal' | 'success' | 'error' = 'normal'): void {
  messageBox.textContent = message;
  messageBox.className = `message message-${type}`;
}

function setSocketStatus(text: string, status: 'wait' | 'ok' | 'bad'): void {
  socketStatus.textContent = text;
  socketStatus.className = `badge badge-${status}`;
}

function getPlayerName(): string {
  const name = playerNameInput.value.trim() || '익명';
  localStorage.setItem(STORAGE_KEYS.playerName, name);
  return name;
}

function getRoomCode(): string {
  const code = roomCodeInput.value.replace(/[^0-9]/g, '').slice(0, 6);
  roomCodeInput.value = code;
  if (code) localStorage.setItem(STORAGE_KEYS.lastRoomCode, code);
  return code;
}

function getMe(room: PublicRoom | null): PublicPlayer | null {
  if (!room) return null;
  return room.players.find((player) => player.id === mySocketId) || null;
}

function getStateLabel(state: RoomState): string {
  if (state === 'playing') return 'PLAYING';
  if (state === 'ended') return 'ENDED';
  return 'LOBBY';
}

function getPhaseLabel(phase?: GamePhase): string {
  if (!phase) return 'LOADING';
  const labels: Record<GamePhase, string> = {
    loading: 'LOADING',
    role_assignment: 'ROLE ASSIGNMENT',
    decorate: 'DECORATE',
    submit: 'SUBMIT',
    reveal: 'REVEAL',
    find: 'FIND',
    result: 'RESULT'
  };
  return labels[phase];
}

function getRoleLabel(role?: PlayerRole | null): string {
  if (role === 'spy') return 'SPY / 술래';
  if (role === 'artist') return 'ARTIST / 아티스트';
  return 'ROLE ASSIGNMENT';
}

function isArtistPlayer(): boolean {
  return getMe(currentRoom)?.role === 'artist';
}

function canArtistDecorate(): boolean {
  const phase = currentRoom?.game?.phase;
  return isArtistPlayer() && (phase === 'decorate' || phase === 'submit');
}

function getPhaseMessage(phase?: GamePhase): string {
  if (phase === 'role_assignment') return '역할을 배정하는 중입니다. 술래 1명과 도망자 여러 명으로 진행됩니다.';
  if (phase === 'decorate') return '1분 안에 원을 자연스럽게 숨기고 제출하세요.';
  if (phase === 'submit') return '다른 플레이어의 제출을 기다리는 중입니다.';
  if (phase === 'reveal') return '제출 완료. 모든 도망자의 원이 공개되고 술래가 찾기를 준비합니다.';
  if (phase === 'find') return '술래가 5분 안에 모든 도망자의 원을 찾는 단계입니다.';
  if (phase === 'result') return '결과 단계입니다. 시간 초과면 도망자 승리, 모든 도망자를 잡으면 술래 승리입니다.';
  return '게임 상태를 준비하고 있습니다.';
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function getArtworkUrl(artwork: Artwork): string {
  return `${SERVER_URL}${artwork.imageUrl}`;
}

function showLobbyPage(): void {
  stopGameTimerTicker();
  lobbyPage.classList.remove('hidden');
  gamePage.classList.add('hidden');
}

function showGamePage(): void {
  lobbyPage.classList.add('hidden');
  gamePage.classList.remove('hidden');
}

function drawImageContain(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number): void {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
    image.src = src;
  });
}

function drawEmptyLobbyCanvas(): void {
  lobbyCtx.clearRect(0, 0, roomCanvas.width, roomCanvas.height);
  lobbyCtx.fillStyle = '#fffaf0';
  lobbyCtx.fillRect(0, 0, roomCanvas.width, roomCanvas.height);
  lobbyCtx.fillStyle = '#2f261d';
  lobbyCtx.font = '700 30px Arial';
  lobbyCtx.fillText('BobArtist', 48, 76);
  lobbyCtx.font = '18px Arial';
  lobbyCtx.fillText('방장이 원본 이미지를 업로드한 뒤 방을 만듭니다.', 48, 116);
  lobbyCtx.strokeStyle = '#e8d8bd';
  lobbyCtx.lineWidth = 3;
  lobbyCtx.strokeRect(48, 152, 624, 210);
  lobbyCtx.font = '16px Arial';
  lobbyCtx.fillText(`v${VERSION} 목표: Focus Score UI Engine`, 78, 208);
}

async function drawSelectedArtworkPreview(): Promise<void> {
  if (!selectedArtwork) {
    drawEmptyLobbyCanvas();
    return;
  }

  const image = await loadImage(selectedArtwork.dataUrl);
  lobbyCtx.clearRect(0, 0, roomCanvas.width, roomCanvas.height);
  lobbyCtx.fillStyle = '#fffaf0';
  lobbyCtx.fillRect(0, 0, roomCanvas.width, roomCanvas.height);
  drawImageContain(lobbyCtx, image, roomCanvas.width, roomCanvas.height);
}

async function drawLobbyRoomCanvas(room: PublicRoom): Promise<void> {
  lobbyCtx.clearRect(0, 0, roomCanvas.width, roomCanvas.height);
  lobbyCtx.fillStyle = '#fffaf0';
  lobbyCtx.fillRect(0, 0, roomCanvas.width, roomCanvas.height);

  try {
    const image = await loadImage(getArtworkUrl(room.artwork));
    drawImageContain(lobbyCtx, image, roomCanvas.width, roomCanvas.height);
    lobbyCtx.fillStyle = 'rgba(255, 250, 240, 0.86)';
    lobbyCtx.fillRect(24, 24, 300, 94);
  } catch {
    // 실패해도 방 상태 텍스트는 표시합니다.
  }

  lobbyCtx.fillStyle = '#2f261d';
  lobbyCtx.font = '700 26px Arial';
  lobbyCtx.fillText(`ROOM ${room.code}`, 48, 62);
  lobbyCtx.font = '17px Arial';
  lobbyCtx.fillText(`${room.playerCount}/${room.maxPlayers}명 연결됨 · ${getStateLabel(room.state)}`, 48, 96);
}

function resetCharacter(): void {
  resizeGameCanvasToArtwork(false);
  character = {
    x: gameCanvas.width / 2,
    y: gameCanvas.height / 2,
    radius: 58,
    baseColor: '#FFFFFF'
  };
  selectedColor = '#FFFFFF';
  brushSize = 5;
  zoomLevel = 1;
  paintCtx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  fillPaintCanvasWhite();
  brushSizeInput.value = String(brushSize);
  characterSizeInput.value = String(character.radius * 2);
  updateColorStatus();
  updateBrushStatus();
  updateCharacterSizeStatus();
  applyZoom();
  renderGameCanvas();
}

function resetRoundLocalState(): void {
  isPainting = false;
  lastMousePoint = null;
  lastPaintPoint = null;
  showCharacterGuide = false;
  submissionImageCache.clear();
  if (spyVisionAnimationFrame !== null) {
    window.cancelAnimationFrame(spyVisionAnimationFrame);
    spyVisionAnimationFrame = null;
  }
  resetCanvasDrawState(gameCtx);
  resetCanvasDrawState(paintCtx);
  spyVisionOverlay.classList.remove('is-active', 'is-find');
  resetCharacter();
}

function updateColorStatus(): void {
  selectedColorChip.style.background = selectedColor;
  selectedColorText.textContent = selectedColor.toUpperCase();
}

function updateBrushStatus(): void {
  brushSizeView.textContent = `${brushSize}px`;
}

function updateCharacterSizeStatus(): void {
  characterSizeView.textContent = `${Math.round(character.radius * 2)}px`;
}

function applyZoom(): void {
  zoomLevel = Math.min(3, Math.max(0.5, zoomLevel));
  gameCanvas.style.width = `${gameCanvas.width * zoomLevel}px`;
  gameCanvas.style.height = `${gameCanvas.height * zoomLevel}px`;
  updateSpyOverlaySize();
  zoomView.textContent = `${Math.round(zoomLevel * 100)}%`;
}

function resizeGameCanvasToArtwork(centerCharacter = false): void {
  if (!gameImage) {
    applyZoom();
    return;
  }

  const viewportWidth = Math.max(320, gameCanvasViewport.clientWidth - 8);
  const viewportHeight = Math.max(240, gameCanvasViewport.clientHeight - 8);

  // 기본은 캔버스 영역을 최대한 채우는 방식입니다.
  // 이미지 비율은 유지하고, 가로가 남지 않도록 fit-width를 우선 적용합니다.
  let scale = viewportWidth / gameImage.naturalWidth;

  // 세로가 너무 작게 남는 이미지도 화면을 충분히 쓰도록 보정합니다.
  const heightFillScale = (viewportHeight * 0.92) / gameImage.naturalHeight;
  if (gameImage.naturalHeight * scale < viewportHeight * 0.72) {
    scale = Math.max(scale, heightFillScale);
  }

  scale = Math.min(4, Math.max(0.15, scale));
  const nextWidth = Math.max(320, Math.round(gameImage.naturalWidth * scale));
  const nextHeight = Math.max(240, Math.round(gameImage.naturalHeight * scale));

  const oldWidth = gameCanvas.width;
  const oldHeight = gameCanvas.height;

  if (oldWidth !== nextWidth || oldHeight !== nextHeight) {
    gameCanvas.width = nextWidth;
    gameCanvas.height = nextHeight;

    if (centerCharacter || oldWidth === 0 || oldHeight === 0) {
      character.x = nextWidth / 2;
      character.y = nextHeight / 2;
    } else {
      character.x = (character.x / oldWidth) * nextWidth;
      character.y = (character.y / oldHeight) * nextHeight;
    }
  } else if (centerCharacter) {
    character.x = nextWidth / 2;
    character.y = nextHeight / 2;
  }

  character.x = Math.min(gameCanvas.width, Math.max(0, character.x));
  character.y = Math.min(gameCanvas.height, Math.max(0, character.y));
  applyZoom();
}

function flashHud(element: HTMLElement): void {
  element.classList.remove('hud-flash');
  void element.offsetWidth;
  element.classList.add('hud-flash');
}

function updateToolHint(message: string): void {
  toolHint.textContent = message;
}

function drawBackgroundOnly(ctx: CanvasRenderingContext2D): void {
  resetCanvasDrawState(ctx);
  ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  if (gameImage) {
    ctx.drawImage(gameImage, 0, 0, gameCanvas.width, gameCanvas.height);
    return;
  }

  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
  ctx.fillStyle = '#2f261d';
  ctx.font = '700 24px Arial';
  ctx.fillText('원본 이미지를 불러오는 중입니다.', 48, 72);
}

function prepareCleanCircleFill(ctx: CanvasRenderingContext2D): void {
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.setLineDash([]);
}

function snapCirclePoint(value: number): number {
  // Keep the filled circle aligned to device pixels without adding a visible stroke.
  return Math.round(value);
}

function drawSolidCircleBase(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  // Artist/public rendering may show the body of the character, but it must never add a stroke.
  const px = snapCirclePoint(x);
  const py = snapCirclePoint(y);

  ctx.save();
  prepareCleanCircleFill(ctx);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHardClippedCircleImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  radius: number
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

function drawSpySafeCircleImage(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  radius: number
): void {
  // 술래 화면은 흰 원판은 유지하되, 별도의 테두리/그림자/페더 링을 절대 만들지 않습니다.
  // v0.0.35의 inward feather mask는 칠한 영역 바깥에 흰 링이 생겨 술래에게 테두리처럼 보였습니다.
  // 그래서 술래도 도망자와 동일하게 hard clip만 사용하고, 외곽 stroke는 drawSubmission에서 차단합니다.
  drawHardClippedCircleImage(ctx, image, x, y, radius);
}

function drawCharacter(ctx: CanvasRenderingContext2D): void {
  const { x, y, radius } = character;
  const px = snapCirclePoint(x);
  const py = snapCirclePoint(y);
  const baseColor = character.baseColor || '#FFFFFF';

  drawSolidCircleBase(ctx, px, py, radius, baseColor);

  drawHardClippedCircleImage(ctx, paintCanvas, px, py, radius);

  // 기본 가장자리는 base fill/stroke에서만 처리합니다.
  // 별도 stroke를 추가하지 않아 술래 화면에 테두리 힌트가 생기지 않게 합니다.
  if (showCharacterGuide) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(47, 38, 29, 0.82)';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function isRevealPhase(phase?: GamePhase): boolean {
  return phase === 'reveal' || phase === 'find' || phase === 'result';
}

function isSpyBlindPhase(phase?: GamePhase): boolean {
  return phase === 'loading' || phase === 'role_assignment' || phase === 'decorate' || phase === 'submit';
}

function shouldHideArtworkFromSpy(): boolean {
  const me = getMe(currentRoom);
  const phase = currentRoom?.game?.phase;
  return me?.role === 'spy' && isSpyBlindPhase(phase);
}

function drawSpyBlindScreen(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  ctx.fillStyle = 'rgba(255, 246, 226, 0.92)';
  ctx.font = '700 22px Arial, "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('술래 대기 중', gameCanvas.width / 2, gameCanvas.height / 2 - 18);

  ctx.fillStyle = 'rgba(255, 246, 226, 0.72)';
  ctx.font = '500 14px Arial, "Malgun Gothic", sans-serif';
  ctx.fillText('아티스트가 원을 숨기는 동안 그림을 볼 수 없습니다.', gameCanvas.width / 2, gameCanvas.height / 2 + 14);
  ctx.restore();
}

function getSubmissionCircle(submission: ArtworkSubmission): { x: number; y: number; radius: number } {
  return {
    x: submission.character.xRatio * gameCanvas.width,
    y: submission.character.yRatio * gameCanvas.height,
    radius: submission.character.radiusRatio * Math.min(gameCanvas.width, gameCanvas.height)
  };
}

function getSubmissionImage(submission: ArtworkSubmission): HTMLImageElement | null {
  const cached = submissionImageCache.get(submission.playerId);
  if (cached && cached.src === submission.paintDataUrl && cached.complete) return cached;

  const image = cached && cached.src === submission.paintDataUrl ? cached : new Image();
  if (!cached || cached.src !== submission.paintDataUrl) {
    image.onload = () => renderGameCanvas();
    image.src = submission.paintDataUrl;
    submissionImageCache.set(submission.playerId, image);
  }
  return image.complete ? image : null;
}

function drawSubmission(
  ctx: CanvasRenderingContext2D,
  submission: ArtworkSubmission,
  selected: boolean,
  showHiddenGuide: boolean,
  hideCircleShell: boolean
): void {
  const { x, y, radius } = getSubmissionCircle(submission);
  const px = snapCirclePoint(x);
  const py = snapCirclePoint(y);
  const image = getSubmissionImage(submission);

  if (hideCircleShell) {
    // 술래 화면에서는 별도 흰 원판/base circle을 그리지 않습니다.
    // 도망자의 paintCanvas 자체가 흰색 배경을 가지고 있으므로,
    // 제출 이미지 픽셀만 원형으로 잘라 그리면 별도 stroke/halo가 생길 경로가 사라집니다.
    if (image) drawSpySafeCircleImage(ctx, image, px, py, radius);
  } else {
    const baseColor = submission.character.baseColor || '#FFFFFF';
    drawSolidCircleBase(ctx, px, py, radius, baseColor);
    if (image) drawHardClippedCircleImage(ctx, image, px, py, radius);
  }

  // 술래의 REVEAL/FIND 화면에서는 원의 외곽선, 선택선, 점선 가이드가 힌트가 될 수 있으므로
  // 흰 원판과 내부 그림만 그리고 여기서 종료합니다.
  if (hideCircleShell) return;

  // FIND 단계에서는 술래가 실제로 숨은 원을 찾아야 하므로
  // 선택 전 점선 가이드를 표시하지 않습니다.
  if (!selected && !showHiddenGuide) return;

  ctx.save();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = selected ? 5 : 2;
  ctx.setLineDash(selected ? [] : [8, 6]);
  ctx.strokeStyle = selected ? 'rgba(202, 57, 57, 0.95)' : 'rgba(47, 38, 29, 0.62)';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function getSpyVisionProgress(): number {
  const me = getMe(currentRoom);
  const phase = currentRoom?.game?.phase;
  if (me?.role !== 'spy') return 0;
  if (phase === 'find') return 1;
  if (phase !== 'reveal') return 0;

  const startedAt = currentRoom?.game?.phaseStartedAt || Date.now();
  const elapsed = Date.now() - startedAt;
  if (elapsed <= SPY_FULL_VIEW_MS) return 0;
  return Math.min(1, (elapsed - SPY_FULL_VIEW_MS) / SPY_DARKEN_MS);
}

function updateSpyOverlaySize(): void {
  spyVisionOverlay.style.width = `${gameCanvas.width * zoomLevel}px`;
  spyVisionOverlay.style.height = `${gameCanvas.height * zoomLevel}px`;
}

function updateSpyVisionOverlay(event?: PointerEvent): void {
  const me = getMe(currentRoom);
  const phase = currentRoom?.game?.phase;
  const active = me?.role === 'spy' && (phase === 'reveal' || phase === 'find');
  const progress = getSpyVisionProgress();

  spyVisionOverlay.classList.toggle('is-active', Boolean(active && progress > 0));
  spyVisionOverlay.classList.toggle('is-find', Boolean(active && phase === 'find'));

  if (!active || progress <= 0) return;

  if (event) {
    const rect = gameCanvasViewport.getBoundingClientRect();
    const x = event.clientX - rect.left + gameCanvasViewport.scrollLeft;
    const y = event.clientY - rect.top + gameCanvasViewport.scrollTop;
    spyVisionOverlay.style.setProperty('--spotlight-x', `${x}px`);
    spyVisionOverlay.style.setProperty('--spotlight-y', `${y}px`);
  }

  const radius = SPY_LIGHT_RADIUS * zoomLevel;
  const edge = SPY_LIGHT_EDGE * zoomLevel;
  spyVisionOverlay.style.setProperty('--spotlight-radius', `${radius}px`);
  spyVisionOverlay.style.setProperty('--spotlight-edge', `${radius + edge}px`);
  spyVisionOverlay.style.setProperty('--spy-darkness', `${0.92 * progress}`);
}

function drawSpyFlashlight(_ctx: CanvasRenderingContext2D): void {
  updateSpyVisionOverlay();
}

function drawSpyCrosshair(_ctx: CanvasRenderingContext2D): void {
  updateSpyVisionOverlay();
}

function scheduleSpyVisionAnimation(): void {
  if (spyVisionAnimationFrame !== null) return;
  const tick = () => {
    spyVisionAnimationFrame = null;
    const me = getMe(currentRoom);
    const phase = currentRoom?.game?.phase;
    if (me?.role !== 'spy' || (phase !== 'reveal' && phase !== 'find')) return;
    updateSpyVisionOverlay();
    if (phase === 'reveal' && getSpyVisionProgress() < 1) {
      spyVisionAnimationFrame = window.requestAnimationFrame(tick);
    }
  };
  spyVisionAnimationFrame = window.requestAnimationFrame(tick);
}

function getSubmissionAtPoint(point: { x: number; y: number }): ArtworkSubmission | null {
  const submissions = currentRoom?.game?.submissions || [];
  for (let index = submissions.length - 1; index >= 0; index -= 1) {
    const submission = submissions[index];
    if (submission.caught || currentRoom?.game?.caughtTargetIds.includes(submission.playerId)) continue;
    const circle = getSubmissionCircle(submission);
    const dx = point.x - circle.x;
    const dy = point.y - circle.y;
    if (dx * dx + dy * dy <= circle.radius * circle.radius) return submission;
  }
  return null;
}


function isSubmissionCaught(submission: ArtworkSubmission): boolean {
  return Boolean(submission.caught || currentRoom?.game?.caughtTargetIds.includes(submission.playerId));
}

function drawCaughtMark(ctx: CanvasRenderingContext2D, submission: ArtworkSubmission): void {
  const { x, y, radius } = getSubmissionCircle(submission);
  const markRadius = radius * 0.58;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  ctx.setLineDash([]);
  ctx.lineWidth = Math.max(4, radius * 0.08);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(202, 57, 57, 0.96)';
  ctx.beginPath();
  ctx.moveTo(x - markRadius, y - markRadius);
  ctx.lineTo(x + markRadius, y + markRadius);
  ctx.moveTo(x + markRadius, y - markRadius);
  ctx.lineTo(x - markRadius, y + markRadius);
  ctx.stroke();
  ctx.restore();
}

function renderGameCanvas(): void {
  resetCanvasDrawState(gameCtx);
  const phase = currentRoom?.game?.phase;

  if (shouldHideArtworkFromSpy()) {
    spyVisionOverlay.classList.remove('is-active', 'is-find');
    drawSpyBlindScreen(gameCtx);
    return;
  }

  drawBackgroundOnly(gameCtx);

  if (currentRoom?.game && isRevealPhase(phase)) {
    const me = getMe(currentRoom);
    const isSpy = me?.role === 'spy';

    currentRoom.game.submissions.forEach((submission) => {
      const selected = currentRoom?.game?.selectedTargetId === submission.playerId;
      // 술래에게는 REVEAL/FIND 중 숨은 원의 점선 가이드를 절대 보여주지 않습니다.
      // RESULT에서는 선택 결과 확인용 테두리만 표시합니다.
      const hideCircleShell = isSpy && (phase === 'reveal' || phase === 'find');
      const showHiddenGuide = phase === 'result' || (!isSpy && phase === 'reveal');
      drawSubmission(gameCtx, submission, selected, showHiddenGuide, hideCircleShell);
      if (isSubmissionCaught(submission)) drawCaughtMark(gameCtx, submission);
    });
  } else if (isArtistPlayer()) {
    ensureCharacterInsideCanvas();
    drawCharacter(gameCtx);
  }

  drawSpyFlashlight(gameCtx);
  drawSpyCrosshair(gameCtx);
  scheduleSpyVisionAnimation();
}

async function loadGameArtwork(room: PublicRoom): Promise<void> {
  const artwork = room.game?.artwork || room.artwork;
  const src = getArtworkUrl(artwork);
  if (gameImage && gameImageUrl === src) {
    renderGameCanvas();
    return;
  }

  gameImageUrl = src;
  gameImage = null;
  renderGameCanvas();

  try {
    gameImage = await loadImage(src);
    resizeGameCanvasToArtwork(true);
    renderGameCanvas();
  } catch (error) {
    console.warn('[BobArtist] artwork load failed', error);
    setMessage('원본 이미지를 불러오지 못했습니다.', 'error');
  }
}

function getCanvasPoint(event: PointerEvent): { x: number; y: number } {
  const rect = gameCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * gameCanvas.width,
    y: ((event.clientY - rect.top) / rect.height) * gameCanvas.height
  };
}

function sendFocusPointer(point: { x: number; y: number }, force = false): void {
  const me = getMe(currentRoom);
  if (me?.role !== 'spy' || currentRoom?.game?.phase !== 'find') return;

  const now = Date.now();
  if (!force && now - lastFocusPointerSentAt < 150) return;
  lastFocusPointerSentAt = now;

  socket?.emit('focus_pointer', {
    xRatio: gameCanvas.width > 0 ? point.x / gameCanvas.width : 0,
    yRatio: gameCanvas.height > 0 ? point.y / gameCanvas.height : 0,
    canvasWidth: gameCanvas.width,
    canvasHeight: gameCanvas.height
  });
}

function resetFocusScores(): void {
  latestFocusScores = null;
  focusScoreLabel.textContent = 'Focus Score';
  focusScoreView.textContent = '아직 누적 점수 없음';
  topScoreLabel.textContent = '술래 점수';
  topScoreView.textContent = '대기';
}

function setScoreText(label: string, value: string): void {
  focusScoreLabel.textContent = label;
  focusScoreView.textContent = value;
  topScoreLabel.textContent = label;
  topScoreView.textContent = value;
}

function ensureCharacterInsideCanvas(): void {
  if (!gameCanvas.width || !gameCanvas.height) return;
  const maxRadius = Math.max(20, Math.min(200, Math.min(gameCanvas.width, gameCanvas.height) * 0.35));
  character.radius = Math.min(maxRadius, Math.max(10, character.radius));
  character.x = Math.min(gameCanvas.width - character.radius, Math.max(character.radius, character.x));
  character.y = Math.min(gameCanvas.height - character.radius, Math.max(character.radius, character.y));
}

function renderFocusScores(): void {
  const me = getMe(currentRoom);
  const phase = currentRoom?.game?.phase;
  const isFindPhase = phase === 'find';
  const canViewFocus = isFindPhase && (me?.role === 'spy' || me?.role === 'artist');
  focusScorePanel.classList.toggle('hidden', !canViewFocus);
  topScorePanel.classList.toggle('is-active', canViewFocus);

  if (!canViewFocus) {
    setScoreText('술래 점수', phase === 'result' ? '종료' : '대기');
    return;
  }

  const scores = latestFocusScores?.scores || [];

  if (me?.role === 'artist') {
    const ownScore = scores[0]?.score || 0;
    setScoreText('내 점수', `${Math.round(ownScore)}점`);
    return;
  }

  if (latestFocusScores?.audience !== 'spy_snapshot' || !scores.length) {
    setScoreText('술래 점수', '10초마다 공개');
    return;
  }

  const totalScore = scores.reduce((sum, item) => sum + item.score, 0);
  setScoreText('술래 점수', `${Math.round(totalScore)}점`);
}

function pointInCharacter(x: number, y: number): boolean {
  const dx = x - character.x;
  const dy = y - character.y;
  return dx * dx + dy * dy <= character.radius * character.radius;
}

function getPaintPoint(point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: ((point.x - (character.x - character.radius)) / (character.radius * 2)) * paintCanvas.width,
    y: ((point.y - (character.y - character.radius)) / (character.radius * 2)) * paintCanvas.height
  };
}

function paintAt(point: { x: number; y: number }, previousPoint: { x: number; y: number } | null): void {
  if (!pointInCharacter(point.x, point.y)) return;

  const localPoint = getPaintPoint(point);
  const localPreviousPoint = previousPoint ? getPaintPoint(previousPoint) : localPoint;
  const localBrushSize = brushSize * (paintCanvas.width / (character.radius * 2));

  paintCtx.save();
  paintCtx.lineCap = 'round';
  paintCtx.lineJoin = 'round';
  paintCtx.strokeStyle = selectedColor;
  paintCtx.fillStyle = selectedColor;
  paintCtx.lineWidth = localBrushSize;

  paintCtx.beginPath();
  paintCtx.moveTo(localPreviousPoint.x, localPreviousPoint.y);
  paintCtx.lineTo(localPoint.x, localPoint.y);
  paintCtx.stroke();

  paintCtx.beginPath();
  paintCtx.arc(localPoint.x, localPoint.y, localBrushSize / 2, 0, Math.PI * 2);
  paintCtx.fill();
  paintCtx.restore();

  renderGameCanvas();
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function sampleColor(point: { x: number; y: number }): void {
  if (!gameImage) return;
  drawBackgroundOnly(gameCtx);
  const pixel = gameCtx.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data;
  selectedColor = rgbToHex(pixel[0], pixel[1], pixel[2]);
  updateColorStatus();
  renderGameCanvas();
  setMessage(`스포이드 색상 선택: ${selectedColor.toUpperCase()}`, 'success');
}

function submitCurrentArtwork(): void {
  clearAutoSubmitTimeout();
  const me = getMe(currentRoom);
  if (me?.role === 'artist') {
    socket?.emit('submit_artwork', {
      character: {
        xRatio: character.x / gameCanvas.width,
        yRatio: character.y / gameCanvas.height,
        radiusRatio: character.radius / Math.min(gameCanvas.width, gameCanvas.height),
        baseColor: character.baseColor
      },
      paintDataUrl: paintCanvas.toDataURL('image/png')
    });
    return;
  }
  socket?.emit('submit_artwork');
}

function renderLobbyActions(room: PublicRoom | null): void {
  const me = getMe(room);
  const isLobby = room?.state === 'lobby';
  const isHost = Boolean(me?.isHost);

  readyButton.disabled = !room || !isLobby || isHost;
  readyButton.textContent = isHost ? '방장은 자동 준비' : (me?.ready ? '준비 취소' : '준비');
  readyButton.classList.toggle('ready-on', Boolean(isHost || me?.ready));

  startGameButton.disabled = !room || !isLobby || !isHost || !room.canStart;
  startGameButton.classList.toggle('start-active', Boolean(room && isLobby && isHost && room.canStart));

  if (!room) {
    startHint.textContent = '방에 입장하면 참가자는 준비할 수 있습니다.';
  } else if (isHost && room.playerCount < room.maxPlayers) {
    startHint.textContent = '최소 1명의 도망자가 입장하면 게임을 시작할 수 있습니다.';
  } else if (isHost && !room.canStart) {
    startHint.textContent = '도망자 READY를 기다리는 중입니다. 술래는 준비 버튼이 필요 없습니다.';
  } else if (isHost) {
    startHint.textContent = '도망자 준비 완료. 방장이 게임을 시작할 수 있습니다.';
  } else if (!me?.ready) {
    startHint.textContent = '도망자는 준비 버튼을 눌러야 합니다. 방장은 술래라 자동 준비 상태입니다.';
  } else {
    startHint.textContent = '준비 완료. 방장이 게임을 시작할 때까지 기다려 주세요.';
  }
}

function renderLobbyRoom(room: PublicRoom | null): void {
  if (!room) {
    roomTitle.textContent = '아직 입장한 방 없음';
    roomCodeView.textContent = '------';
    phaseView.textContent = 'LOBBY';
    phaseView.className = 'phase phase-lobby';
    artworkView.textContent = '원본 이미지 없음';
    playerList.innerHTML = '<li>참가자 없음</li>';
    renderLobbyActions(null);
    if (!selectedArtwork) drawEmptyLobbyCanvas();
    return;
  }

  roomTitle.textContent = `${room.playerCount}/${room.maxPlayers}명 연결됨`;
  roomCodeView.textContent = room.code;
  phaseView.textContent = getStateLabel(room.state);
  phaseView.className = `phase phase-${room.state}`;
  artworkView.textContent = `${room.artwork.fileName} · ${formatBytes(room.artwork.sizeBytes)}`;
  roomCodeInput.value = room.code;
  localStorage.setItem(STORAGE_KEYS.lastRoomCode, room.code);

  playerList.innerHTML = room.players.map((player) => {
    const me = player.id === mySocketId ? '나' : '상대';
    const host = player.isHost ? '👑 방장' : '참가자';
    const ready = player.isHost ? '🟣 AUTO READY' : (player.ready ? '🟢 READY' : '⚪ NOT READY');
    const role = player.role ? ` · ${getRoleLabel(player.role)}` : '';
    const submit = player.submitted ? ' · 제출 완료' : '';
    return `<li><strong>${player.name}</strong><span>${me} · ${host}${role}</span><em>${ready}${submit}</em></li>`;
  }).join('');

  renderLobbyActions(room);
  void drawLobbyRoomCanvas(room);
}



function clearAutoSubmitTimeout(): void {
  if (autoSubmitTimeout !== null) {
    window.clearTimeout(autoSubmitTimeout);
    autoSubmitTimeout = null;
  }
}

function scheduleAutoSubmit(room: PublicRoom): void {
  const me = getMe(room);
  const phase = room.game?.phase;
  if (!room.game || me?.role !== 'artist' || me.submitted || (phase !== 'decorate' && phase !== 'submit')) {
    clearAutoSubmitTimeout();
    autoSubmitKey = '';
    return;
  }

  const key = `${room.code}:${room.game.round}:${room.game.phaseStartedAt}:${mySocketId}`;
  if (autoSubmitKey === key && autoSubmitTimeout !== null) return;

  clearAutoSubmitTimeout();
  autoSubmitKey = key;

  const remaining = getRemainingGameTime(room);
  const delay = Math.max(0, remaining + 80);
  autoSubmitTimeout = window.setTimeout(() => {
    autoSubmitTimeout = null;
    const latestMe = getMe(currentRoom);
    const latestPhase = currentRoom?.game?.phase;
    if (latestMe?.role === 'artist' && !latestMe.submitted && (latestPhase === 'decorate' || latestPhase === 'submit')) {
      submitCurrentArtwork();
      setMessage('그리기 시간이 종료되어 자동 제출했습니다.', 'success');
    }
  }, delay);
}

function formatRemainingTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getPhaseDurationMs(phase?: GamePhase): number {
  if (phase === 'decorate' || phase === 'submit') return DECORATE_DURATION_MS;
  if (phase === 'find') return FIND_DURATION_MS;
  return 0;
}

function getRemainingGameTime(room: PublicRoom | null): number {
  if (!room?.game || room.game.phase === 'result') return 0;
  const duration = getPhaseDurationMs(room.game.phase);
  if (duration <= 0) return 0;
  return Math.max(0, room.game.phaseStartedAt + duration - Date.now());
}

function renderGameTimer(): void {
  if (!currentRoom?.game) {
    gameTimerView.textContent = '--:--';
    topTimerView.textContent = '--:--';
    clearAutoSubmitTimeout();
    return;
  }
  if (currentRoom.game.phase === 'result') {
    gameTimerView.textContent = '종료';
    topTimerView.textContent = '종료';
    clearAutoSubmitTimeout();
    return;
  }

  const duration = getPhaseDurationMs(currentRoom.game.phase);
  const text = duration > 0 ? formatRemainingTime(getRemainingGameTime(currentRoom)) : '대기';
  gameTimerView.textContent = text;
  topTimerView.textContent = text;

  if ((currentRoom.game.phase === 'decorate' || currentRoom.game.phase === 'submit')
    && duration > 0
    && getRemainingGameTime(currentRoom) <= 0
    && getMe(currentRoom)?.role === 'artist'
    && !getMe(currentRoom)?.submitted) {
    submitCurrentArtwork();
  }
}

function startGameTimerTicker(): void {
  if (gameTimerInterval !== null) return;
  gameTimerInterval = window.setInterval(() => {
    if (!currentRoom?.game || currentRoom.game.phase === 'result') {
      renderGameTimer();
      stopGameTimerTicker();
      return;
    }
    renderGameTimer();
  }, 1000);
}

function stopGameTimerTicker(): void {
  if (gameTimerInterval === null) return;
  window.clearInterval(gameTimerInterval);
  gameTimerInterval = null;
}

function renderGameRoom(room: PublicRoom): void {
  showGamePage();
  const me = getMe(room);
  const phase = room.game?.phase || 'loading';
  const phaseLabel = getPhaseLabel(phase);
  const roleLabel = getRoleLabel(me?.role);
  const canDecorate = me?.role === 'artist' && (phase === 'decorate' || phase === 'submit');
  const canSubmit = me?.role === 'artist' && (phase === 'decorate' || phase === 'submit');
  const canFind = me?.role === 'spy' && phase === 'find';
  const isSpy = me?.role === 'spy';
  const isHost = Boolean(me?.isHost);
  const canRestart = isHost && phase === 'result';

  gameTitle.textContent = `ROUND ${room.game?.round || 1} · ${phaseLabel}`;
  gameSubTitle.textContent = getPhaseMessage(phase);
  gameRoomCode.textContent = room.code;
  gamePhaseView.textContent = phaseLabel;
  renderGameTimer();
  scheduleAutoSubmit(room);
  if (phase === 'result') stopGameTimerTicker();
  else startGameTimerTicker();
  gameArtworkNameView.textContent = room.game?.artwork.fileName || room.artwork.fileName;
  gamePlayerCountView.textContent = `${room.playerCount}/${room.maxPlayers}`;
  renderFocusScores();

  myRoleView.textContent = roleLabel;
  roleDescriptionView.textContent = isSpy
    ? '술래입니다. 직접 원을 꾸미지 않고, 도망자들이 숨긴 원을 찾는 입장입니다.'
    : me?.role === 'artist'
      ? '도망자입니다. 원을 자연스럽게 꾸며 술래가 찾기 어렵게 만드세요.'
      : '역할 배정을 기다리는 중입니다.';
  roleCard.className = `role-card role-${me?.role || 'unknown'}`;

  submitArtworkButton.disabled = !canSubmit || Boolean(me?.submitted);
  submitArtworkButton.textContent = isSpy ? '술래 대기 중' : (me?.submitted ? '제출 완료' : '제출');
  confirmFindButton.disabled = true;
  restartGameButton.disabled = !canRestart;
  confirmFindButton.textContent = phase === 'find' ? '클릭하면 잡힘 처리' : '찾기 단계 대기';
  restartGameButton.textContent = canRestart ? '다시 시작' : 'RESULT 후 다시 시작';
  if (phase !== 'find') resetFocusScores();
  renderFocusScores();

  if (phase === 'result' && room.game?.result) {
    submitStatusView.textContent = room.game.result.success ? `🎯 술래 승리: ${room.game.result.message}` : `🏃 도망자 승리: ${room.game.result.message}`;
  } else if (phase === 'find') {
    const caughtIds = room.game?.caughtTargetIds || [];
    const runnerCount = room.players.filter((player) => player.role === 'artist').length;
    const caughtNames = room.players
      .filter((player) => caughtIds.includes(player.id))
      .map((player) => player.name)
      .join(', ');
    submitStatusView.textContent = caughtIds.length > 0
      ? `잡힌 도망자: ${caughtIds.length}/${runnerCount}명${caughtNames ? ` (${caughtNames})` : ''} · 남은 도망자를 계속 찾으세요.`
      : `도망자 0/${runnerCount}명 잡힘 · 숨은 원을 클릭하면 바로 잡힘 처리됩니다.`;
  } else {
    submitStatusView.textContent = room.players
      .map((player) => `${player.name}: ${player.role === 'spy' ? '술래 대기 중' : player.submitted ? '제출 완료' : '작성 중'}`)
      .join(' / ');
  }

  brushSizeInput.disabled = !canDecorate;
  characterSizeInput.disabled = !canDecorate;
  resetCharacterButton.disabled = !canDecorate;
  gameCanvasViewport.classList.toggle('spy-crosshair-mode', canFind);
  toolHint.textContent = isSpy
    ? (canFind ? '도망자는 실시간 점수를 보고, 술래는 제한 시간 안에 원을 찾습니다.' : '술래는 꾸미기 도구를 사용할 수 없습니다. 제한 시간 안에 도망자의 원을 찾습니다.')
    : (isRevealPhase(phase) ? '제출 후에는 이동과 그리기가 잠깁니다. 술래의 선택을 기다립니다.' : '기본은 항상 붓입니다. Space로 색을 가져오고 WASD로 이동합니다.');

  void loadGameArtwork(room);
}

function renderRoom(room: PublicRoom | null): void {
  currentRoom = room;

  if (!room) {
    lastRenderedRound = 0;
    showLobbyPage();
    renderLobbyRoom(null);
    return;
  }

  if (room.state === 'playing') {
    const round = room.game?.round || 0;
    if (round > 0 && round !== lastRenderedRound) {
      lastRenderedRound = round;
      resetRoundLocalState();
    }
    renderGameRoom(room);
    return;
  }

  lastRenderedRound = 0;
  showLobbyPage();
  renderLobbyRoom(room);
}

function connectSocket(): void {
  socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    console.log('[BobArtist] socket connected', socket?.id);
    setSocketStatus('연결됨', 'ok');
    setMessage('서버와 연결되었습니다.', 'success');
  });

  socket.on('disconnect', () => {
    console.log('[BobArtist] socket disconnected');
    setSocketStatus('연결 끊김', 'bad');
    setMessage('서버 연결이 끊겼습니다. 서버 실행 상태를 확인해 주세요.', 'error');
    lastRenderedRound = 0;
    renderRoom(null);
  });

  socket.on('server_ready', (payload: ServerReady) => {
    console.log('[BobArtist] server_ready', payload);
    mySocketId = payload.socketId;
    setMessage(`서버 준비 완료: v${payload.version}`, 'success');
    renderRoom(currentRoom);
  });

  socket.on('room_created', (room: PublicRoom) => {
    console.log('[BobArtist] room_created', room);
    setMessage(`방이 생성되었습니다. 코드: ${room.code}`, 'success');
    renderRoom(room);
  });

  socket.on('room_joined', (room: PublicRoom) => {
    console.log('[BobArtist] room_joined', room);
    setMessage(`방 ${room.code}에 입장했습니다.`, 'success');
    renderRoom(room);
  });

  socket.on('focus_scores', (payload: FocusScorePayload) => {
    latestFocusScores = payload;
    renderFocusScores();
  });

  socket.on('room_state', (room: PublicRoom) => {
    console.log('[BobArtist] room_state', room);
    renderRoom(room);
  });

  socket.on('game_started', (room: PublicRoom) => {
    console.log('[BobArtist] game_started', room);
    setMessage('게임이 시작되었습니다.', 'success');
    renderRoom(room);
  });

  socket.on('game_restarted', (room: PublicRoom) => {
    console.log('[BobArtist] game_restarted', room);
    setMessage(`ROUND ${room.game?.round || 1} 다시 시작`, 'success');
    renderRoom(room);
  });

  socket.on('room_left', () => {
    console.log('[BobArtist] room_left');
    setMessage('방에서 나왔습니다.', 'normal');
    gameImage = null;
    gameImageUrl = '';
    renderRoom(null);
  });

  socket.on('room_error', (payload: { message: string }) => {
    console.warn('[BobArtist] room_error', payload);
    setMessage(payload.message, 'error');
  });
}

artworkInput.addEventListener('change', async () => {
  const file = artworkInput.files?.[0];
  selectedArtwork = null;

  if (!file) {
    uploadInfo.textContent = '방을 만들 사람은 원본 이미지를 먼저 선택해 주세요.';
    drawEmptyLobbyCanvas();
    return;
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    artworkInput.value = '';
    uploadInfo.textContent = 'PNG, JPG, JPEG 이미지만 사용할 수 있습니다.';
    setMessage('이미지 형식이 올바르지 않습니다.', 'error');
    drawEmptyLobbyCanvas();
    return;
  }

  if (file.size > MAX_IMAGE_BYTES) {
    artworkInput.value = '';
    uploadInfo.textContent = '이미지는 최대 5MB까지만 사용할 수 있습니다.';
    setMessage('이미지 용량이 5MB를 초과했습니다.', 'error');
    drawEmptyLobbyCanvas();
    return;
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });

  selectedArtwork = {
    dataUrl,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size
  };

  uploadInfo.textContent = `${file.name} · ${formatBytes(file.size)} · 방 생성 가능`;
  setMessage('원본 이미지가 선택되었습니다.', 'success');
  await drawSelectedArtworkPreview();
});

createRoomButton.addEventListener('click', () => {
  if (!socket?.connected) {
    setMessage('서버에 연결되지 않았습니다.', 'error');
    return;
  }

  if (!selectedArtwork) {
    setMessage('방을 만들려면 원본 이미지를 먼저 업로드해 주세요.', 'error');
    return;
  }

  socket.emit('create_room', {
    playerName: getPlayerName(),
    artwork: selectedArtwork
  });
});

joinRoomButton.addEventListener('click', () => {
  if (!socket?.connected) {
    setMessage('서버에 연결되지 않았습니다.', 'error');
    return;
  }

  const roomCode = getRoomCode();
  if (roomCode.length !== 6) {
    setMessage('6자리 방 코드를 입력해 주세요.', 'error');
    return;
  }

  socket.emit('join_room', { roomCode, playerName: getPlayerName() });
});

leaveRoomButton.addEventListener('click', () => socket?.emit('leave_room'));
gameLeaveButton.addEventListener('click', () => socket?.emit('leave_room'));
readyButton.addEventListener('click', () => socket?.emit('toggle_ready'));
startGameButton.addEventListener('click', () => socket?.emit('start_game'));
submitArtworkButton.addEventListener('click', () => submitCurrentArtwork());
confirmFindButton.addEventListener('click', () => socket?.emit('confirm_find'));
restartGameButton.addEventListener('click', () => socket?.emit('restart_game'));
roomCodeInput.addEventListener('input', () => { getRoomCode(); });
playerNameInput.addEventListener('change', () => { getPlayerName(); });

resetCharacterButton.addEventListener('click', () => resetCharacter());

brushSizeInput.addEventListener('input', () => {
  brushSize = Number(brushSizeInput.value);
  updateBrushStatus();
});

characterSizeInput.addEventListener('input', () => {
  character.radius = Number(characterSizeInput.value) / 2;
  updateCharacterSizeStatus();
  renderGameCanvas();
});

gameCanvas.addEventListener('wheel', (event) => {
  if (!event.shiftKey) return;
  event.preventDefault();
  zoomLevel += event.deltaY < 0 ? 0.1 : -0.1;
  zoomLevel = Math.round(zoomLevel * 10) / 10;
  applyZoom();
  flashHud(zoomHud);
}, { passive: false });

gameCanvas.addEventListener('pointerdown', (event) => {
  const point = getCanvasPoint(event);
  lastMousePoint = point;
  updateSpyVisionOverlay(event);
  sendFocusPointer(point, true);

  const me = getMe(currentRoom);
  const phase = currentRoom?.game?.phase;
  if (me?.role === 'spy' && phase === 'find') {
    const target = getSubmissionAtPoint(point);
    if (target) {
      socket?.emit('find_target', { targetId: target.playerId });
    } else {
      updateToolHint('마우스 포인터로 아직 잡히지 않은 도망자 원 내부를 클릭해 주세요.');
      renderGameCanvas();
    }
    return;
  }

  if (!canArtistDecorate()) return;

  if (!pointInCharacter(point.x, point.y)) return;
  isPainting = true;
  lastPaintPoint = point;
  paintAt(point, null);
  gameCanvas.setPointerCapture(event.pointerId);
});

gameCanvas.addEventListener('pointermove', (event) => {
  const point = getCanvasPoint(event);
  lastMousePoint = point;
  updateSpyVisionOverlay(event);
  sendFocusPointer(point);

  const me = getMe(currentRoom);
  const phase = currentRoom?.game?.phase;
  if (me?.role === 'spy' && (phase === 'reveal' || phase === 'find')) updateSpyVisionOverlay(event);

  if (!isPainting) return;
  paintAt(point, lastPaintPoint);
  lastPaintPoint = point;
});

function stopCanvasAction(event?: PointerEvent): void {
  isPainting = false;
  lastPaintPoint = null;
  if (event) {
    try { gameCanvas.releasePointerCapture(event.pointerId); } catch { /* noop */ }
  }
}

gameCanvas.addEventListener('pointerup', (event) => stopCanvasAction(event));
gameCanvas.addEventListener('pointercancel', (event) => stopCanvasAction(event));
gameCanvas.addEventListener('pointerleave', () => stopCanvasAction());

document.addEventListener('keydown', (event) => {
  if (gamePage.classList.contains('hidden')) return;
  const target = event.target as HTMLElement | null;
  if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;

  const key = event.key.toLowerCase();
  const moveKeys: Record<string, [number, number]> = {
    w: [0, -1],
    arrowup: [0, -1],
    a: [-1, 0],
    arrowleft: [-1, 0],
    s: [0, 1],
    arrowdown: [0, 1],
    d: [1, 0],
    arrowright: [1, 0]
  };

  if (event.code === 'Space') {
    if (!canArtistDecorate()) return;
    event.preventDefault();
    if (lastMousePoint) {
      sampleColor(lastMousePoint);
      flashHud(sampleHud);
      updateToolHint(`Space 색 추출 완료: ${selectedColor.toUpperCase()}`);
    } else {
      updateToolHint('마우스를 원본 이미지 위에 올린 뒤 Space를 눌러주세요.');
    }
    return;
  }

  if (moveKeys[key]) {
    if (!canArtistDecorate()) return;
    event.preventDefault();
    const [dx, dy] = moveKeys[key];
    const speed = event.ctrlKey ? 1 : event.shiftKey ? 10 : 2;
    character.x = Math.min(gameCanvas.width, Math.max(0, character.x + dx * speed));
    character.y = Math.min(gameCanvas.height, Math.max(0, character.y + dy * speed));
    flashHud(moveHud);
    renderGameCanvas();
    return;
  }

  if (key === 'q' || key === 'e') {
    if (!canArtistDecorate()) return;
    event.preventDefault();
    const delta = key === 'e' ? 2 : -2;
    character.radius = Math.min(100, Math.max(10, character.radius + delta));
    characterSizeInput.value = String(character.radius * 2);
    updateCharacterSizeStatus();
    flashHud(sizeHud);
    renderGameCanvas();
    return;
  }

  if (event.key === '[' || event.key === ']') {
    if (!canArtistDecorate()) return;
    event.preventDefault();
    brushSize = Math.min(20, Math.max(1, brushSize + (event.key === ']' ? 1 : -1)));
    brushSizeInput.value = String(brushSize);
    updateBrushStatus();
    flashHud(brushHud);
    return;
  }

  if (key === 't') {
    if (!canArtistDecorate()) return;
    event.preventDefault();
    showCharacterGuide = !showCharacterGuide;
    flashHud(guideHud);
    updateToolHint(showCharacterGuide ? '내 원 위치 가이드 ON' : '내 원 위치 가이드 OFF');
    renderGameCanvas();
    return;
  }

  if (key === 'r') {
    if (!canArtistDecorate()) return;
    event.preventDefault();
    if (window.confirm('원 내부 칠하기와 위치를 초기화할까요?')) {
      resetCharacter();
      flashHud(resetHud);
    }
    return;
  }

  if (event.shiftKey && key === '0') {
    event.preventDefault();
    zoomLevel = 1;
    applyZoom();
    flashHud(zoomHud);
  }
});


window.addEventListener('resize', () => {
  if (gamePage.classList.contains('hidden')) return;
  if (resizeTimer !== null) window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeGameCanvasToArtwork(false);
    renderGameCanvas();
  }, 120);
});

updateColorStatus();
updateToolHint('Restart Engine: RESULT 이후 방장만 새 라운드를 시작합니다.');
drawEmptyLobbyCanvas();
connectSocket();
