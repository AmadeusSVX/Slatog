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
});
