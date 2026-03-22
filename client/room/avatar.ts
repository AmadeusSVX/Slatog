// D3: Avatar 3D representation and position sync
// Each peer is represented as a simple mesh in the 3D scene.
// Local avatar position is broadcast at 20Hz via unreliable DataChannel.

import * as THREE from "three";
import type { PeerManager } from "./peer-manager.js";
import type { SceneContext } from "./scene.js";
import type { AvatarPosData } from "../../shared/data-protocol.js";

const SEND_INTERVAL_MS = 50; // 20Hz
const AVATAR_RADIUS = 30;
const AVATAR_COLORS = [
  0x5b8def, 0xef5b5b, 0x5bef8d, 0xefcf5b, 0xcf5bef, 0x5befef, 0xef8d5b, 0x8d5bef, 0xef5bcf,
  0x5bef5b,
];
const NAME_SPRITE_Y_OFFSET = 50;

interface RemoteAvatar {
  mesh: THREE.Mesh;
  nameSprite: THREE.Sprite;
  targetPos: THREE.Vector3;
  targetRotY: number;
}

export class AvatarManager {
  private scene: THREE.Scene;
  private peerManager: PeerManager;
  private myPeerId: string;
  private localPos = new THREE.Vector3(0, 200, 600);
  private localRotY = 0;
  private remoteAvatars = new Map<string, RemoteAvatar>();
  private sendTimer: ReturnType<typeof setInterval> | null = null;
  private colorIndex = 0;

  constructor(ctx: SceneContext, peerManager: PeerManager, myPeerId: string) {
    this.scene = ctx.scene;
    this.peerManager = peerManager;
    this.myPeerId = myPeerId;
    this.startSending();
  }

  /** Update local avatar position (called from controls/camera) */
  setLocalPosition(x: number, y: number, z: number, rotY: number): void {
    this.localPos.set(x, y, z);
    this.localRotY = rotY;
  }

  /** Add a remote peer's avatar to the scene */
  addPeer(peerId: string, peerName: string): void {
    if (this.remoteAvatars.has(peerId)) return;

    const color = AVATAR_COLORS[this.colorIndex % AVATAR_COLORS.length];
    this.colorIndex++;

    // Simple sphere avatar
    const geometry = new THREE.SphereGeometry(AVATAR_RADIUS, 16, 12);
    const material = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 200, 600);
    this.scene.add(mesh);

    // Name label sprite
    const nameSprite = createNameSprite(peerName, color);
    nameSprite.position.copy(mesh.position);
    nameSprite.position.y += NAME_SPRITE_Y_OFFSET;
    this.scene.add(nameSprite);

    this.remoteAvatars.set(peerId, {
      mesh,
      nameSprite,
      targetPos: mesh.position.clone(),
      targetRotY: 0,
    });
  }

  /** Remove a peer's avatar from the scene */
  removePeer(peerId: string): void {
    const avatar = this.remoteAvatars.get(peerId);
    if (!avatar) return;
    this.scene.remove(avatar.mesh);
    this.scene.remove(avatar.nameSprite);
    avatar.mesh.geometry.dispose();
    (avatar.mesh.material as THREE.Material).dispose();
    (avatar.nameSprite.material as THREE.SpriteMaterial).map?.dispose();
    (avatar.nameSprite.material as THREE.Material).dispose();
    this.remoteAvatars.delete(peerId);
  }

  /** Handle incoming avatar position from a remote peer */
  handleRemotePosition(msg: AvatarPosData): void {
    const avatar = this.remoteAvatars.get(msg.peerId);
    if (!avatar) return;
    avatar.targetPos.set(msg.x, msg.y, msg.z);
    avatar.targetRotY = msg.rotY;
  }

  /** Call each frame to interpolate remote avatar positions */
  update(): void {
    for (const [, avatar] of this.remoteAvatars) {
      avatar.mesh.position.lerp(avatar.targetPos, 0.2);
      avatar.mesh.rotation.y += (avatar.targetRotY - avatar.mesh.rotation.y) * 0.2;
      avatar.nameSprite.position.copy(avatar.mesh.position);
      avatar.nameSprite.position.y += NAME_SPRITE_Y_OFFSET;
    }
  }

  /** Get a remote avatar's mesh position (for chat bubble placement) */
  getPeerPosition(peerId: string): THREE.Vector3 | null {
    return this.remoteAvatars.get(peerId)?.mesh.position ?? null;
  }

  dispose(): void {
    if (this.sendTimer) clearInterval(this.sendTimer);
    for (const peerId of [...this.remoteAvatars.keys()]) {
      this.removePeer(peerId);
    }
  }

  // --- Private ---

  private startSending(): void {
    this.sendTimer = setInterval(() => {
      const msg: AvatarPosData = {
        type: "AVATAR_POS",
        peerId: this.myPeerId,
        x: this.localPos.x,
        y: this.localPos.y,
        z: this.localPos.z,
        rotY: this.localRotY,
        timestamp: Date.now(),
      };
      this.peerManager.broadcast("realtime", JSON.stringify(msg));
    }, SEND_INTERVAL_MS);
  }
}

/** Create a text sprite for a peer's name label */
function createNameSprite(name: string, color: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.fillText(name, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(120, 30, 1);
  return sprite;
}
