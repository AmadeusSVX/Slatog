import { defineConfig } from "vite";
import { resolve } from "path";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  root: "client",
  plugins: [
    basicSsl(), // D37: 自己署名証明書でHTTPS有効化（WebXR Secure Context要件）
  ],
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
    host: true, // D37: LAN公開（0.0.0.0）— VRヘッドセットからのアクセス用
    proxy: {
      "/api": "http://localhost:3000",
      "/signaling": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
