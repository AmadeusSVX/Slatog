// WebRTC peer connection manager (D1, D2)
// Manages full-mesh P2P connections with 2 DataChannels per peer:
//   - "state" (reliable, ordered): chat, pen strokes, scroll position
//   - "realtime" (unreliable, unordered): avatar position/rotation 20Hz

import { SLATOG_CONFIG } from "../../shared/config.js";
import type { SignalingClient } from "./signaling-client.js";

export type DataChannelHandler = (peerId: string, channel: string, data: string) => void;
export type PeerStateHandler = (peerId: string, state: "connected" | "disconnected") => void;
export type ChannelOpenHandler = (peerId: string, channel: "state" | "realtime") => void;

interface PeerEntry {
  conn: RTCPeerConnection;
  stateChannel: RTCDataChannel | null;
  realtimeChannel: RTCDataChannel | null;
  connected: boolean;
}

export class PeerManager {
  private peers = new Map<string, PeerEntry>();
  private signaling: SignalingClient;
  private onData: DataChannelHandler;
  private onPeerState: PeerStateHandler;
  private onChannelOpen: ChannelOpenHandler | null = null;

  constructor(
    signaling: SignalingClient,
    onData: DataChannelHandler,
    onPeerState: PeerStateHandler,
  ) {
    this.signaling = signaling;
    this.onData = onData;
    this.onPeerState = onPeerState;
  }

  /** Register a callback for when a specific DataChannel opens */
  setOnChannelOpen(handler: ChannelOpenHandler): void {
    this.onChannelOpen = handler;
  }

  /** Create an offer to a remote peer (we are the offerer) */
  async createOffer(remotePeerId: string): Promise<void> {
    const entry = this.createPeerConnection(remotePeerId);

    // Offerer creates DataChannels
    entry.stateChannel = entry.conn.createDataChannel("state", {
      ordered: true,
    });
    entry.realtimeChannel = entry.conn.createDataChannel("realtime", {
      ordered: false,
      maxRetransmits: 0,
    });
    this.setupDataChannel(remotePeerId, entry.stateChannel, "state");
    this.setupDataChannel(remotePeerId, entry.realtimeChannel, "realtime");

    const offer = await entry.conn.createOffer();
    await entry.conn.setLocalDescription(offer);

    this.signaling.send({
      type: "SDP_OFFER",
      targetPeerId: remotePeerId,
      sdp: entry.conn.localDescription!,
    });
  }

  /** Handle an incoming SDP offer */
  async handleOffer(
    remotePeerId: string,
    sdp: RTCSessionDescriptionInit,
  ): Promise<void> {
    const entry = this.createPeerConnection(remotePeerId);

    await entry.conn.setRemoteDescription(sdp);
    const answer = await entry.conn.createAnswer();
    await entry.conn.setLocalDescription(answer);

    this.signaling.send({
      type: "SDP_ANSWER",
      targetPeerId: remotePeerId,
      sdp: entry.conn.localDescription!,
    });
  }

  /** Handle an incoming SDP answer */
  async handleAnswer(
    remotePeerId: string,
    sdp: RTCSessionDescriptionInit,
  ): Promise<void> {
    const entry = this.peers.get(remotePeerId);
    if (!entry) return;
    await entry.conn.setRemoteDescription(sdp);
  }

  /** Handle an incoming ICE candidate */
  async handleIceCandidate(
    remotePeerId: string,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    const entry = this.peers.get(remotePeerId);
    if (!entry) return;
    await entry.conn.addIceCandidate(candidate);
  }

  /** Send data to a specific peer on a named channel */
  sendTo(peerId: string, channel: "state" | "realtime", data: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    const dc =
      channel === "state" ? entry.stateChannel : entry.realtimeChannel;
    if (dc?.readyState === "open") {
      dc.send(data);
    }
  }

  /** Broadcast data to all connected peers on a named channel */
  broadcast(channel: "state" | "realtime", data: string): void {
    for (const [peerId, entry] of this.peers) {
      if (!entry.connected) continue;
      const dc =
        channel === "state" ? entry.stateChannel : entry.realtimeChannel;
      if (dc?.readyState === "open") {
        dc.send(data);
      } else {
        console.warn(`[peer] channel ${channel} not open for ${peerId}`);
      }
    }
  }

  /** Remove a peer connection */
  removePeer(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (entry) {
      entry.stateChannel?.close();
      entry.realtimeChannel?.close();
      entry.conn.close();
      this.peers.delete(peerId);
    }
  }

  /** Clean up all connections */
  destroy(): void {
    for (const peerId of [...this.peers.keys()]) {
      this.removePeer(peerId);
    }
  }

  get connectedPeerIds(): string[] {
    return [...this.peers.entries()]
      .filter(([, e]) => e.connected)
      .map(([id]) => id);
  }

  // --- Private ---

  private createPeerConnection(remotePeerId: string): PeerEntry {
    // Close existing if any
    this.removePeer(remotePeerId);

    const conn = new RTCPeerConnection({
      iceServers: SLATOG_CONFIG.STUN_SERVERS.map((url) => ({ urls: url })),
    });

    const entry: PeerEntry = {
      conn,
      stateChannel: null,
      realtimeChannel: null,
      connected: false,
    };
    this.peers.set(remotePeerId, entry);

    conn.onicecandidate = (e) => {
      if (e.candidate) {
        this.signaling.send({
          type: "ICE_CANDIDATE",
          targetPeerId: remotePeerId,
          candidate: e.candidate,
        });
      }
    };

    conn.onconnectionstatechange = () => {
      const state = conn.connectionState;
      if (state === "connected") {
        entry.connected = true;
        this.onPeerState(remotePeerId, "connected");
      } else if (
        state === "disconnected" ||
        state === "failed" ||
        state === "closed"
      ) {
        entry.connected = false;
        this.onPeerState(remotePeerId, "disconnected");
      }
    };

    // Answerer receives DataChannels via ondatachannel
    conn.ondatachannel = (e) => {
      const dc = e.channel;
      if (dc.label === "state") {
        entry.stateChannel = dc;
        this.setupDataChannel(remotePeerId, dc, "state");
      } else if (dc.label === "realtime") {
        entry.realtimeChannel = dc;
        this.setupDataChannel(remotePeerId, dc, "realtime");
      }
    };

    return entry;
  }

  private setupDataChannel(
    remotePeerId: string,
    dc: RTCDataChannel,
    name: string,
  ): void {
    dc.onmessage = (e) => {
      this.onData(remotePeerId, name, e.data as string);
    };
    dc.onopen = () => {
      console.log(`[peer] ${name} channel open with ${remotePeerId}`);
      if (name === "state" || name === "realtime") {
        this.onChannelOpen?.(remotePeerId, name as "state" | "realtime");
      }
    };
    dc.onclose = () => {
      console.log(`[peer] ${name} channel closed with ${remotePeerId}`);
    };
  }
}
