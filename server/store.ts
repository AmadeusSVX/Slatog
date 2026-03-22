// D11, D18, D20: KV interface + InMemoryRoomStore implementation

export interface SessionData {
  roomId: string;
  urlKey: string;
  peers: string[];
  hostPeerId: string;
  peerCount: number;
  createdAt: number;
  stateCache: string | null; // D18: RoomState JSON serialized
  stateUpdatedAt: number | null; // D18: last cache update time (Unix ms)
}

export interface UrlSummary {
  urlKey: string;
  totalPeers: number;
  sessionCount: number;
  hasActivePeers: boolean; // D19
}

export interface RoomStore {
  getSession(roomId: string): SessionData | null;
  setSession(roomId: string, data: SessionData): void;
  deleteSession(roomId: string): void;
  getSessionsByUrl(urlKey: string): SessionData[];
  getAllUrls(): UrlSummary[];

  // D18: State cache
  setStateCache(roomId: string, stateJson: string): void;
  getStateCache(roomId: string): string | null;

  // D20: TTL-based cleanup
  deleteExpiredSessions(ttlMs: number): number;
}

export class InMemoryRoomStore implements RoomStore {
  private sessions = new Map<string, SessionData>();
  private urlIndex = new Map<string, Set<string>>();

  getSession(roomId: string): SessionData | null {
    return this.sessions.get(roomId) ?? null;
  }

  setSession(roomId: string, data: SessionData): void {
    const existing = this.sessions.get(roomId);
    if (existing && existing.urlKey !== data.urlKey) {
      this.urlIndex.get(existing.urlKey)?.delete(roomId);
    }

    this.sessions.set(roomId, data);

    if (!this.urlIndex.has(data.urlKey)) {
      this.urlIndex.set(data.urlKey, new Set());
    }
    this.urlIndex.get(data.urlKey)!.add(roomId);
  }

  deleteSession(roomId: string): void {
    const session = this.sessions.get(roomId);
    if (session) {
      const roomIds = this.urlIndex.get(session.urlKey);
      if (roomIds) {
        roomIds.delete(roomId);
        if (roomIds.size === 0) {
          this.urlIndex.delete(session.urlKey);
        }
      }
      this.sessions.delete(roomId);
    }
  }

  getSessionsByUrl(urlKey: string): SessionData[] {
    const roomIds = this.urlIndex.get(urlKey);
    if (!roomIds) return [];
    return [...roomIds].map((id) => this.sessions.get(id)!);
  }

  getAllUrls(): UrlSummary[] {
    const result: UrlSummary[] = [];
    for (const [urlKey, roomIds] of this.urlIndex) {
      let totalPeers = 0;
      for (const id of roomIds) {
        totalPeers += this.sessions.get(id)!.peerCount;
      }
      result.push({
        urlKey,
        totalPeers,
        sessionCount: roomIds.size,
        hasActivePeers: totalPeers > 0, // D19
      });
    }
    // D19: Active first (desc), then by totalPeers desc
    result.sort((a, b) => {
      if (a.hasActivePeers !== b.hasActivePeers) return a.hasActivePeers ? -1 : 1;
      return b.totalPeers - a.totalPeers;
    });
    return result;
  }

  // D18: Store state cache
  setStateCache(roomId: string, stateJson: string): void {
    const session = this.sessions.get(roomId);
    if (session) {
      session.stateCache = stateJson;
      session.stateUpdatedAt = Date.now();
    }
  }

  // D18: Retrieve state cache
  getStateCache(roomId: string): string | null {
    return this.sessions.get(roomId)?.stateCache ?? null;
  }

  // D20: Delete expired inactive sessions
  deleteExpiredSessions(ttlMs: number): number {
    const now = Date.now();
    let deleted = 0;
    for (const [roomId, session] of this.sessions) {
      if (session.peerCount === 0) {
        const baseTime = session.stateUpdatedAt ?? session.createdAt;
        if (now - baseTime > ttlMs) {
          this.deleteSession(roomId);
          deleted++;
        }
      }
    }
    return deleted;
  }
}
