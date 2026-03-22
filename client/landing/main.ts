// Landing page entry point (D10)
import { SLATOG_CONFIG } from "../../shared/config.js";

const app = document.getElementById("app")!;

app.innerHTML = `
  <div class="landing">
    <h1>Slatog</h1>
    <p class="tagline">URLを中心に人が集まる3Dコラボレーションルーム</p>

    <form id="url-form" class="url-form">
      <input
        id="url-input"
        type="url"
        placeholder="https://example.com/article"
        required
      />
      <button type="submit">開始</button>
    </form>

    <section class="rooms-section">
      <h2>アクティブなルーム</h2>
      <div id="rooms-list" class="rooms-list">
        <p class="empty">アクティブなルームはありません</p>
      </div>
    </section>
  </div>
`;

interface UrlSummary {
  urlKey: string;
  totalPeers: number;
  sessionCount: number;
}

const urlForm = document.getElementById("url-form") as HTMLFormElement;
const urlInput = document.getElementById("url-input") as HTMLInputElement;
const roomsList = document.getElementById("rooms-list")!;

urlForm.addEventListener("submit", (e) => {
  e.preventDefault();
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
  if (rooms.length === 0) {
    roomsList.innerHTML = `<p class="empty">アクティブなルームはありません</p>`;
    return;
  }

  roomsList.innerHTML = rooms
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
    btn.addEventListener("click", () => {
      const url = btn.dataset.url!;
      navigateToRoom(url);
    });
  });
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
