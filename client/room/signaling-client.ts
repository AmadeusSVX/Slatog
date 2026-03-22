// Client-side signaling WebSocket wrapper

import type { ClientMessage, ServerMessage } from "../../shared/protocol.js";

export type SignalingHandler = (msg: ServerMessage) => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private handler: SignalingHandler;
  private url: string;

  constructor(url: string, handler: SignalingHandler) {
    this.url = url;
    this.handler = handler;
  }

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.addEventListener("open", () => {
      console.log("[signaling] connected");
    });

    this.ws.addEventListener("message", (e) => {
      const msg: ServerMessage = JSON.parse(e.data as string);
      this.handler(msg);
    });

    this.ws.addEventListener("close", () => {
      console.log("[signaling] disconnected");
    });

    this.ws.addEventListener("error", (e) => {
      console.error("[signaling] error", e);
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.ws?.close();
  }
}
