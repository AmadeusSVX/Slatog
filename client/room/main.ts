// Room page entry point — state-based multiplayer sync
// Architecture: modules mutate RoomState → onChange → main.ts broadcasts full snapshot
// Reception: applySnapshot (CRDT merge) → reconcileUI (diff-based incremental updates)
// D22: Chat toggle — chat_enabled fetched from server features API
// D23: Text stickers — wall-placed text via raycast
// D24: Sticker author toggle — localStorage setting

import { SLATOG_CONFIG } from "../../shared/config.js";
import { SignalingClient } from "./signaling-client.js";
import { PeerManager } from "./peer-manager.js";
import { createScene } from "./scene.js";
import { embedWebPage } from "./iframe-embed.js";
import { ScrollSync } from "./scroll-sync.js";
import { RoomState } from "../../shared/room-state.js";
import { AvatarManager } from "./avatar.js";
import { ChatManager } from "./chat.js";
import { ChatBubbleManager } from "./chat-bubble.js";
import { PenManager } from "./pen.js";
import { StickerManager } from "./sticker.js";
import { PrimitiveManager } from "./primitive.js";
import type { SceneContext } from "./scene.js";
import type { EmbedResult } from "./iframe-embed.js";
import type { ServerMessage, PeerInfo } from "../../shared/protocol.js";
import type {
  AvatarPosData,
  StateSnapshotData,
  RoomStateSnapshot,
} from "../../shared/data-protocol.js";
import { v4 as uuidv4 } from "uuid";
import { LocalStorageAuthProvider } from "../auth.js";
import { USER_COLORS, pickColorIndex } from "../../shared/colors.js";

// --- Extract URL key from query params ---
const params = new URLSearchParams(window.location.search);
const urlKey = params.get("url");

if (!urlKey) {
  document.getElementById("app")!.innerHTML = `
    <div class="landing" style="text-align:center;padding-top:4rem">
      <h1>Slatog</h1>
      <p>URLパラメータが指定されていません</p>
      <a href="/" style="color:#5b8def">ランディングページへ戻る</a>
    </div>`;
  throw new Error("No URL key provided");
}

// --- D14: User identity ---
const auth = new LocalStorageAuthProvider();
const userIdentity = auth.getUserIdentity();

// --- Room state (single source of truth) ---
const myPeerId = uuidv4();
const myPeerName = userIdentity.display_name;
const myUserId = userIdentity.user_id;
let roomId = "";
let hostPeerId = "";
const peerNames = new Map<string, string>();
const peerColorIndices = new Map<string, number>(); // D15: peer → color_index
const roomState = new RoomState(urlKey);
let pendingSnapshot: StateSnapshotData | null = null;
let sceneReady = false;
let myColorIndex = 0; // D15: will be assigned on room join

// D22: Chat feature toggle (fetched from server)
let chatEnabled = true; // default on, will be updated from features API

// --- UI setup ---
const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="room-container" id="room-container">
    <div id="scene-container"></div>
    <div id="status-bar">
      <span class="room-url-display" title="${escapeHtml(urlKey)}">${escapeHtml(urlKey)}</span>
      <span class="peer-count" id="peer-count">接続中...</span>
      <button id="pen-toggle" class="pen-toggle" title="ペン描画">&#9998;</button>
      <button id="sticker-toggle" class="sticker-toggle" title="ステッカー">&#128203;</button>
      <button id="primitive-toggle" class="primitive-toggle" title="プリミティブ">&#9638;</button>
      <button id="settings-toggle" class="settings-toggle" title="設定">&#9881;</button>
    </div>
    <div id="peer-list"></div>
    <div id="embed-error" class="embed-error" style="display:none"></div>
    <div id="settings-panel" class="settings-panel" style="display:none">
      <div class="settings-header">設定</div>
      <label class="settings-item">
        <input type="checkbox" id="show-author-toggle" checked />
        ステッカーにユーザー名を表示
      </label>
    </div>
    <div id="debug-log"></div>
  </div>
`;

const roomContainer = document.getElementById("room-container")!;
const sceneContainer = document.getElementById("scene-container")!;
const peerCountEl = document.getElementById("peer-count")!;
const peerListEl = document.getElementById("peer-list")!;
const embedErrorEl = document.getElementById("embed-error")!;
const debugLogEl = document.getElementById("debug-log")!;
const penToggleBtn = document.getElementById("pen-toggle")!;
const stickerToggleBtn = document.getElementById("sticker-toggle")!;
const primitiveToggleBtn = document.getElementById("primitive-toggle")!;
const settingsToggleBtn = document.getElementById("settings-toggle")!;
const settingsPanel = document.getElementById("settings-panel")!;
const showAuthorToggle = document.getElementById("show-author-toggle") as HTMLInputElement;

function log(msg: string): void {
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  debugLogEl.appendChild(line);
  debugLogEl.scrollTop = debugLogEl.scrollHeight;
  console.log(msg);
}

function updatePeerList(): void {
  const connectedIds = peerManager.connectedPeerIds;
  const allPeerIds = [myPeerId, ...connectedIds];

  peerCountEl.textContent = `${allPeerIds.length}人`;

  peerListEl.innerHTML = allPeerIds
    .map((id) => {
      const name =
        id === myPeerId ? `${myPeerName} (あなた)` : (peerNames.get(id) ?? id.slice(0, 8));
      const isHost = id === hostPeerId;
      const colorIdx = id === myPeerId ? myColorIndex : (peerColorIndices.get(id) ?? 0);
      const color = USER_COLORS[colorIdx];
      return `<div class="peer-item${isHost ? " host" : ""}" style="color:${color}">${escapeHtml(name)}</div>`;
    })
    .join("");
}

// --- Phase 3 managers ---
let sceneCtx: SceneContext | null = null;
let embed: EmbedResult | null = null;
let scrollSync: ScrollSync | null = null;
let avatarMgr: AvatarManager | null = null;
let chatMgr: ChatManager | null = null;
let bubbleMgr: ChatBubbleManager | null = null;
let penMgr: PenManager | null = null;
let stickerMgr: StickerManager | null = null;
let primitiveMgr: PrimitiveManager | null = null;
let penEnabled = false;
let stickerEnabled = false;
let primitiveEnabled = false;

// --- Pen toggle ---
penToggleBtn.addEventListener("click", () => {
  penEnabled = !penEnabled;
  penMgr?.setEnabled(penEnabled);
  penToggleBtn.classList.toggle("active", penEnabled);
  // Disable other modes when pen is enabled
  if (penEnabled) {
    if (stickerEnabled) {
      stickerEnabled = false;
      stickerMgr?.setEnabled(false);
      stickerToggleBtn.classList.remove("active");
    }
    if (primitiveEnabled) {
      primitiveEnabled = false;
      primitiveMgr?.setEnabled(false);
      primitiveToggleBtn.classList.remove("active");
    }
  }
  if (sceneCtx) {
    sceneCtx.controls.enabled = !penEnabled && !stickerEnabled && !primitiveEnabled;
  }
});

// --- Sticker toggle (D23) ---
stickerToggleBtn.addEventListener("click", () => {
  stickerEnabled = !stickerEnabled;
  stickerMgr?.setEnabled(stickerEnabled);
  stickerToggleBtn.classList.toggle("active", stickerEnabled);
  // Disable other modes when sticker is enabled
  if (stickerEnabled) {
    if (penEnabled) {
      penEnabled = false;
      penMgr?.setEnabled(false);
      penToggleBtn.classList.remove("active");
    }
    if (primitiveEnabled) {
      primitiveEnabled = false;
      primitiveMgr?.setEnabled(false);
      primitiveToggleBtn.classList.remove("active");
    }
  }
  if (sceneCtx) {
    sceneCtx.controls.enabled = !penEnabled && !stickerEnabled && !primitiveEnabled;
  }
});

// --- Primitive toggle (D31) ---
primitiveToggleBtn.addEventListener("click", () => {
  primitiveEnabled = !primitiveEnabled;
  primitiveMgr?.setEnabled(primitiveEnabled);
  primitiveToggleBtn.classList.toggle("active", primitiveEnabled);
  // Disable other modes when primitive is enabled
  if (primitiveEnabled) {
    if (penEnabled) {
      penEnabled = false;
      penMgr?.setEnabled(false);
      penToggleBtn.classList.remove("active");
    }
    if (stickerEnabled) {
      stickerEnabled = false;
      stickerMgr?.setEnabled(false);
      stickerToggleBtn.classList.remove("active");
    }
  }
  if (sceneCtx) {
    sceneCtx.controls.enabled = !penEnabled && !stickerEnabled && !primitiveEnabled;
  }
});

// --- Settings toggle (D24) ---
settingsToggleBtn.addEventListener("click", () => {
  const visible = settingsPanel.style.display !== "none";
  settingsPanel.style.display = visible ? "none" : "block";
  settingsToggleBtn.classList.toggle("active", !visible);
});
settingsPanel.addEventListener("pointerdown", (e) => e.stopPropagation());

// D24: Author toggle
showAuthorToggle.addEventListener("change", () => {
  stickerMgr?.setShowAuthor(showAuthorToggle.checked);
});

// ==========================================================================
// State-based broadcast — main.ts is the sole broadcaster
// ==========================================================================

let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
let broadcastQueued = false;

function scheduleBroadcast(immediate: boolean): void {
  if (immediate) {
    if (broadcastTimer) {
      clearTimeout(broadcastTimer);
      broadcastTimer = null;
    }
    if (!broadcastQueued) {
      broadcastQueued = true;
      queueMicrotask(doBroadcast);
    }
  } else if (!broadcastTimer && !broadcastQueued) {
    broadcastTimer = setTimeout(doBroadcast, 100);
  }
}

function doBroadcast(): void {
  broadcastTimer = null;
  broadcastQueued = false;
  const snapshot = roomState.toSnapshot();
  const msg: StateSnapshotData = {
    type: "STATE_SNAPSHOT",
    snapshot: JSON.stringify(snapshot),
  };
  peerManager.broadcast("state", JSON.stringify(msg));
}

// Wire RoomState changes to broadcast
roomState.setOnChange(scheduleBroadcast);

// ==========================================================================
// DataChannel message handling
// ==========================================================================

const signaling = new SignalingClient(SLATOG_CONFIG.WS_SIGNALING, handleSignalingMessage);

const peerManager = new PeerManager(signaling, handleDataChannelMessage, (peerId, state) => {
  log(`Peer ${peerNames.get(peerId) ?? peerId.slice(0, 8)} ${state}`);
  updatePeerList();
});

// When state channel opens, send current state to all peers
peerManager.setOnChannelOpen((peerId, channel) => {
  if (channel === "state") {
    log(
      `State channel open with ${peerNames.get(peerId) ?? peerId.slice(0, 8)}, broadcasting state`,
    );
    doBroadcast();
  }
});

function handleDataChannelMessage(_peerId: string, channel: string, data: string): void {
  if (channel === "realtime") {
    try {
      const msg = JSON.parse(data) as AvatarPosData;
      if (msg.type === "AVATAR_POS") {
        avatarMgr?.handleRemotePosition(msg);
      }
    } catch {
      /* ignore malformed */
    }
    return;
  }

  // State channel — only STATE_SNAPSHOT
  if (channel === "state") {
    try {
      const msg = JSON.parse(data) as StateSnapshotData;
      if (msg.type === "STATE_SNAPSHOT") {
        handleIncomingSnapshot(msg);
      }
    } catch {
      /* ignore malformed */
    }
  }
}

// ==========================================================================
// Snapshot reception + reconcileUI
// ==========================================================================

function handleIncomingSnapshot(msg: StateSnapshotData): void {
  if (!sceneReady) {
    pendingSnapshot = msg;
    log("Snapshot received, queued for scene init");
    return;
  }
  applySnapshotAndReconcile(msg);
}

function applySnapshotAndReconcile(msg: StateSnapshotData): void {
  try {
    const incoming: RoomStateSnapshot = JSON.parse(msg.snapshot);
    const prevSnap = roomState.toSnapshot();
    roomState.applySnapshot(incoming);
    const currSnap = roomState.toSnapshot();
    reconcileUI(prevSnap, currSnap);
  } catch (e) {
    log(`Failed to apply snapshot: ${e}`);
  }
}

function reconcileUI(prev: RoomStateSnapshot, curr: RoomStateSnapshot): void {
  // --- Chat messages (D22: only if chat enabled) ---
  if (chatEnabled) {
    const prevChatKeys = new Set(Object.keys(prev.chatMessages));
    const currChatKeys = new Set(Object.keys(curr.chatMessages));

    for (const key of currChatKeys) {
      if (!prevChatKeys.has(key)) {
        chatMgr?.appendMessage(curr.chatMessages[key].value);
      }
    }
    for (const key of prevChatKeys) {
      if (!currChatKeys.has(key)) {
        chatMgr?.removeMessage(key);
      }
    }
  }

  // --- Strokes ---
  const prevStrokeKeys = new Set(Object.keys(prev.strokes));
  const currStrokeKeys = new Set(Object.keys(curr.strokes));

  for (const key of currStrokeKeys) {
    if (!prevStrokeKeys.has(key)) {
      penMgr?.renderStroke(curr.strokes[key].value);
    }
  }
  for (const key of prevStrokeKeys) {
    if (!currStrokeKeys.has(key)) {
      penMgr?.removeStroke(key);
    }
  }

  // --- Text stickers (D23) ---
  const prevStickerKeys = new Set(Object.keys(prev.textStickers ?? {}));
  const currStickerKeys = new Set(Object.keys(curr.textStickers ?? {}));

  for (const key of currStickerKeys) {
    if (!prevStickerKeys.has(key)) {
      stickerMgr?.renderSticker(curr.textStickers[key].value);
    }
  }
  for (const key of prevStickerKeys) {
    if (!currStickerKeys.has(key)) {
      stickerMgr?.removeSticker(key);
    }
  }

  // --- Primitives (D32) ---
  const prevPrimitiveKeys = new Set(Object.keys(prev.primitives ?? {}));
  const currPrimitiveKeys = new Set(Object.keys(curr.primitives ?? {}));

  for (const key of currPrimitiveKeys) {
    if (!prevPrimitiveKeys.has(key)) {
      primitiveMgr?.renderPrimitive(curr.primitives[key].value);
    }
  }
  for (const key of prevPrimitiveKeys) {
    if (!currPrimitiveKeys.has(key)) {
      primitiveMgr?.removePrimitive(key);
    }
  }

  // --- Scroll ---
  if (curr.scrollPosition.timestamp > prev.scrollPosition.timestamp) {
    scrollSync?.applyRemoteScroll(curr.scrollPosition.value.x, curr.scrollPosition.value.y);
  }
}

// ==========================================================================
// D22: Fetch features from server
// ==========================================================================

async function fetchFeatures(): Promise<void> {
  try {
    const res = await fetch(`${SLATOG_CONFIG.API_BASE}/api/rooms/${encodeURIComponent(urlKey!)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.features) {
      chatEnabled = data.features.chat_enabled !== false;
    }
  } catch {
    // Default to enabled on fetch failure
  }
}

// ==========================================================================
// Signaling
// ==========================================================================

function handleSignalingMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case "ROOM_JOINED":
      handleRoomJoined(msg.roomId, msg.peers, msg.hostPeerId);
      break;
    case "PEER_JOINED":
      handlePeerJoined(msg.peerId, msg.peerName);
      break;
    case "PEER_LEFT":
      handlePeerLeft(msg.peerId);
      break;
    case "SDP_OFFER":
      peerManager.handleOffer(msg.fromPeerId, msg.sdp);
      break;
    case "SDP_ANSWER":
      peerManager.handleAnswer(msg.fromPeerId, msg.sdp);
      break;
    case "ICE_CANDIDATE":
      peerManager.handleIceCandidate(msg.fromPeerId, msg.candidate);
      break;
    case "HOST_MIGRATION":
      hostPeerId = msg.newHostPeerId;
      log(`Host migrated to ${peerNames.get(hostPeerId) ?? hostPeerId.slice(0, 8)}`);
      updatePeerList();
      // D18: New host takes over state cache sync
      if (hostPeerId === myPeerId) {
        startStateCacheSync();
      } else {
        stopStateCacheSync();
      }
      break;
    case "ERROR":
      log(`ERROR: ${msg.message}`);
      break;
    case "STICKER_RATE_LIMITED":
      log("Sticker rate limited — cooldown active");
      stickerMgr?.showRateLimitNotice();
      break;
    case "STICKER_BANNED":
      log(`Banned: ${msg.reason}`);
      break;
  }
}

async function handleRoomJoined(
  id: string,
  existingPeers: PeerInfo[],
  host: string,
): Promise<void> {
  roomId = id;
  hostPeerId = host;
  log(`Joined room ${roomId} (host: ${host.slice(0, 8)})`);
  peerNames.set(myPeerId, myPeerName);

  // D15: Assign colors to existing peers first, then self
  const usedIndices = new Set<number>();
  for (const peer of existingPeers) {
    peerNames.set(peer.peerId, peer.peerName);
    const ci = pickColorIndex(usedIndices);
    peerColorIndices.set(peer.peerId, ci);
    usedIndices.add(ci);
    log(`Connecting to existing peer ${peer.peerName}`);
    peerManager.createOffer(peer.peerId);
  }
  myColorIndex = pickColorIndex(usedIndices);
  usedIndices.add(myColorIndex);

  updatePeerList();
  await initScene();

  // D18: Start state cache sync if we are host
  if (hostPeerId === myPeerId) {
    startStateCacheSync();
  }

  // D19: If no other peers exist, try to restore state from server cache
  if (existingPeers.length === 0) {
    restoreStateFromCache();
  }
}

function handlePeerJoined(peerId: string, peerName: string): void {
  peerNames.set(peerId, peerName);
  // D15: Assign color
  const usedIndices = new Set<number>([myColorIndex, ...peerColorIndices.values()]);
  const ci = pickColorIndex(usedIndices);
  peerColorIndices.set(peerId, ci);
  log(`${peerName} joined (color: ${USER_COLORS[ci]})`);
  avatarMgr?.addPeer(peerId, peerName, ci);
  updatePeerList();
}

function handlePeerLeft(peerId: string): void {
  const name = peerNames.get(peerId) ?? peerId.slice(0, 8);
  log(`${name} left`);
  peerManager.removePeer(peerId);
  avatarMgr?.removePeer(peerId);
  peerNames.delete(peerId);
  peerColorIndices.delete(peerId); // D15: Release color
  updatePeerList();
}

// ==========================================================================
// 3D Scene initialization
// ==========================================================================

async function initScene(): Promise<void> {
  if (sceneCtx) return;

  // D22: Fetch features before scene init to know chat state
  await fetchFeatures();

  sceneCtx = createScene(sceneContainer);
  log("3D scene initialized");

  avatarMgr = new AvatarManager(sceneCtx, peerManager, myPeerId);

  // D22: Only create chat-related managers if chat is enabled
  if (chatEnabled) {
    chatMgr = new ChatManager(roomContainer, roomState, myPeerId, myPeerName, myColorIndex);
    bubbleMgr = new ChatBubbleManager(sceneCtx.scene, avatarMgr, myPeerId);
    chatMgr.setOnNewMessage((msg) => {
      bubbleMgr?.showBubble(msg);
    });
  } else {
    log("Chat disabled by server configuration");
  }

  penMgr = new PenManager(sceneCtx, roomState, myPeerId, myColorIndex);

  // D23: Sticker manager
  const myColor = USER_COLORS[myColorIndex % USER_COLORS.length];
  stickerMgr = new StickerManager(sceneCtx, roomState, myPeerId, myPeerName, myColor);

  // D31: Primitive manager
  primitiveMgr = new PrimitiveManager(sceneCtx, roomState, myPeerId, myColor);

  // D28: Wire sticker placement to server rate limiting
  stickerMgr.setOnStickerPlace(() => {
    signaling.send({ type: "STICKER_ADD" });
  });

  // D24: Sync author toggle UI with stored preference
  showAuthorToggle.checked = stickerMgr.getShowAuthor();

  for (const [peerId, name] of peerNames) {
    if (peerId !== myPeerId) {
      const ci = peerColorIndices.get(peerId) ?? 0;
      avatarMgr.addPeer(peerId, name, ci);
    }
  }

  // Animation loop for avatars and bubbles
  const camera = sceneCtx.camera;
  function frameLoop(): void {
    avatarMgr?.setLocalPosition(
      camera.position.x,
      camera.position.y,
      camera.position.z,
      camera.rotation.y,
    );
    avatarMgr?.update();
    bubbleMgr?.setLocalPosition(camera.position);
    bubbleMgr?.update();
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);

  // Embed web page
  embed = await embedWebPage(sceneCtx, urlKey!, (errMsg) => {
    embedErrorEl.textContent = errMsg;
    embedErrorEl.style.display = "block";
    log(`Embed error: ${errMsg}`);
  });

  if (embed) {
    log(`Web page embedded: ${urlKey}`);
    scrollSync = new ScrollSync(roomState);
    scrollSync.attach(embed.iframe);
    log("Scroll sync active");
  }

  // Scene is ready — flush any pending snapshot
  sceneReady = true;
  if (pendingSnapshot) {
    log("Applying queued snapshot");
    applySnapshotAndReconcile(pendingSnapshot);
    pendingSnapshot = null;
  }
}

// ==========================================================================
// D19: State restore from server cache
// ==========================================================================

async function restoreStateFromCache(): Promise<void> {
  if (!roomId) return;
  try {
    const res = await fetch(`${SLATOG_CONFIG.API_BASE}/api/rooms/${roomId}/state`);
    if (!res.ok) return; // No cache available
    const data = await res.json();
    if (data.stateJson) {
      log("Restoring state from server cache...");
      const snap = JSON.parse(data.stateJson);
      const prevSnap = roomState.toSnapshot();
      roomState.applySnapshot(snap);
      const currSnap = roomState.toSnapshot();
      reconcileUI(prevSnap, currSnap);
      // Restore visual elements
      if (chatEnabled) {
        chatMgr?.restoreHistory();
      }
      penMgr?.restoreStrokes();
      stickerMgr?.restoreStickers();
      primitiveMgr?.restorePrimitives();
      log("State restored from cache");
    }
  } catch {
    // Silently ignore restore failures
  }
}

// ==========================================================================
// D18: State cache — host periodically sends state to server
// ==========================================================================

const STATE_SYNC_INTERVAL_MS = 30_000; // 30 seconds
let stateSyncTimer: ReturnType<typeof setInterval> | null = null;

function startStateCacheSync(): void {
  stopStateCacheSync();
  stateSyncTimer = setInterval(sendStateCache, STATE_SYNC_INTERVAL_MS);
}

function stopStateCacheSync(): void {
  if (stateSyncTimer) {
    clearInterval(stateSyncTimer);
    stateSyncTimer = null;
  }
}

async function sendStateCache(): Promise<void> {
  if (!roomId || hostPeerId !== myPeerId) return; // Only host sends
  try {
    const snapshot = roomState.toSnapshot();
    const stateJson = JSON.stringify(snapshot);
    await fetch(`${SLATOG_CONFIG.API_BASE}/api/rooms/${roomId}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stateJson }),
    });
  } catch {
    // Silently ignore cache upload failures
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- Connect ---
signaling.connect();

const checkOpen = setInterval(() => {
  try {
    signaling.send({
      type: "JOIN_ROOM",
      urlKey,
      peerId: myPeerId,
      peerName: myPeerName,
      userId: myUserId,
    });
    clearInterval(checkOpen);
    log("Joining room...");
  } catch {
    // WebSocket not ready yet, retry
  }
}, 100);

// Cleanup on unload
window.addEventListener("beforeunload", () => {
  // D18: Send final state cache before leaving
  if (hostPeerId === myPeerId) sendStateCache();
  signaling.send({ type: "LEAVE_ROOM" });
  if (broadcastTimer) clearTimeout(broadcastTimer);
  stopStateCacheSync();
  primitiveMgr?.dispose();
  stickerMgr?.dispose();
  penMgr?.dispose();
  bubbleMgr?.dispose();
  chatMgr?.dispose();
  avatarMgr?.dispose();
  scrollSync?.dispose();
  embed?.dispose();
  sceneCtx?.dispose();
  peerManager.destroy();
  signaling.close();
});
