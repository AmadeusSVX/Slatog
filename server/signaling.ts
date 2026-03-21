// D11 [C]: WebSocket Signaling Server

import { WebSocketServer } from "ws";
import type { Server } from "http";
import type { RoomStore } from "./store.js";

export function setupSignaling(_server: Server, _store: RoomStore): void {
  const wss = new WebSocketServer({ server: _server, path: "/signaling" });

  wss.on("connection", (_ws) => {
    // TODO: Implement signaling protocol (SDP exchange, ICE relay, JOIN/LEAVE, HOST_MIGRATION)
  });
}
