import "./platform.css";

const VERSION = "0.0.67";
const appElement = document.querySelector<HTMLDivElement>("#app");

if (!appElement) {
  throw new Error("#app element not found");
}

const app = appElement;

type PlatformRoute = "lobby" | "bobartist" | "yacht-dice" | "indian-poker" | "admin-chat";

function getRoute(): PlatformRoute {
  const route = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  if (route === "bobartist") return "bobartist";
  if (route === "yacht-dice") return "yacht-dice";
  if (route === "indian-poker") return "indian-poker";
  if (route === "admin/chat") return "admin-chat";
  return "lobby";
}

function navigate(route: PlatformRoute): void {
  window.location.hash = route === "lobby" ? "/" : `/${route}`;
}

function renderLobby(): void {
  document.title = `BobPlatform v${VERSION}`;
  document.body.classList.add("platform-body");
  app.innerHTML = `
    <main class="platform-page">
      <section class="platform-hero">
        <p class="platform-eyebrow">MULTIPLAYER WEB GAME PLATFORM</p>
        <h1>BobPlatform</h1>
        <p class="platform-version">v${VERSION}</p>
        <p class="platform-description">플레이할 게임을 선택하세요.</p>
      </section>

      <section class="platform-game-list" aria-label="게임 목록">
        <button id="openBobArtist" class="platform-game-card" type="button">
          <span class="platform-game-status playable">PLAYABLE</span>
          <strong>BobArtist</strong>
          <span>명화 속에 숨은 아티스트를 찾아내는 실시간 멀티플레이 게임</span>
          <em>게임 입장</em>
        </button>

        <button id="openYachtDice" class="platform-game-card" type="button">
          <span class="platform-game-status playable">PLAYABLE</span>
          <strong>Yacht Dice</strong>
          <span>5개의 주사위로 점수 조합을 완성하는 전략 주사위 게임</span>
          <em>게임 입장</em>
        </button>

        <button id="openIndianPoker" class="platform-game-card" type="button">
          <span class="platform-game-status preparing">STEP 1</span>
          <strong>Bob Indian Poker</strong>
          <span>자신의 카드는 보지 못하고 상대 카드만 보는 클래식 인디언 포커</span>
          <em>게임 입장</em>
        </button>
      </section>
    </main>
  `;

  document.querySelector<HTMLButtonElement>("#openBobArtist")?.addEventListener("click", () => {
    navigate("bobartist");
  });
  document.querySelector<HTMLButtonElement>("#openYachtDice")?.addEventListener("click", () => {
    navigate("yacht-dice");
  });
  document.querySelector<HTMLButtonElement>("#openIndianPoker")?.addEventListener("click", () => {
    navigate("indian-poker");
  });
}

async function renderYachtDice(): Promise<void> {
  document.title = `Yacht Dice | BobPlatform v${VERSION}`;
  document.body.classList.remove("platform-body");
  const { mountYachtDice } = await import("./games/yacht-dice/index");
  mountYachtDice();
}

async function renderIndianPoker(): Promise<void> {
  document.title = `Bob Indian Poker | BobPlatform v${VERSION}`;
  document.body.classList.remove("platform-body");
  const { mountIndianPoker } = await import("./games/indian-poker/index");
  mountIndianPoker();
}

async function renderBobArtist(): Promise<void> {
  document.body.classList.remove("platform-body");
  document.title = `BobArtist | BobPlatform v${VERSION}`;
  await import("./games/bobartist/index");

  const homeButton = document.createElement("button");
  homeButton.type = "button";
  homeButton.className = "platform-floating-home";
  homeButton.textContent = "← 게임 선택";
  homeButton.addEventListener("click", () => {
    window.location.hash = "/";
    window.location.reload();
  });
  document.body.append(homeButton);
}

async function renderRoute(): Promise<void> {
  const route = getRoute();
  if (route === "admin-chat") { const { mountAdminChat } = await import("./admin/chat/index"); mountAdminChat(); return; }
  if (route === "bobartist") {
    await renderBobArtist();
    return;
  }
  if (route === "yacht-dice") {
    await renderYachtDice();
    return;
  }
  if (route === "indian-poker") {
    await renderIndianPoker();
    return;
  }
  renderLobby();
}

window.addEventListener("hashchange", () => {
  window.location.reload();
});

void renderRoute();
