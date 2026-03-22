// D11 [C]: WebSocket Signaling Server
// SDP exchange, ICE relay, JOIN/LEAVE, HOST_MIGRATION (D1, D7)

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { v4 as uuidv4 } from "uuid";
import type { RoomStore } from "./store.js";
import type { ClientMessage, ServerMessage, PeerInfo } from "../shared/protocol.js";
import { MAX_PEERS_PER_ROOM } from "../shared/protocol.js";

const PING_INTERVAL_MS = 5_000;

interface PeerConnection {
  ws: WebSocket;
  peerId: string;
  peerName: string;
  userId: string; // D14
  roomId: string | null;
  alive: boolean;
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

  wss.on("connection", (ws) => {
    const conn: PeerConnection = {
      ws,
      peerId: "",
      peerName: "",
      userId: "",
      roomId: null,
      alive: true,
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
