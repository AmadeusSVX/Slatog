import express from "express";
import { createServer } from "http";
import { setupSignaling } from "./signaling.js";
import { setupApi } from "./api.js";
import { InMemoryRoomStore } from "./store.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

const app = express();
const server = createServer(app);
const store = new InMemoryRoomStore();

// [B] REST API
setupApi(app, store);

// [C] WebSocket Signaling
setupSignaling(server, store);

// [A] Static assets (in production, serve built client files)
// In development, Vite dev server handles this separately.

server.listen(PORT, () => {
  console.log(`Slatog server listening on http://localhost:${PORT}`);
});
