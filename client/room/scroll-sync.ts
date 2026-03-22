// D4: Scroll position sharing via state-based sync
// Debounces local scroll events (100ms) then updates RoomState.
// RoomState.onChange triggers broadcast via main.ts.
// Uses postMessage to communicate with the injected script inside proxied iframes.

import type { RoomState } from "../../shared/room-state.js";

const DEBOUNCE_MS = 100;

export class ScrollSync {
  private iframe: HTMLIFrameElement | null = null;
  private roomState: RoomState;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private messageHandler: ((e: MessageEvent) => void) | null = null;

  constructor(roomState: RoomState) {
    this.roomState = roomState;
  }

  /** Attach to an iframe and listen for scroll events via postMessage */
  attach(iframe: HTMLIFrameElement): void {
    this.iframe = iframe;

    this.messageHandler = (e: MessageEvent) => {
      if (!e.data || e.data.type !== "SLATOG_SCROLL") return;
      if (e.source !== iframe.contentWindow) return;

      const x: number = e.data.x ?? 0;
      const y: number = e.data.y ?? 0;

      // Debounce update to RoomState
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.roomState.updateScroll(x, y, Date.now());
      }, DEBOUNCE_MS);
    };
    window.addEventListener("message", this.messageHandler);
  }

  /** Apply remote scroll position to the iframe (called from reconcileUI) */
  applyRemoteScroll(x: number, y: number): void {
    if (!this.iframe?.contentWindow) return;
    this.iframe.contentWindow.postMessage({ type: "SLATOG_SCROLL_TO", x, y }, "*");
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.messageHandler) {
      window.removeEventListener("message", this.messageHandler);
    }
    this.iframe = null;
  }
}
