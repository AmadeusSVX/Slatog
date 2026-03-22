// DataChannel message types for P2P communication (D2, D3, D5)
// State channel: only STATE_SNAPSHOT (full state broadcast)
// Realtime channel: AVATAR_POS (transient, 20Hz)

// --- State channel (reliable, ordered) ---

export interface StateSnapshotData {
  type: "STATE_SNAPSHOT";
  snapshot: string; // JSON-serialized RoomStateSnapshot
}

export type StateChannelMsg = StateSnapshotData;

// --- Realtime channel (unreliable, unordered) ---

export interface AvatarPosData {
  type: "AVATAR_POS";
  peerId: string;
  x: number;
  y: number;
  z: number;
  rotY: number; // Y-axis rotation in radians
  timestamp: number;
}

export type RealtimeChannelMsg = AvatarPosData;

// --- Union ---

export type DataChannelMsg = StateChannelMsg | RealtimeChannelMsg;

// --- Room state data structures ---

export interface RoomStateSnapshot {
  scrollPosition: { value: { x: number; y: number }; timestamp: number };
  chatMessages: Record<string, { value: ChatMessageEntry; timestamp: number }>;
  strokes: Record<string, { value: StrokeEntry; timestamp: number }>;
}

export interface ChatMessageEntry {
  id: string;
  authorPeerId: string;
  authorName: string;
  colorIndex: number; // D15: index into USER_COLORS
  text: string;
  timestamp: number;
}

export interface StrokeEntry {
  id: string;
  authorPeerId: string;
  points: { x: number; y: number; z: number }[];
  color: string;
  width: number;
  timestamp: number;
}
