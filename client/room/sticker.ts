// D23: Text sticker — place text on room walls via raycast
// D24: showStickerAuthor toggle (localStorage)
// State-based sync: placeSticker() mutates RoomState only; broadcast is handled by main.ts.
// reconcileUI calls renderSticker/removeSticker for incremental scene updates.

import * as THREE from "three";
import { v4 as uuidv4 } from "uuid";
import type { RoomState } from "../../shared/room-state.js";
import type { TextStickerEntry } from "../../shared/data-protocol.js";
import type { SceneContext } from "./scene.js";

const MAX_STICKER_TEXT = 32; // D33: 140→32文字に縮小
const STICKER_OFFSET = 5; // Z-fighting prevention (same as pen STROKE_CLAMP_OFFSET)
const CANVAS_PADDING = 16;
const MAX_CHARS_PER_LINE = 16;
const TEXT_OUTLINE_COLOR = "rgba(0, 0, 0, 0.5)";
const TEXT_OUTLINE_WIDTH = 3;
const STICKER_MESH_SCALE = 1.95; // Scale factor to map canvas pixels to 3D units (D30: 0.65→1.95)

// D30: Font size parameters
const STICKER_FONT_SIZE_MIN = 16;
const STICKER_FONT_SIZE_MAX = 48;
const STICKER_FONT_SIZE_DEFAULT = 24;
const STICKER_FONT_SIZE_STEP = 2;

// D24: localStorage key for author display preference
const LS_KEY_SHOW_AUTHOR = "slatog_show_sticker_author";
// D30: localStorage key for font size preference
const LS_KEY_FONT_SIZE = "slatog_sticker_font_size";

export class StickerManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private roomState: RoomState;
  private myPeerId: string;
  private myPeerName: string;
  private myColor: string;
  private raycaster = new THREE.Raycaster();
  private roomWalls: THREE.Group;
  private stickerMeshes = new Map<string, THREE.Mesh>();
  private enabled = false;
  private showAuthor: boolean;
  private fontSize: number; // D30
  private onStickerPlace: (() => void) | null = null; // D28: rate limit notification callback
  private rateLimited = false; // D28

  // UI elements
  private inputPanel: HTMLElement;
  private inputEl: HTMLInputElement;
  private fontSizeSlider: HTMLInputElement; // D30
  private fontSizeLabel: HTMLSpanElement; // D30
  private rateLimitNotice: HTMLElement; // D28
  private clickHandler: (e: MouseEvent) => void;

  constructor(
    ctx: SceneContext,
    roomState: RoomState,
    myPeerId: string,
    myPeerName: string,
    myColor: string,
  ) {
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.container = ctx.container;
    this.roomState = roomState;
    this.myPeerId = myPeerId;
    this.myPeerName = myPeerName;
    this.myColor = myColor;
    this.roomWalls = ctx.roomWalls;

    // D24: Load preference
    this.showAuthor = localStorage.getItem(LS_KEY_SHOW_AUTHOR) !== "false";

    // D30: Load font size preference
    const savedFontSize = parseInt(localStorage.getItem(LS_KEY_FONT_SIZE) ?? "", 10);
    this.fontSize =
      !isNaN(savedFontSize) &&
      savedFontSize >= STICKER_FONT_SIZE_MIN &&
      savedFontSize <= STICKER_FONT_SIZE_MAX
        ? savedFontSize
        : STICKER_FONT_SIZE_DEFAULT;

    // Build input UI
    this.inputPanel = document.createElement("div");
    this.inputPanel.id = "sticker-input-panel";
    this.inputPanel.style.display = "none";
    this.inputPanel.innerHTML = `
      <input type="text" id="sticker-text-input" placeholder="ステッカーテキスト（最大32文字）" maxlength="${MAX_STICKER_TEXT}" />
      <div class="sticker-font-size-row">
        <label>フォントサイズ:</label>
        <input type="range" id="sticker-font-size-slider" min="${STICKER_FONT_SIZE_MIN}" max="${STICKER_FONT_SIZE_MAX}" step="${STICKER_FONT_SIZE_STEP}" value="${this.fontSize}" />
        <span id="sticker-font-size-label">${this.fontSize}px</span>
      </div>
    `;
    // Prevent scene interaction when typing
    this.inputPanel.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.inputPanel.addEventListener("wheel", (e) => e.stopPropagation());
    document.querySelector(".room-container")?.appendChild(this.inputPanel);

    this.inputEl = this.inputPanel.querySelector("#sticker-text-input")!;
    this.fontSizeSlider = this.inputPanel.querySelector("#sticker-font-size-slider")!;
    this.fontSizeLabel = this.inputPanel.querySelector("#sticker-font-size-label")!;
    this.fontSizeSlider.addEventListener("input", () => {
      this.fontSize = parseInt(this.fontSizeSlider.value, 10);
      this.fontSizeLabel.textContent = `${this.fontSize}px`;
      localStorage.setItem(LS_KEY_FONT_SIZE, String(this.fontSize));
    });

    // D28: Rate limit notice
    this.rateLimitNotice = document.createElement("div");
    this.rateLimitNotice.id = "sticker-rate-limit-notice";
    this.rateLimitNotice.textContent = "連投制限中です。しばらくお待ちください。";
    this.rateLimitNotice.style.display = "none";
    document.querySelector(".room-container")?.appendChild(this.rateLimitNotice);

    this.clickHandler = this.onCanvasClick.bind(this);
  }

  /** D28: Set callback for sticker placement (server rate limit notification) */
  setOnStickerPlace(cb: () => void): void {
    this.onStickerPlace = cb;
  }

  /** D28: Show rate limit notice */
  showRateLimitNotice(): void {
    this.rateLimited = true;
    this.rateLimitNotice.style.display = "block";
    setTimeout(() => {
      this.rateLimited = false;
      this.rateLimitNotice.style.display = "none";
    }, 5000);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.inputPanel.style.display = enabled ? "block" : "none";
    if (enabled) {
      this.container.addEventListener("click", this.clickHandler);
      this.container.style.cursor = "crosshair";
    } else {
      this.container.removeEventListener("click", this.clickHandler);
      this.container.style.cursor = "";
    }
  }

  /** D24: Get/set author display preference */
  getShowAuthor(): boolean {
    return this.showAuthor;
  }

  setShowAuthor(show: boolean): void {
    this.showAuthor = show;
    localStorage.setItem(LS_KEY_SHOW_AUTHOR, String(show));
  }

  renderSticker(sticker: TextStickerEntry): void {
    const existing = this.stickerMeshes.get(sticker.id);
    if (existing) {
      this.scene.remove(existing);
      disposeStickerMesh(existing);
    }

    const mesh = createStickerMesh(sticker);
    this.scene.add(mesh);
    this.stickerMeshes.set(sticker.id, mesh);
  }

  removeSticker(id: string): void {
    const mesh = this.stickerMeshes.get(id);
    if (!mesh) return;
    this.scene.remove(mesh);
    disposeStickerMesh(mesh);
    this.stickerMeshes.delete(id);
  }

  restoreStickers(): void {
    const stickers = this.roomState.textStickers.valuesByTime();
    for (const sticker of stickers) {
      this.renderSticker(sticker);
    }
  }

  dispose(): void {
    this.setEnabled(false);
    this.inputPanel.remove();
    this.rateLimitNotice.remove();
    for (const [, mesh] of this.stickerMeshes) {
      this.scene.remove(mesh);
      disposeStickerMesh(mesh);
    }
    this.stickerMeshes.clear();
  }

  // --- Private ---

  private onCanvasClick(e: MouseEvent): void {
    if (!this.enabled) return;
    // D28: Block if rate limited
    if (this.rateLimited) return;
    // Ignore clicks on UI elements
    if (
      (e.target as HTMLElement).closest(
        "#chat-panel, #status-bar, #peer-list, #sticker-input-panel, #settings-panel, #sticker-rate-limit-notice",
      )
    )
      return;

    const text = this.inputEl.value.trim();
    if (!text) return;

    // Raycast against walls
    const rect = this.container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.roomWalls.children, false);
    if (hits.length === 0) return; // No wall hit — ignore

    const hit = hits[0];
    const normal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
      : new THREE.Vector3(0, 0, 1);

    // Offset from wall surface to prevent Z-fighting
    const position = hit.point.clone().add(normal.clone().multiplyScalar(STICKER_OFFSET));

    const entry: TextStickerEntry = {
      id: uuidv4(),
      author_peer_id: this.myPeerId,
      author_name: this.myPeerName,
      color: this.myColor,
      text: text.slice(0, MAX_STICKER_TEXT),
      font_size: this.fontSize, // D30
      position: { x: position.x, y: position.y, z: position.z },
      normal: { x: normal.x, y: normal.y, z: normal.z },
      show_author: this.showAuthor,
      timestamp: Date.now(),
    };

    this.roomState.addTextSticker(entry);
    this.renderSticker(entry);

    // D27: Clear input after placement to prevent spam
    this.inputEl.value = "";

    // D28: Notify server for rate limiting
    this.onStickerPlace?.();
  }
}

// --- Sticker mesh creation ---

function createStickerMesh(sticker: TextStickerEntry): THREE.Mesh {
  const canvas = renderStickerCanvas(sticker);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });

  const w = canvas.width * STICKER_MESH_SCALE;
  const h = canvas.height * STICKER_MESH_SCALE;
  const geometry = new THREE.PlaneGeometry(w, h);
  const mesh = new THREE.Mesh(geometry, material);

  // Position
  mesh.position.set(sticker.position.x, sticker.position.y, sticker.position.z);

  // Orient to face away from wall (align with normal)
  const normal = new THREE.Vector3(sticker.normal.x, sticker.normal.y, sticker.normal.z);
  const target = mesh.position.clone().add(normal);
  mesh.lookAt(target);

  return mesh;
}

function renderStickerCanvas(sticker: TextStickerEntry): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  // D30: Use per-sticker font size with fallback to default
  const fontSize = sticker.font_size ?? STICKER_FONT_SIZE_DEFAULT;
  const authorFontSize = Math.round(fontSize * 0.6);
  const lineHeight = fontSize + 4;

  // Measure text to determine canvas size
  ctx.font = `${fontSize}px sans-serif`;
  const lines = wrapText(sticker.text, MAX_CHARS_PER_LINE);

  const hasAuthor = sticker.show_author && sticker.author_name;
  const authorHeight = hasAuthor ? authorFontSize + 6 : 0;
  const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width), 80);
  const canvasW = Math.ceil(textWidth + CANVAS_PADDING * 2);
  const canvasH = Math.ceil(authorHeight + lines.length * lineHeight + CANVAS_PADDING * 2);

  canvas.width = canvasW;
  canvas.height = canvasH;

  // D26: No background, no border — transparent canvas

  let y = CANVAS_PADDING;

  // Author name (D24) — with outline for readability
  if (hasAuthor) {
    ctx.font = `${authorFontSize}px sans-serif`;
    ctx.textBaseline = "top";
    ctx.strokeStyle = TEXT_OUTLINE_COLOR;
    ctx.lineWidth = TEXT_OUTLINE_WIDTH;
    ctx.strokeText(sticker.author_name, CANVAS_PADDING, y);
    ctx.fillStyle = "#999";
    ctx.fillText(sticker.author_name, CANVAS_PADDING, y);
    y += authorFontSize + 6;
  }

  // Body text — with outline (D26)
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textBaseline = "top";
  ctx.strokeStyle = TEXT_OUTLINE_COLOR;
  ctx.lineWidth = TEXT_OUTLINE_WIDTH;
  for (const line of lines) {
    ctx.strokeText(line, CANVAS_PADDING, y);
    ctx.fillStyle = sticker.color;
    ctx.fillText(line, CANVAS_PADDING, y);
    y += lineHeight;
  }

  return canvas;
}

function disposeStickerMesh(mesh: THREE.Mesh): void {
  const mat = mesh.material as THREE.MeshBasicMaterial;
  mat.map?.dispose();
  mat.dispose();
  mesh.geometry.dispose();
}

function wrapText(text: string, charsPerLine: number): string[] {
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= charsPerLine) {
      lines.push(remaining);
      break;
    }
    lines.push(remaining.slice(0, charsPerLine));
    remaining = remaining.slice(charsPerLine);
  }
  return lines;
}
