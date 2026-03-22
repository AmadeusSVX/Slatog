// Room page entry point — state-based multiplayer sync
// Architecture: modules mutate RoomState → onChange → main.ts broadcasts full snapshot
// Reception: applySnapshot (CRDT merge) → reconcileUI (diff-based incremental updates)

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
import type { SceneContext } from "./scene.js";
import type { EmbedResult } from "./iframe-embed.js";
import type { ServerMessage, PeerInfo } from "../../shared/protocol.js";
import type {
  AvatarPosData,
  StateSnapshotData,
  RoomStateSnapshot,
} from "../../shared/data-protocol.js";
import { v4 as uuidv4 } from "uuid";

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

// --- Room state (single source of truth) ---
const myPeerId = uuidv4();
const myPeerName = `User-${myPeerId.slice(0, 4)}`;
let roomId = "";
let hostPeerId = "";
const peerNames = new Map<string, string>();
const roomState = new RoomState(urlKey);
let pendingSnapshot: StateSnapshotData | null = null;
let sceneReady = false;

// --- UI setup ---
const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="room-container" id="room-container">
    <div id="scene-container"></div>
    <div id="status-bar">
      <span class="room-url-display" title="${escapeHtml(urlKey)}">${escapeHtml(urlKey)}</span>
      <span class="peer-count" id="peer-count">接続中...</span>
      <button id="pen-toggle" class="pen-toggle" title="ペン描画">&#9998;</button>
    </div>
    <div id="peer-list"></div>
    <div id="embed-error" class="embed-error" style="display:none"></div>
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
      return `<div class="peer-item${isHost ? " host" : ""}">${escapeHtml(name)}</div>`;
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
let penEnabled = false;

// --- Pen toggle ---
penToggleBtn.addEventListener("click", () => {
  penEnabled = !penEnabled;
  penMgr?.setEnabled(penEnabled);
  penToggleBtn.classList.toggle("active", penEnabled);
  if (sceneCtx) {
    sceneCtx.controls.enabled = !penEnabled;
  }
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

const peerManager = new PeerManager(
  signaling,
  handleDataChannelMessage,
  (peerId, state) => {
    log(`Peer ${peerNames.get(peerId) ?? peerId.slice(0, 8)} ${state}`);
    updatePeerList();
  },
);

// When state channel opens, send current state to all peers
peerManager.setOnChannelOpen((peerId, channel) => {
  if (channel === "state") {
    log(`State channel open with ${peerNames.get(peerId) ?? peerId.slice(0, 8)}, broadcasting state`);
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
    } catch { /* ignore malformed */ }
    return;
  }

  // State channel — only STATE_SNAPSHOT
  if (channel === "state") {
    try {
      const msg = JSON.parse(data) as StateSnapshotData;
      if (msg.type === "STATE_SNAPSHOT") {
        handleIncomingSnapshot(msg);
      }
    } catch { /* ignore malformed */ }
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
  // --- Chat messages ---
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

  // --- Scroll ---
  if (curr.scrollPosition.timestamp > prev.scrollPosition.timestamp) {
    scrollSync?.applyRemoteScroll(curr.scrollPosition.value.x, curr.scrollPosition.value.y);
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
      break;
    case "ERROR":
      log(`ERROR: ${msg.message}`);
      break;
  }
}

function handleRoomJoined(id: string, existingPeers: PeerInfo[], host: string): void {
  roomId = id;
  hostPeerId = host;
  log(`Joined room ${roomId} (host: ${host.slice(0, 8)})`);
  peerNames.set(myPeerId, myPeerName);

  for (const peer of existingPeers) {
    peerNames.set(peer.peerId, peer.peerName);
    log(`Connecting to existing peer ${peer.peerName}`);
    peerManager.createOffer(peer.peerId);
  }

  updatePeerList();
  initScene();
}

function handlePeerJoined(peerId: string, peerName: string): void {
  peerNames.set(peerId, peerName);
  log(`${peerName} joined`);
  avatarMgr?.addPeer(peerId, peerName);
  updatePeerList();
}

function handlePeerLeft(peerId: string): void {
  const name = peerNames.get(peerId) ?? peerId.slice(0, 8);
  log(`${name} left`);
  peerManager.removePeer(peerId);
  avatarMgr?.removePeer(peerId);
  peerNames.delete(peerId);
  updatePeerList();
}

// ==========================================================================
// 3D Scene initialization
// ==========================================================================

async function initScene(): Promise<void> {
  if (sceneCtx) return;

  sceneCtx = createScene(sceneContainer);
  log("3D scene initialized");

  avatarMgr = new AvatarManager(sceneCtx, peerManager, myPeerId);
  chatMgr = new ChatManager(roomContainer, roomState, myPeerId, myPeerName);
  bubbleMgr = new ChatBubbleManager(sceneCtx.scene, avatarMgr, myPeerId);
  penMgr = new PenManager(sceneCtx, roomState, myPeerId);

  chatMgr.setOnNewMessage((msg) => {
    bubbleMgr?.showBubble(msg);
  });

  for (const [peerId, name] of peerNames) {
    if (peerId !== myPeerId) {
      avatarMgr.addPeer(peerId, name);
    }
  }

  // Animation loop for avatars and bubbles
  const camera = sceneCtx.camera;
  function frameLoop(): void {
    avatarMgr?.setLocalPosition(camera.position.x, camera.position.y, camera.position.z, camera.rotation.y);
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
    });
    clearInterval(checkOpen);
    log("Joining room...");
  } catch {
    // WebSocket not ready yet, retry
  }
}, 100);

// Cleanup on unload
window.addEventListener("beforeunload", () => {
  signaling.send({ type: "LEAVE_ROOM" });
  if (broadcastTimer) clearTimeout(broadcastTimer);
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
