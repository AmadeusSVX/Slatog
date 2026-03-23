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
  textStickers: Record<string, { value: TextStickerEntry; timestamp: number }>; // D23
  bannedIps: Record<string, { value: BannedIPEntry; timestamp: number }>; // D28
  primitives: Record<string, { value: PrimitiveEntry; timestamp: number }>; // D32
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

// D28: BAN entry for IP-based access control
export interface BannedIPEntry {
  ip: string; // IPv4 or IPv6
  banned_at: number; // Unix ms
  expires_at: number; // Unix ms (0 = until server restart)
  reason: string; // e.g. "sticker_spam"
}

// D32: 3D primitive placed in room
export interface PrimitiveEntry {
  id: string; // UUID v4
  author_peer_id: string;
  color: string; // D15 user color hex
  shape: "cone" | "cube" | "sphere" | "cylinder";
  scale: number; // uniform scale multiplier (default 1.0)
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number }; // Euler angles in radians
  timestamp: number; // Unix ms
}

// D23: Text sticker placed on room walls
export interface TextStickerEntry {
  id: string;
  author_peer_id: string;
  author_name: string;
  color: string; // D15 user color hex
  text: string; // UTF-8, max 32 chars (D33: 140→32)
  font_size?: number; // D30: font size in px (default 24)
  position: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  show_author: boolean; // D24
  timestamp: number; // Unix ms
}
