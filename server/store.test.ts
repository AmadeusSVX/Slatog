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
      stateCache: null,
      stateUpdatedAt: null,
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
      stateCache: null,
      stateUpdatedAt: null,
    });
    store.setSession("room-2", {
      roomId: "room-2",
      urlKey: url,
      peers: ["p2", "p3"],
      hostPeerId: "p2",
      peerCount: 2,
      createdAt: Date.now(),
      stateCache: null,
      stateUpdatedAt: null,
    });

    const sessions = store.getSessionsByUrl(url);
    expect(sessions).toHaveLength(2);
  });

  it("returns sorted URL summaries with hasActivePeers flag", () => {
    store.setSession("r1", {
      roomId: "r1",
      urlKey: "https://a.com",
      peers: ["p1"],
      hostPeerId: "p1",
      peerCount: 1,
      createdAt: Date.now(),
      stateCache: null,
      stateUpdatedAt: null,
    });
    store.setSession("r2", {
      roomId: "r2",
      urlKey: "https://b.com",
      peers: ["p2", "p3", "p4"],
      hostPeerId: "p2",
      peerCount: 3,
      createdAt: Date.now(),
      stateCache: null,
      stateUpdatedAt: null,
    });

    const urls = store.getAllUrls();
    expect(urls[0].urlKey).toBe("https://b.com");
    expect(urls[0].totalPeers).toBe(3);
    expect(urls[0].hasActivePeers).toBe(true);
    expect(urls[1].urlKey).toBe("https://a.com");
    expect(urls[1].hasActivePeers).toBe(true);
  });

  it("deletes a session and updates index", () => {
    store.setSession("r1", {
      roomId: "r1",
      urlKey: "https://a.com",
      peers: ["p1"],
      hostPeerId: "p1",
      peerCount: 1,
      createdAt: Date.now(),
      stateCache: null,
      stateUpdatedAt: null,
    });
    store.deleteSession("r1");
    expect(store.getSession("r1")).toBeNull();
    expect(store.getSessionsByUrl("https://a.com")).toHaveLength(0);
    expect(store.getAllUrls()).toHaveLength(0);
  });

  // D18: State cache tests
  it("stores and retrieves state cache", () => {
    store.setSession("r1", {
      roomId: "r1",
      urlKey: "https://a.com",
      peers: ["p1"],
      hostPeerId: "p1",
      peerCount: 1,
      createdAt: Date.now(),
      stateCache: null,
      stateUpdatedAt: null,
    });

    expect(store.getStateCache("r1")).toBeNull();

    store.setStateCache("r1", '{"test": true}');
    expect(store.getStateCache("r1")).toBe('{"test": true}');

    const session = store.getSession("r1")!;
    expect(session.stateUpdatedAt).toBeGreaterThan(0);
  });

  // D19: Inactive sessions in ranking
  it("sorts inactive sessions below active ones", () => {
    store.setSession("r1", {
      roomId: "r1",
      urlKey: "https://active.com",
      peers: ["p1"],
      hostPeerId: "p1",
      peerCount: 1,
      createdAt: Date.now(),
      stateCache: null,
      stateUpdatedAt: null,
    });
    store.setSession("r2", {
      roomId: "r2",
      urlKey: "https://inactive.com",
      peers: [],
      hostPeerId: "",
      peerCount: 0,
      createdAt: Date.now(),
      stateCache: '{"data": "cached"}',
      stateUpdatedAt: Date.now(),
    });

    const urls = store.getAllUrls();
    expect(urls).toHaveLength(2);
    expect(urls[0].urlKey).toBe("https://active.com");
    expect(urls[0].hasActivePeers).toBe(true);
    expect(urls[1].urlKey).toBe("https://inactive.com");
    expect(urls[1].hasActivePeers).toBe(false);
  });

  // D20: TTL-based deletion
  it("deletes expired inactive sessions", () => {
    const oldTime = Date.now() - 120_000; // 2 minutes ago
    store.setSession("r1", {
      roomId: "r1",
      urlKey: "https://expired.com",
      peers: [],
      hostPeerId: "",
      peerCount: 0,
      createdAt: oldTime,
      stateCache: null,
      stateUpdatedAt: oldTime,
    });
    store.setSession("r2", {
      roomId: "r2",
      urlKey: "https://active.com",
      peers: ["p1"],
      hostPeerId: "p1",
      peerCount: 1,
      createdAt: oldTime,
      stateCache: null,
      stateUpdatedAt: null,
    });

    const deleted = store.deleteExpiredSessions(60_000); // 1 minute TTL
    expect(deleted).toBe(1);
    expect(store.getSession("r1")).toBeNull();
    expect(store.getSession("r2")).not.toBeNull(); // Active session preserved
  });

  it("does not delete sessions within TTL", () => {
    store.setSession("r1", {
      roomId: "r1",
      urlKey: "https://recent.com",
      peers: [],
      hostPeerId: "",
      peerCount: 0,
      createdAt: Date.now(),
      stateCache: null,
      stateUpdatedAt: Date.now(),
    });

    const deleted = store.deleteExpiredSessions(60_000);
    expect(deleted).toBe(0);
    expect(store.getSession("r1")).not.toBeNull();
  });
});
