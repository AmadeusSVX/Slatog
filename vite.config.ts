import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "client",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        landing: resolve(__dirname, "client/landing/index.html"),
        room: resolve(__dirname, "client/room/index.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/signaling": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
