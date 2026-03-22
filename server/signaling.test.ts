import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "http";
import { WebSocket } from "ws";
import { setupSignaling } from "./signaling.js";
import { InMemoryRoomStore } from "./store.js";
import type { ClientMessage, ServerMessage } from "../shared/protocol.js";

let server: Server;
let store: InMemoryRoomStore;
let port: number;
const openSockets: WebSocket[] = [];

function wsUrl(): string {
  return `ws://localhost:${port}/signaling`;
}

/** Create a WebSocket client with a message queue to avoid race conditions */
function createClient(): Promise<{ ws: WebSocket; nextMsg: () => Promise<ServerMessage> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl());
    openSockets.push(ws);

    const queue: ServerMessage[] = [];
    let waiter: ((msg: ServerMessage) => void) | null = null;

    ws.on("message", (data) => {
      const msg: ServerMessage = JSON.parse(data.toString());
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(msg);
      } else {
        queue.push(msg);
      }
    });

    const nextMsg = (): Promise<ServerMessage> => {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift()!);
      }
      return new Promise((res) => {
        waiter = res;
      });
    };

    ws.on("open", () => resolve({ ws, nextMsg }));
    ws.on("error", reject);
  });
}

function sendMsg(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg));
}

beforeEach(async () => {
  store = new InMemoryRoomStore();
  server = createServer();
  setupSignaling(server, store);
  openSockets.length = 0;
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

afterEach(async () => {
  for (const ws of openSockets) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
  openSockets.length = 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Signaling Server", () => {
  it("creates a room on JOIN_ROOM", async () => {
    const { ws, nextMsg } = await createClient();
    sendMsg(ws, {
      type: "JOIN_ROOM",
      urlKey: "https://example.com",
      peerId: "peer-1",
      peerName: "Alice",
    });

    const msg = await nextMsg();
    expect(msg.type).toBe("ROOM_JOINED");
    if (msg.type === "ROOM_JOINED") {
      expect(msg.peerId).toBe("peer-1");
      expect(msg.peers).toHaveLength(0);
      expect(msg.hostPeerId).toBe("peer-1");
    }

    const urls = store.getAllUrls();
    expect(urls).toHaveLength(1);
    expect(urls[0].urlKey).toBe("https://example.com");
    expect(urls[0].totalPeers).toBe(1);
  });

  it("second peer joins existing room and both are notified", async () => {
    const c1 = await createClient();
    sendMsg(c1.ws, {
      type: "JOIN_ROOM",
      urlKey: "https://example.com",
      peerId: "peer-1",
      peerName: "Alice",
    });
    await c1.nextMsg(); // ROOM_JOINED

    const c2 = await createClient();
    sendMsg(c2.ws, {
      type: "JOIN_ROOM",
      urlKey: "https://example.com",
      peerId: "peer-2",
      peerName: "Bob",
    });

    const joinedMsg = await c2.nextMsg();
    expect(joinedMsg.type).toBe("ROOM_JOINED");
    if (joinedMsg.type === "ROOM_JOINED") {
      expect(joinedMsg.peers).toHaveLength(1);
      expect(joinedMsg.peers[0].peerId).toBe("peer-1");
      expect(joinedMsg.hostPeerId).toBe("peer-1");
    }

    const peerJoinedMsg = await c1.nextMsg();
    expect(peerJoinedMsg.type).toBe("PEER_JOINED");
    if (peerJoinedMsg.type === "PEER_JOINED") {
      expect(peerJoinedMsg.peerId).toBe("peer-2");
      expect(peerJoinedMsg.peerName).toBe("Bob");
    }
  });

  it("notifies PEER_LEFT when a peer disconnects", async () => {
    const c1 = await createClient();
    sendMsg(c1.ws, {
      type: "JOIN_ROOM",
      urlKey: "https://example.com",
      peerId: "peer-1",
      peerName: "Alice",
    });
    await c1.nextMsg();

    const c2 = await createClient();
    sendMsg(c2.ws, {
      type: "JOIN_ROOM",
      urlKey: "https://example.com",
      peerId: "peer-2",
      peerName: "Bob",
    });
    await c2.nextMsg(); // ROOM_JOINED
    await c1.nextMsg(); // PEER_JOINED

    // peer-2 sends LEAVE_ROOM
    sendMsg(c2.ws, { type: "LEAVE_ROOM" });

    const leftMsg = await c1.nextMsg();
    expect(leftMsg.type).toBe("PEER_LEFT");
    if (leftMsg.type === "PEER_LEFT") {
      expect(leftMsg.peerId).toBe("peer-2");
    }
  });

  it("triggers HOST_MIGRATION when host leaves", async () => {
    const c1 = await createClient();
    sendMsg(c1.ws, {
      type: "JOIN_ROOM",
      urlKey: "https://example.com",
      peerId: "aaa-host",
      peerName: "Host",
    });
    await c1.nextMsg(); // ROOM_JOINED

    const c2 = await createClient();
    sendMsg(c2.ws, {
      type: "JOIN_ROOM",
      urlKey: "https://example.com",
      peerId: "bbb-peer",
      peerName: "Peer",
    });
    await c2.nextMsg(); // ROOM_JOINED
    await c1.nextMsg(); // PEER_JOINED

    // Host sends LEAVE_ROOM
    sendMsg(c1.ws, { type: "LEAVE_ROOM" });

    const msg1 = await c2.nextMsg();
    expect(msg1.type).toBe("PEER_LEFT");

    const msg2 = await c2.nextMsg();
    expect(msg2.type).toBe("HOST_MIGRATION");
    if (msg2.type === "HOST_MIGRATION") {
      expect(msg2.newHostPeerId).toBe("bbb-peer");
    }
  });

  it("deletes room when last peer leaves", async () => {
    const c1 = await createClient();
    sendMsg(c1.ws, {
      type: "JOIN_ROOM",
      urlKey: "https://example.com",
      peerId: "peer-1",
      peerName: "Alice",
    });
    await c1.nextMsg();

    sendMsg(c1.ws, { type: "LEAVE_ROOM" });

    // Give the server a moment to process
    await new Promise((r) => setTimeout(r, 50));

    expect(store.getAllUrls()).toHaveLength(0);
  });

  it("relays SDP offers/answers between peers", async () => {
    const c1 = await createClient();
    sendMsg(c1.ws, {
      type: "JOIN_ROOM",
      urlKey: "https://example.com",
      peerId: "peer-1",
      peerName: "Alice",
    });
    await c1.nextMsg();

    const c2 = await createClient();
    sendMsg(c2.ws, {
      type: "JOIN_ROOM",
      urlKey: "https://example.com",
      peerId: "peer-2",
      peerName: "Bob",
    });
    await c2.nextMsg(); // ROOM_JOINED
    await c1.nextMsg(); // PEER_JOINED

    // peer-1 sends SDP offer to peer-2
    sendMsg(c1.ws, {
      type: "SDP_OFFER",
      targetPeerId: "peer-2",
      sdp: { type: "offer", sdp: "fake-sdp-offer" },
    });

    const relayedOffer = await c2.nextMsg();
    expect(relayedOffer.type).toBe("SDP_OFFER");
    if (relayedOffer.type === "SDP_OFFER") {
      expect(relayedOffer.fromPeerId).toBe("peer-1");
      expect(relayedOffer.sdp.sdp).toBe("fake-sdp-offer");
    }
  });
});
