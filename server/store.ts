// D11: KV interface + InMemoryRoomStore implementation

export interface SessionData {
  roomId: string;
  urlKey: string;
  peers: string[];
  hostPeerId: string;
  peerCount: number;
  createdAt: number;
}

export interface UrlSummary {
  urlKey: string;
  totalPeers: number;
  sessionCount: number;
}

export interface RoomStore {
  getSession(roomId: string): SessionData | null;
  setSession(roomId: string, data: SessionData): void;
  deleteSession(roomId: string): void;
  getSessionsByUrl(urlKey: string): SessionData[];
  getAllUrls(): UrlSummary[];
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
      result.push({ urlKey, totalPeers, sessionCount: roomIds.size });
    }
    result.sort((a, b) => b.totalPeers - a.totalPeers);
    return result;
  }
}
