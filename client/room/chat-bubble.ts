// D9: 3D chat bubble — SpriteMaterial + CanvasTexture
// Displays latest message as a speech bubble above the sender's avatar.
// Fades out after 5 seconds. Text exceeding 3 lines is truncated with "...".

import * as THREE from "three";
import type { AvatarManager } from "./avatar.js";
import type { ChatMessageEntry } from "../../shared/data-protocol.js";

const BUBBLE_DURATION_MS = 5000;
const BUBBLE_Y_OFFSET = 80;
const CANVAS_WIDTH = 512;
const CANVAS_HEIGHT = 128;
const MAX_LINES = 3;
const LINE_CHARS = 20;
const FONT = "24px sans-serif";
const BG_COLOR = "rgba(30,30,45,0.85)";
const TEXT_COLOR = "#fff";
const SPRITE_SCALE_X = 200;
const SPRITE_SCALE_Y = 50;

interface ActiveBubble {
  sprite: THREE.Sprite;
  peerId: string;
  expireAt: number;
}

export class ChatBubbleManager {
  private scene: THREE.Scene;
  private avatars: AvatarManager;
  private bubbles: ActiveBubble[] = [];
  private myPeerId: string;
  private localBubble: ActiveBubble | null = null;
  private localBubblePos: THREE.Vector3;

  constructor(scene: THREE.Scene, avatars: AvatarManager, myPeerId: string) {
    this.scene = scene;
    this.avatars = avatars;
    this.myPeerId = myPeerId;
    this.localBubblePos = new THREE.Vector3(0, 200 + BUBBLE_Y_OFFSET, 600);
  }

  showBubble(msg: ChatMessageEntry): void {
    const isLocal = msg.authorPeerId === this.myPeerId;

    if (isLocal) {
      this.removeLocalBubble();
    } else {
      this.removeBubbleForPeer(msg.authorPeerId);
    }

    const sprite = createBubbleSprite(msg.text);
    this.scene.add(sprite);

    const now = Date.now();
    const bubble: ActiveBubble = {
      sprite,
      peerId: msg.authorPeerId,
      expireAt: now + BUBBLE_DURATION_MS,
    };

    if (isLocal) {
      this.localBubble = bubble;
    } else {
      this.bubbles.push(bubble);
    }
  }

  update(): void {
    const now = Date.now();

    if (this.localBubble) {
      this.localBubble.sprite.position.copy(this.localBubblePos);
      if (now >= this.localBubble.expireAt) {
        this.removeLocalBubble();
      } else {
        const remaining = this.localBubble.expireAt - now;
        if (remaining < 1000) {
          (this.localBubble.sprite.material as THREE.SpriteMaterial).opacity = remaining / 1000;
        }
      }
    }

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const bubble = this.bubbles[i];

      const avatarPos = this.avatars.getPeerPosition(bubble.peerId);
      if (avatarPos) {
        bubble.sprite.position.copy(avatarPos);
        bubble.sprite.position.y += BUBBLE_Y_OFFSET;
      }

      if (now >= bubble.expireAt) {
        this.scene.remove(bubble.sprite);
        disposeBubbleSprite(bubble.sprite);
        this.bubbles.splice(i, 1);
      } else {
        const remaining = bubble.expireAt - now;
        if (remaining < 1000) {
          (bubble.sprite.material as THREE.SpriteMaterial).opacity = remaining / 1000;
        }
      }
    }
  }

  setLocalPosition(pos: THREE.Vector3): void {
    this.localBubblePos.copy(pos);
    this.localBubblePos.y += BUBBLE_Y_OFFSET;
  }

  dispose(): void {
    this.removeLocalBubble();
    for (const bubble of this.bubbles) {
      this.scene.remove(bubble.sprite);
      disposeBubbleSprite(bubble.sprite);
    }
    this.bubbles = [];
  }

  private removeLocalBubble(): void {
    if (!this.localBubble) return;
    this.scene.remove(this.localBubble.sprite);
    disposeBubbleSprite(this.localBubble.sprite);
    this.localBubble = null;
  }

  private removeBubbleForPeer(peerId: string): void {
    const idx = this.bubbles.findIndex((b) => b.peerId === peerId);
    if (idx === -1) return;
    const bubble = this.bubbles[idx];
    this.scene.remove(bubble.sprite);
    disposeBubbleSprite(bubble.sprite);
    this.bubbles.splice(idx, 1);
  }
}

function createBubbleSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = BG_COLOR;
  roundRect(ctx, 4, 4, CANVAS_WIDTH - 8, CANVAS_HEIGHT - 8, 12);
  ctx.fill();

  ctx.font = FONT;
  ctx.fillStyle = TEXT_COLOR;
  ctx.textBaseline = "top";

  const lines = wrapText(text, LINE_CHARS, MAX_LINES);
  const lineHeight = 30;
  const startY = (CANVAS_HEIGHT - lines.length * lineHeight) / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 20, startY + i * lineHeight);
  }

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(SPRITE_SCALE_X, SPRITE_SCALE_Y, 1);
  return sprite;
}

function disposeBubbleSprite(sprite: THREE.Sprite): void {
  (sprite.material as THREE.SpriteMaterial).map?.dispose();
  (sprite.material as THREE.Material).dispose();
}

function wrapText(text: string, charsPerLine: number, maxLines: number): string[] {
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0 && lines.length < maxLines) {
    if (remaining.length <= charsPerLine) {
      lines.push(remaining);
      remaining = "";
    } else if (lines.length === maxLines - 1) {
      lines.push(remaining.slice(0, charsPerLine - 3) + "...");
      remaining = "";
    } else {
      lines.push(remaining.slice(0, charsPerLine));
      remaining = remaining.slice(charsPerLine);
    }
  }
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
