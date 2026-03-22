// D3, D5: Room state management with CRDT and 64KB budget enforcement
// State-based sync: modules mutate RoomState, onChange callback triggers broadcast.

import { LWWRegister, LWWMap } from "./crdt.js";
import type { ChatMessageEntry, StrokeEntry, RoomStateSnapshot } from "./data-protocol.js";

const TOTAL_BUDGET = 65536; // 64KB
const CHAT_BUDGET = 16384; // 16KB
const META_BUDGET = 1024; // 1KB reserved

export class RoomState {
  urlKey: string;
  scrollPosition: LWWRegister<{ x: number; y: number }>;
  chatMessages: LWWMap<ChatMessageEntry>;
  strokes: LWWMap<StrokeEntry>;
  hostPeerId: string;
  private onChangeCallback: ((immediate: boolean) => void) | null = null;

  constructor(urlKey: string) {
    this.urlKey = urlKey;
    this.scrollPosition = new LWWRegister({ x: 0, y: 0 });
    this.chatMessages = new LWWMap<ChatMessageEntry>();
    this.strokes = new LWWMap<StrokeEntry>();
    this.hostPeerId = "";
  }

  /** Register callback for state changes. immediate=true for chat/stroke, false for scroll. */
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

  updateScroll(x: number, y: number, timestamp: number): boolean {
    const changed = this.scrollPosition.set({ x, y }, timestamp);
    if (changed) {
      this.onChangeCallback?.(false);
    }
    return changed;
  }

  /** D5: Deterministic budget enforcement algorithm */
  enforceBudget(): void {
    // Phase 1: enforce chat 16KB limit
    let chatSize = byteSize(this.chatMessages.toJSON());
    while (chatSize > CHAT_BUDGET && this.chatMessages.size > 0) {
      this.chatMessages.removeOldest();
      chatSize = byteSize(this.chatMessages.toJSON());
    }

    // Phase 2: enforce stroke budget (remaining after meta + chat)
    const strokeBudget = TOTAL_BUDGET - META_BUDGET - chatSize;
    let strokeSize = byteSize(this.strokes.toJSON());
    while (strokeSize > strokeBudget && this.strokes.size > 0) {
      this.strokes.removeOldest();
      strokeSize = byteSize(this.strokes.toJSON());
    }
  }

  /** Serialize to snapshot for broadcast */
  toSnapshot(): RoomStateSnapshot {
    return {
      scrollPosition: this.scrollPosition.toJSON(),
      chatMessages: this.chatMessages.toJSON(),
      strokes: this.strokes.toJSON(),
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

    this.enforceBudget();
  }

  /** Total serialized size in bytes */
  totalSize(): number {
    return byteSize(this.toSnapshot());
  }
}

function byteSize(obj: unknown): number {
  return new TextEncoder().encode(JSON.stringify(obj)).byteLength;
}
