// D11 [B]: REST API

import type { Express } from "express";
import type { RoomStore } from "./store.js";

export function setupApi(app: Express, store: RoomStore): void {
  // GET /api/rooms — ranking (all URLs aggregated)
  app.get("/api/rooms", (_req, res) => {
    res.json(store.getAllUrls());
  });

  // GET /api/rooms/:urlKey — sessions for a specific URL
  app.get("/api/rooms/:urlKey", (req, res) => {
    const urlKey = decodeURIComponent(req.params.urlKey);
    res.json(store.getSessionsByUrl(urlKey));
  });
}
