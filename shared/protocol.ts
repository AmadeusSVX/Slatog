// Signaling protocol message types (D1, D2, D7, D8)

// --- Client → Server ---

export interface JoinRoomMsg {
  type: "JOIN_ROOM";
  urlKey: string;
  peerId: string;
  peerName: string;
  userId: string; // D14: persistent user identity
}

export interface LeaveRoomMsg {
  type: "LEAVE_ROOM";
}

export interface SdpOfferMsg {
  type: "SDP_OFFER";
  targetPeerId: string;
  sdp: RTCSessionDescriptionInit;
}

export interface SdpAnswerMsg {
  type: "SDP_ANSWER";
  targetPeerId: string;
  sdp: RTCSessionDescriptionInit;
}

export interface IceCandidateMsg {
  type: "ICE_CANDIDATE";
  targetPeerId: string;
  candidate: RTCIceCandidateInit;
}

export type ClientMessage =
  | JoinRoomMsg
  | LeaveRoomMsg
  | SdpOfferMsg
  | SdpAnswerMsg
  | IceCandidateMsg;

// --- Server → Client ---

export interface RoomJoinedMsg {
  type: "ROOM_JOINED";
  roomId: string;
  peerId: string;
  peers: PeerInfo[];
  hostPeerId: string;
}

export interface PeerJoinedMsg {
  type: "PEER_JOINED";
  peerId: string;
  peerName: string;
  userId: string; // D14
}

export interface PeerLeftMsg {
  type: "PEER_LEFT";
  peerId: string;
}

export interface SdpRelayMsg {
  type: "SDP_OFFER" | "SDP_ANSWER";
  fromPeerId: string;
  sdp: RTCSessionDescriptionInit;
}

export interface IceCandidateRelayMsg {
  type: "ICE_CANDIDATE";
  fromPeerId: string;
  candidate: RTCIceCandidateInit;
}

export interface HostMigrationMsg {
  type: "HOST_MIGRATION";
  newHostPeerId: string;
}

export interface ErrorMsg {
  type: "ERROR";
  message: string;
}

export type ServerMessage =
  | RoomJoinedMsg
  | PeerJoinedMsg
  | PeerLeftMsg
  | SdpRelayMsg
  | IceCandidateRelayMsg
  | HostMigrationMsg
  | ErrorMsg;

// --- Shared ---

export interface PeerInfo {
  peerId: string;
  peerName: string;
  userId: string; // D14
}

export const MAX_PEERS_PER_ROOM = 10;
