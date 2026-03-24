// D11 [C], D28: WebSocket Signaling Server
// SDP exchange, ICE relay, JOIN/LEAVE, HOST_MIGRATION (D1, D7)
// D28: Sticker rate limiting + BAN system

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { v4 as uuidv4 } from "uuid";
import type { RoomStore } from "./store.js";
import type { ClientMessage, ServerMessage, PeerInfo } from "../shared/protocol.js";
import { MAX_PEERS_PER_ROOM } from "../shared/protocol.js";

const PING_INTERVAL_MS = 5_000;

// D28: Rate limiting defaults (overridable via env vars)
const RATE_WINDOW = parseInt(process.env.SLATOG_STICKER_RATE_WINDOW ?? "30", 10) * 1000; // ms
const RATE_LIMIT = parseInt(process.env.SLATOG_STICKER_RATE_LIMIT ?? "5", 10);
const BAN_ENABLED = process.env.SLATOG_STICKER_BAN_ENABLED !== "0";
const BAN_THRESHOLD = parseInt(process.env.SLATOG_STICKER_BAN_THRESHOLD ?? "2", 10);
const BAN_MODE = (process.env.SLATOG_STICKER_BAN_MODE ?? "ban") as "kick" | "ban";
const BAN_DURATION = parseInt(process.env.SLATOG_STICKER_BAN_DURATION ?? "3600", 10) * 1000; // ms

// D28: In-memory BAN list
const bannedIps = new Map<string, number>(); // ip → expiry timestamp (0 = permanent until restart)

// D28: Per-peer rate limit state
interface RateLimitState {
  timestamps: number[];
  violationCount: number;
}

interface PeerConnection {
  ws: WebSocket;
  peerId: string;
  peerName: string;
  userId: string; // D14
  roomId: string | null;
  alive: boolean;
  ip: string; // D28: client IP for BAN
  rateLimit: RateLimitState; // D28
}

export function setupSignaling(server: Server, store: RoomStore): void {
  const wss = new WebSocketServer({ server, path: "/signaling" });
  const peers = new Map<WebSocket, PeerConnection>();

  // Ping/pong heartbeat (D7: 15s timeout)
  const pingTimer = setInterval(() => {
    for (const [ws, peer] of peers) {
      if (!peer.alive) {
        ws.terminate();
        continue;
      }
      peer.alive = false;
      ws.ping();
    }
  }, PING_INTERVAL_MS);

  wss.on("close", () => clearInterval(pingTimer));

  wss.on("connection", (ws, req: IncomingMessage) => {
    const ip = getClientIp(req);

    // D28: Check BAN list
    if (isIpBanned(ip)) {
      send(ws, { type: "STICKER_BANNED", reason: "sticker_spam" });
      ws.close();
      return;
    }

    const conn: PeerConnection = {
      ws,
      peerId: "",
      peerName: "",
      userId: "",
      roomId: null,
      alive: true,
      ip,
      rateLimit: { timestamps: [], violationCount: 0 },
    };
    peers.set(ws, conn);

    ws.on("pong", () => {
      conn.alive = true;
    });

    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        send(ws, { type: "ERROR", message: "Invalid JSON" });
        return;
      }
      handleMessage(ws, conn, msg, peers, store);
    });

    ws.on("close", () => {
      handleDisconnect(conn, peers, store);
      peers.delete(ws);
    });
  });
}

function handleMessage(
  ws: WebSocket,
  conn: PeerConnection,
  msg: ClientMessage,
  peers: Map<WebSocket, PeerConnection>,
  store: RoomStore,
): void {
  switch (msg.type) {
    case "JOIN_ROOM":
      handleJoinRoom(ws, conn, msg.urlKey, msg.peerId, msg.peerName, msg.userId, peers, store);
      break;
    case "LEAVE_ROOM":
      handleDisconnect(conn, peers, store);
      conn.roomId = null;
      break;
    case "SDP_OFFER":
    case "SDP_ANSWER":
      relayToPeer(conn, msg.targetPeerId, peers, {
        type: msg.type,
        fromPeerId: conn.peerId,
        sdp: msg.sdp,
      });
      break;
    case "ICE_CANDIDATE":
      relayToPeer(conn, msg.targetPeerId, peers, {
        type: "ICE_CANDIDATE",
        fromPeerId: conn.peerId,
        candidate: msg.candidate,
      });
      break;
    case "STICKER_ADD":
      handleStickerAdd(conn, peers);
      break;
  }
}

function handleJoinRoom(
  ws: WebSocket,
  conn: PeerConnection,
  urlKey: string,
  peerId: string,
  peerName: string,
  userId: string,
  peers: Map<WebSocket, PeerConnection>,
  store: RoomStore,
): void {
  // If already in a room, leave first
  if (conn.roomId) {
    handleDisconnect(conn, peers, store);
  }

  conn.peerId = peerId;
  conn.peerName = peerName;
  conn.userId = userId;

  // Find an existing session with space, or create a new one
  const sessions = store.getSessionsByUrl(urlKey);
  let roomId: string | null = null;

  for (const session of sessions) {
    if (session.peerCount < MAX_PEERS_PER_ROOM) {
      roomId = session.roomId;
      break;
    }
  }

  if (roomId) {
    // Join existing session
    const session = store.getSession(roomId)!;
    session.peers.push(peerId);
    session.peerCount = session.peers.length;
    // D19: Reassign host if session was empty (hostPeerId cleared on last peer leave)
    if (!session.hostPeerId) {
      session.hostPeerId = peerId;
    }
    store.setSession(roomId, session);
  } else {
    // Create new session — this peer becomes host
    roomId = uuidv4();
    store.setSession(roomId, {
      roomId,
      urlKey,
      peers: [peerId],
      hostPeerId: peerId,
      peerCount: 1,
      createdAt: Date.now(),
      stateCache: null, // D18
      stateUpdatedAt: null, // D18
    });
  }

  conn.roomId = roomId;

  // Collect existing peers in the room
  const existingPeers: PeerInfo[] = [];
  for (const [, p] of peers) {
    if (p.roomId === roomId && p.peerId !== peerId && p.peerId) {
      existingPeers.push({ peerId: p.peerId, peerName: p.peerName, userId: p.userId });
    }
  }

  const session = store.getSession(roomId)!;

  // Notify the joining peer
  send(ws, {
    type: "ROOM_JOINED",
    roomId,
    peerId,
    peers: existingPeers,
    hostPeerId: session.hostPeerId,
  });

  // Notify existing peers
  for (const [peerWs, p] of peers) {
    if (p.roomId === roomId && p.peerId !== peerId) {
      send(peerWs, {
        type: "PEER_JOINED",
        peerId,
        peerName,
        userId,
      });
    }
  }
}

function handleDisconnect(
  conn: PeerConnection,
  peers: Map<WebSocket, PeerConnection>,
  store: RoomStore,
): void {
  if (!conn.roomId || !conn.peerId) return;

  const roomId = conn.roomId;
  const session = store.getSession(roomId);
  if (!session) return;

  // Remove peer from session
  session.peers = session.peers.filter((id) => id !== conn.peerId);
  session.peerCount = session.peers.length;

  if (session.peerCount === 0) {
    // D19: Room empty — keep session for restore (don't delete)
    session.hostPeerId = "";
    store.setSession(roomId, session);
  } else {
    // Check if host left — migrate (D7: lexicographic minimum)
    let needsMigration = false;
    if (session.hostPeerId === conn.peerId) {
      session.peers.sort();
      session.hostPeerId = session.peers[0];
      needsMigration = true;
    }
    store.setSession(roomId, session);

    // Notify remaining peers
    for (const [peerWs, p] of peers) {
      if (p.roomId === roomId && p.peerId !== conn.peerId) {
        send(peerWs, { type: "PEER_LEFT", peerId: conn.peerId });
        if (needsMigration) {
          send(peerWs, {
            type: "HOST_MIGRATION",
            newHostPeerId: session.hostPeerId,
          });
        }
      }
    }
  }
}

function relayToPeer(
  from: PeerConnection,
  targetPeerId: string,
  peers: Map<WebSocket, PeerConnection>,
  msg: ServerMessage,
): void {
  for (const [ws, p] of peers) {
    if (p.peerId === targetPeerId && p.roomId === from.roomId) {
      send(ws, msg);
      return;
    }
  }
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ==========================================================================
// D28: Rate limiting + BAN
// ==========================================================================

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

function isIpBanned(ip: string): boolean {
  const expiry = bannedIps.get(ip);
  if (expiry === undefined) return false;
  if (expiry === 0) return true; // permanent until restart
  if (Date.now() < expiry) return true;
  // Expired — remove
  bannedIps.delete(ip);
  return false;
}

function handleStickerAdd(conn: PeerConnection, peers: Map<WebSocket, PeerConnection>): void {
  const now = Date.now();
  const rl = conn.rateLimit;

  // Prune old timestamps outside the window
  rl.timestamps = rl.timestamps.filter((t) => now - t < RATE_WINDOW);

  // Check if rate limited
  if (rl.timestamps.length >= RATE_LIMIT) {
    // Rate limit triggered
    rl.violationCount++;
    send(conn.ws, { type: "STICKER_RATE_LIMITED" });

    // Check if BAN threshold reached
    if (BAN_ENABLED && rl.violationCount >= BAN_THRESHOLD) {
      applyBan(conn, peers);
    }
    return;
  }

  // Record this sticker timestamp
  rl.timestamps.push(now);
}

function applyBan(conn: PeerConnection, peers: Map<WebSocket, PeerConnection>): void {
  if (BAN_MODE === "kick") {
    // Auto-kick: disconnect but allow reconnection
    send(conn.ws, { type: "STICKER_BANNED", reason: "sticker_spam" });
    conn.ws.close();
  } else {
    // BAN mode: add IP to ban list
    const expiry = BAN_DURATION === 0 ? 0 : Date.now() + BAN_DURATION;
    bannedIps.set(conn.ip, expiry);
    send(conn.ws, { type: "STICKER_BANNED", reason: "sticker_spam" });
    conn.ws.close();

    // Also disconnect any other connections from the same IP
    for (const [ws, p] of peers) {
      if (p.ip === conn.ip && p !== conn) {
        send(ws, { type: "STICKER_BANNED", reason: "sticker_spam" });
        ws.close();
      }
    }
  }
}
