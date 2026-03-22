import express from "express";
import { createServer } from "http";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { setupSignaling } from "./signaling.js";
import { setupApi } from "./api.js";
import { setupProxy } from "./proxy.js";
import { InMemoryRoomStore } from "./store.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const SESSION_TTL = parseInt(process.env.SLATOG_SESSION_TTL || "-1", 10); // D20

const app = express();
const server = createServer(app);
const store = new InMemoryRoomStore();

// [B] REST API
setupApi(app, store);

// [C] WebSocket Signaling
setupSignaling(server, store);

// [E] Proxy
setupProxy(app);

// [A] Static assets (in production, serve built client files)
// In development, Vite dev server handles this separately.
// Serve FS test files for proxy verification
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use("/fs", express.static(join(__dirname, "..", "doc", "fs")));

// D20: Session auto-deletion timer
if (SESSION_TTL !== -1) {
  setInterval(() => {
    const deleted = store.deleteExpiredSessions(SESSION_TTL * 1000);
    if (deleted > 0) {
      console.log(`Cleaned up ${deleted} expired sessions`);
    }
  }, 60_000);
}

server.listen(PORT, () => {
  console.log(`Slatog server listening on http://localhost:${PORT}`);
});
