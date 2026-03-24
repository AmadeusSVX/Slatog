// D11: Client-side environment config
// In production, __API_BASE__ and __WS_SIGNALING__ are replaced at build time.
// D37: Auto-detect ws/wss based on page protocol (HTTPS requires wss)

const wsProtocol = globalThis.location?.protocol === "https:" ? "wss" : "ws";

export const SLATOG_CONFIG = {
  API_BASE: import.meta.env.VITE_API_BASE ?? "",
  WS_SIGNALING:
    import.meta.env.VITE_WS_SIGNALING ??
    `${wsProtocol}://${globalThis.location?.host ?? "localhost:3000"}/signaling`,
  STUN_SERVERS: ["stun:stun.l.google.com:19302"],
} as const;
