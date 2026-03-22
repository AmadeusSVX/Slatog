// Landing page entry point (D10, D14, D19)
import { SLATOG_CONFIG } from "../../shared/config.js";
import { LocalStorageAuthProvider } from "../auth.js";

const auth = new LocalStorageAuthProvider();
const identity = auth.getUserIdentity();

const app = document.getElementById("app")!;

app.innerHTML = `
  <div class="landing">
    <h1>Slatog</h1>
    <p class="tagline">URLを中心に人が集まる3Dコラボレーションルーム</p>

    <div class="username-section">
      <label for="username-input">ユーザー名:</label>
      <div class="username-row">
        <input id="username-input" type="text" value="${escapeAttr(identity.display_name)}" maxlength="32" />
        <button id="username-save" type="button">保存</button>
      </div>
    </div>

    <form id="url-form" class="url-form">
      <label for="url-input">URLを入力して新しいルームを開始:</label>
      <div class="url-input-row">
        <input
          id="url-input"
          type="url"
          placeholder="https://example.com/article"
          required
        />
        <button type="submit">開始</button>
      </div>
    </form>

    <section class="rooms-section" id="active-rooms-section">
      <h2>アクティブなルーム</h2>
      <div id="rooms-list" class="rooms-list">
        <p class="empty">アクティブなルームはありません</p>
      </div>
    </section>

    <section class="rooms-section" id="inactive-rooms-section" style="display:none">
      <h2>最近のルーム（参加者なし）</h2>
      <div id="inactive-rooms-list" class="rooms-list"></div>
    </section>
  </div>
`;

interface UrlSummary {
  urlKey: string;
  totalPeers: number;
  sessionCount: number;
  hasActivePeers: boolean; // D19
}

const urlForm = document.getElementById("url-form") as HTMLFormElement;
const urlInput = document.getElementById("url-input") as HTMLInputElement;
const roomsList = document.getElementById("rooms-list")!;
const inactiveRoomsList = document.getElementById("inactive-rooms-list")!;
const inactiveSection = document.getElementById("inactive-rooms-section")!;
const usernameInput = document.getElementById("username-input") as HTMLInputElement;
const usernameSaveBtn = document.getElementById("username-save")!;

// D14: Username save
usernameSaveBtn.addEventListener("click", () => {
  const name = usernameInput.value.trim();
  if (name) {
    auth.setDisplayName(name);
    usernameSaveBtn.textContent = "保存済み";
    setTimeout(() => {
      usernameSaveBtn.textContent = "保存";
    }, 1500);
  }
});

urlForm.addEventListener("submit", (e) => {
  e.preventDefault();
  // Save username if changed
  const name = usernameInput.value.trim();
  if (name) auth.setDisplayName(name);
  const url = urlInput.value.trim();
  if (!url) return;
  navigateToRoom(url);
});

function navigateToRoom(urlKey: string): void {
  const encoded = encodeURIComponent(urlKey);
  window.location.href = `/room/?url=${encoded}`;
}

async function fetchRooms(): Promise<void> {
  try {
    const res = await fetch(`${SLATOG_CONFIG.API_BASE}/api/rooms`);
    const data: UrlSummary[] = await res.json();
    renderRooms(data);
  } catch {
    roomsList.innerHTML = `<p class="error">ルーム情報の取得に失敗しました</p>`;
  }
}

function renderRooms(rooms: UrlSummary[]): void {
  // D19: Split into active and inactive
  const active = rooms.filter((r) => r.hasActivePeers);
  const inactive = rooms.filter((r) => !r.hasActivePeers);

  if (active.length === 0) {
    roomsList.innerHTML = `<p class="empty">アクティブなルームはありません</p>`;
  } else {
    roomsList.innerHTML = active
      .map(
        (room) => `
      <div class="room-card">
        <div class="room-url" title="${escapeHtml(room.urlKey)}">${escapeHtml(truncateUrl(room.urlKey))}</div>
        <div class="room-meta">${room.totalPeers}人 · セッション ${room.sessionCount}個</div>
        <button class="join-btn" data-url="${escapeAttr(room.urlKey)}">参加する</button>
      </div>
    `,
      )
      .join("");

    roomsList.querySelectorAll<HTMLButtonElement>(".join-btn").forEach((btn) => {
      btn.addEventListener("click", () => navigateToRoom(btn.dataset.url!));
    });
  }

  // D19: Inactive rooms section
  if (inactive.length === 0) {
    inactiveSection.style.display = "none";
  } else {
    inactiveSection.style.display = "";
    inactiveRoomsList.innerHTML = inactive
      .map(
        (room) => `
      <div class="room-card inactive">
        <div class="room-url" title="${escapeHtml(room.urlKey)}">${escapeHtml(truncateUrl(room.urlKey))}</div>
        <div class="room-meta">0人 · セッション ${room.sessionCount}個</div>
        <button class="join-btn restore-btn" data-url="${escapeAttr(room.urlKey)}">復元して参加する</button>
      </div>
    `,
      )
      .join("");

    inactiveRoomsList.querySelectorAll<HTMLButtonElement>(".join-btn").forEach((btn) => {
      btn.addEventListener("click", () => navigateToRoom(btn.dataset.url!));
    });
  }
}

function truncateUrl(url: string): string {
  return url.length > 60 ? url.slice(0, 57) + "..." : url;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// Initial fetch + polling (D10: 10s interval)
fetchRooms();
setInterval(fetchRooms, 10_000);
