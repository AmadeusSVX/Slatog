// D3, D5, D23, D28: Room state management with CRDT and 64KB budget enforcement
// D23: Budget reformed to fully shared pool (chat + stickers + strokes share 63KB).
// D28: banned_ips added; enforcebudget uses priority-based deletion.
// State-based sync: modules mutate RoomState, onChange callback triggers broadcast.

import { LWWRegister, LWWMap } from "./crdt.js";
import type {
  ChatMessageEntry,
  StrokeEntry,
  TextStickerEntry,
  BannedIPEntry,
  RoomStateSnapshot,
} from "./data-protocol.js";

const TOTAL_BUDGET = 65536; // 64KB
const META_BUDGET = 1024; // 1KB reserved

export class RoomState {
  urlKey: string;
  scrollPosition: LWWRegister<{ x: number; y: number }>;
  chatMessages: LWWMap<ChatMessageEntry>;
  strokes: LWWMap<StrokeEntry>;
  textStickers: LWWMap<TextStickerEntry>; // D23
  bannedIps: LWWMap<BannedIPEntry>; // D28
  hostPeerId: string;
  private onChangeCallback: ((immediate: boolean) => void) | null = null;

  constructor(urlKey: string) {
    this.urlKey = urlKey;
    this.scrollPosition = new LWWRegister({ x: 0, y: 0 });
    this.chatMessages = new LWWMap<ChatMessageEntry>();
    this.strokes = new LWWMap<StrokeEntry>();
    this.textStickers = new LWWMap<TextStickerEntry>();
    this.bannedIps = new LWWMap<BannedIPEntry>();
    this.hostPeerId = "";
  }

  /** Register callback for state changes. immediate=true for chat/stroke/sticker, false for scroll. */
  setOnChange(cb: (immediate: boolean) => void): void {
    this.onChangeCallback = cb;
  }

  addChatMessage(msg: ChatMessageEntry): void {
    this.chatMessages.set(msg.id, msg, msg.timestamp);
    this.enforceBudget();
    this.onChangeCallback?.(true);
  }

  addStroke(stroke: StrokeEntry): void {
    this.strokes.set(stroke.id, stroke, stroke.timestamp);
    this.enforceBudget();
    this.onChangeCallback?.(true);
  }

  addTextSticker(sticker: TextStickerEntry): void {
    this.textStickers.set(sticker.id, sticker, sticker.timestamp);
    this.enforceBudget();
    this.onChangeCallback?.(true);
  }

  addBannedIp(entry: BannedIPEntry): void {
    this.bannedIps.set(entry.ip, entry, entry.banned_at);
    this.enforceBudget();
    this.onChangeCallback?.(true);
  }

  removeBannedIp(ip: string): void {
    this.bannedIps.delete(ip);
    this.onChangeCallback?.(true);
  }

  updateScroll(x: number, y: number, timestamp: number): boolean {
    const changed = this.scrollPosition.set({ x, y }, timestamp);
    if (changed) {
      this.onChangeCallback?.(false);
    }
    return changed;
  }

  /**
   * D5 reformed (D23): Fully shared pool budget enforcement.
   * 63KB shared pool (64KB - 1KB meta) across chat, stickers, and strokes.
   * When over budget, remove the oldest item by timestamp across all categories.
   */
  enforceBudget(): void {
    const poolBudget = TOTAL_BUDGET - META_BUDGET;

    let contentSize = this.contentByteSize();
    while (contentSize > poolBudget) {
      const removed = this.removeOldestAcrossAll();
      if (!removed) break;
      contentSize = this.contentByteSize();
    }
  }

  /** Serialize to snapshot for broadcast */
  toSnapshot(): RoomStateSnapshot {
    return {
      scrollPosition: this.scrollPosition.toJSON(),
      chatMessages: this.chatMessages.toJSON(),
      strokes: this.strokes.toJSON(),
      textStickers: this.textStickers.toJSON(),
      bannedIps: this.bannedIps.toJSON(),
    };
  }

  /**
   * Apply a received snapshot — replace + merge strategy.
   * 1. Delete local entries absent from the incoming snapshot (propagates budget deletions)
   * 2. LWW merge incoming entries
   * 3. Enforce budget for deterministic convergence
   * Does NOT trigger onChange (reception should not re-broadcast).
   */
  applySnapshot(snap: RoomStateSnapshot): void {
    // Scroll
    this.scrollPosition.set(snap.scrollPosition.value, snap.scrollPosition.timestamp);

    // Chat messages — delete absent keys, then merge
    const incomingChatKeys = new Set(Object.keys(snap.chatMessages));
    for (const key of this.chatMessages.keys()) {
      if (!incomingChatKeys.has(key)) {
        this.chatMessages.delete(key);
      }
    }
    for (const [key, entry] of Object.entries(snap.chatMessages)) {
      this.chatMessages.set(key, entry.value, entry.timestamp);
    }

    // Strokes — delete absent keys, then merge
    const incomingStrokeKeys = new Set(Object.keys(snap.strokes));
    for (const key of this.strokes.keys()) {
      if (!incomingStrokeKeys.has(key)) {
        this.strokes.delete(key);
      }
    }
    for (const [key, entry] of Object.entries(snap.strokes)) {
      this.strokes.set(key, entry.value, entry.timestamp);
    }

    // D23: Text stickers — delete absent keys, then merge
    const incomingStickerKeys = new Set(Object.keys(snap.textStickers ?? {}));
    for (const key of this.textStickers.keys()) {
      if (!incomingStickerKeys.has(key)) {
        this.textStickers.delete(key);
      }
    }
    if (snap.textStickers) {
      for (const [key, entry] of Object.entries(snap.textStickers)) {
        this.textStickers.set(key, entry.value, entry.timestamp);
      }
    }

    // D28: Banned IPs — delete absent keys, then merge
    const incomingBanKeys = new Set(Object.keys(snap.bannedIps ?? {}));
    for (const key of this.bannedIps.keys()) {
      if (!incomingBanKeys.has(key)) {
        this.bannedIps.delete(key);
      }
    }
    if (snap.bannedIps) {
      for (const [key, entry] of Object.entries(snap.bannedIps)) {
        this.bannedIps.set(key, entry.value, entry.timestamp);
      }
    }

    this.enforceBudget();
  }

  /** Total serialized size in bytes */
  totalSize(): number {
    return byteSize(this.toSnapshot());
  }

  /** Sum of content categories byte sizes (chat + stickers + strokes + bannedIps) */
  private contentByteSize(): number {
    return (
      byteSize(this.chatMessages.toJSON()) +
      byteSize(this.textStickers.toJSON()) +
      byteSize(this.strokes.toJSON()) +
      byteSize(this.bannedIps.toJSON())
    );
  }

  /**
   * D28: Priority-based deletion for budget enforcement.
   * Deletion priority (highest first):
   *   1. chat_messages — oldest timestamp
   *   2. text_stickers — oldest timestamp
   *   3. strokes — oldest timestamp
   *   4. banned_ips — oldest banned_at (last resort)
   * Within a priority level, removes the oldest item.
   * Only moves to next level when current level is empty.
   */
  private removeOldestAcrossAll(): boolean {
    // Priority 1: chat_messages
    if (this.chatMessages.entriesByTime().length > 0) {
      this.chatMessages.removeOldest();
      return true;
    }
    // Priority 2: text_stickers
    if (this.textStickers.entriesByTime().length > 0) {
      this.textStickers.removeOldest();
      return true;
    }
    // Priority 3: strokes
    if (this.strokes.entriesByTime().length > 0) {
      this.strokes.removeOldest();
      return true;
    }
    // Priority 4: banned_ips (lowest priority — last to be deleted)
    if (this.bannedIps.entriesByTime().length > 0) {
      this.bannedIps.removeOldest();
      return true;
    }
    return false;
  }
}

function byteSize(obj: unknown): number {
  return new TextEncoder().encode(JSON.stringify(obj)).byteLength;
}
