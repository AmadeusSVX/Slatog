// D11 [B], D18, D19, D22: REST API

import express from "express";
import type { Express } from "express";
import type { RoomStore } from "./store.js";

const STATE_MAX_SIZE = 65536; // 64KB

// D22: Chat toggle — environment variable (default: enabled)
function isChatEnabled(): boolean {
  return process.env.SLATOG_CHAT !== "0";
}

// D12: Proxy toggle
function isProxyEnabled(): boolean {
  return process.env.SLATOG_PROXY === "1";
}

export function setupApi(app: Express, store: RoomStore): void {
  // JSON body parser for state cache endpoint
  app.use("/api/rooms", express.json({ limit: "128kb" }));

  // GET /api/rooms — ranking (all URLs aggregated, D19: includes inactive)
  app.get("/api/rooms", (_req, res) => {
    res.json(store.getAllUrls());
  });

  // GET /api/rooms/:urlKey — sessions for a specific URL + D22 features
  app.get("/api/rooms/:urlKey", (req, res) => {
    const urlKey = decodeURIComponent(req.params.urlKey);
    const sessions = store.getSessionsByUrl(urlKey);
    res.json({
      sessions,
      features: {
        chat_enabled: isChatEnabled(),
        proxy_enabled: isProxyEnabled(),
      },
    });
  });

  // D18: POST /api/rooms/:roomId/state — state cache upload (host only)
  app.post("/api/rooms/:roomId/state", (req, res) => {
    const { roomId } = req.params;
    const session = store.getSession(roomId);
    if (!session) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const body = req.body;
    if (!body || typeof body.stateJson !== "string") {
      res.status(400).json({ error: "Missing stateJson" });
      return;
    }

    if (body.stateJson.length > STATE_MAX_SIZE) {
      res.status(413).json({ error: "State too large" });
      return;
    }

    store.setStateCache(roomId, body.stateJson);
    res.json({ ok: true });
  });

  // D18/D19: GET /api/rooms/:roomId/state — retrieve state cache
  app.get("/api/rooms/:roomId/state", (req, res) => {
    const { roomId } = req.params;
    const stateJson = store.getStateCache(roomId);
    if (stateJson === null) {
      res.status(404).json({ error: "No state cache" });
      return;
    }
    res.json({ stateJson });
  });
}
