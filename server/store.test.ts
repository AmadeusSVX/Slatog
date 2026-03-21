import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRoomStore } from "./store.js";

describe("InMemoryRoomStore", () => {
  let store: InMemoryRoomStore;

  beforeEach(() => {
    store = new InMemoryRoomStore();
  });

  it("returns null for non-existent session", () => {
    expect(store.getSession("nonexistent")).toBeNull();
  });

  it("stores and retrieves a session", () => {
    const session = {
      roomId: "room-1",
      urlKey: "https://example.com",
      peers: ["peer-1"],
      hostPeerId: "peer-1",
      peerCount: 1,
      createdAt: Date.now(),
    };
    store.setSession("room-1", session);
    expect(store.getSession("room-1")).toEqual(session);
  });

  it("returns sessions by URL key", () => {
    const url = "https://example.com";
    store.setSession("room-1", {
      roomId: "room-1",
      urlKey: url,
      peers: ["p1"],
      hostPeerId: "p1",
      peerCount: 1,
      createdAt: Date.now(),
    });
    store.setSession("room-2", {
      roomId: "room-2",
      urlKey: url,
      peers: ["p2", "p3"],
      hostPeerId: "p2",
      peerCount: 2,
      createdAt: Date.now(),
    });

    const sessions = store.getSessionsByUrl(url);
    expect(sessions).toHaveLength(2);
  });

  it("returns sorted URL summaries", () => {
    store.setSession("r1", {
      roomId: "r1",
      urlKey: "https://a.com",
      peers: ["p1"],
      hostPeerId: "p1",
      peerCount: 1,
      createdAt: Date.now(),
    });
    store.setSession("r2", {
      roomId: "r2",
      urlKey: "https://b.com",
      peers: ["p2", "p3", "p4"],
      hostPeerId: "p2",
      peerCount: 3,
      createdAt: Date.now(),
    });

    const urls = store.getAllUrls();
    expect(urls[0].urlKey).toBe("https://b.com");
    expect(urls[0].totalPeers).toBe(3);
    expect(urls[1].urlKey).toBe("https://a.com");
  });

  it("deletes a session and updates index", () => {
    store.setSession("r1", {
      roomId: "r1",
      urlKey: "https://a.com",
      peers: ["p1"],
      hostPeerId: "p1",
      peerCount: 1,
      createdAt: Date.now(),
    });
    store.deleteSession("r1");
    expect(store.getSession("r1")).toBeNull();
    expect(store.getSessionsByUrl("https://a.com")).toHaveLength(0);
    expect(store.getAllUrls()).toHaveLength(0);
  });
});
