// Room page entry point — WebRTC connection + DataChannel setup (D1, D2)

import { SLATOG_CONFIG } from "../../shared/config.js";
import { SignalingClient } from "./signaling-client.js";
import { PeerManager } from "./peer-manager.js";
import type { ServerMessage, PeerInfo } from "../../shared/protocol.js";
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

// --- Room state ---
const myPeerId = uuidv4();
const myPeerName = `User-${myPeerId.slice(0, 4)}`;
let roomId = "";
let hostPeerId = "";
const peerNames = new Map<string, string>();

// --- UI setup ---
const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="room-container">
    <div id="status-bar">
      <span class="room-url-display" title="${escapeHtml(urlKey)}">${escapeHtml(urlKey)}</span>
      <span class="peer-count" id="peer-count">接続中...</span>
    </div>
    <div id="peer-list"></div>
    <div id="debug-log"></div>
  </div>
`;

const peerCountEl = document.getElementById("peer-count")!;
const peerListEl = document.getElementById("peer-list")!;
const debugLogEl = document.getElementById("debug-log")!;

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

// --- Signaling ---
const signaling = new SignalingClient(SLATOG_CONFIG.WS_SIGNALING, handleSignalingMessage);

// --- Peer Manager ---
const peerManager = new PeerManager(
  signaling,
  (peerId, channel, data) => {
    log(`[${channel}] from ${peerNames.get(peerId) ?? peerId.slice(0, 8)}: ${data}`);
  },
  (peerId, state) => {
    log(`Peer ${peerNames.get(peerId) ?? peerId.slice(0, 8)} ${state}`);
    updatePeerList();
  },
);

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

function handleRoomJoined(
  id: string,
  existingPeers: PeerInfo[],
  host: string,
): void {
  roomId = id;
  hostPeerId = host;
  log(`Joined room ${roomId} (host: ${host.slice(0, 8)})`);
  peerNames.set(myPeerId, myPeerName);

  // Initiate WebRTC connections to existing peers (we are the offerer)
  for (const peer of existingPeers) {
    peerNames.set(peer.peerId, peer.peerName);
    log(`Connecting to existing peer ${peer.peerName}`);
    peerManager.createOffer(peer.peerId);
  }

  updatePeerList();
}

function handlePeerJoined(peerId: string, peerName: string): void {
  peerNames.set(peerId, peerName);
  log(`${peerName} joined`);
  updatePeerList();
  // The new peer will send us an offer, we wait for it
}

function handlePeerLeft(peerId: string): void {
  const name = peerNames.get(peerId) ?? peerId.slice(0, 8);
  log(`${name} left`);
  peerManager.removePeer(peerId);
  peerNames.delete(peerId);
  updatePeerList();
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

// Wait for WebSocket open, then join room
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
  peerManager.destroy();
  signaling.close();
});
