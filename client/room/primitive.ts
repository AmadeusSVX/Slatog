// D31: Primitive placement — place basic 3D shapes (cone, cube, sphere, cylinder) in room
// D32: State sync via RoomState.primitives
// State-based sync: placePrimitive() mutates RoomState only; broadcast is handled by main.ts.
// reconcileUI calls renderPrimitive/removePrimitive for incremental scene updates.

import * as THREE from "three";
import { v4 as uuidv4 } from "uuid";
import type { RoomState } from "../../shared/room-state.js";
import type { PrimitiveEntry } from "../../shared/data-protocol.js";
import type { SceneContext } from "./scene.js";
import { ROOM_W, ROOM_H, ROOM_BACK_Z, ROOM_FRONT_Z } from "./scene.js";

// D31: Placement offset from wall surface (same as sticker/pen)
const PRIMITIVE_WALL_OFFSET = 0.5;

// D29: Maximum placement distance (same as PEN_MAX_DRAW_DISTANCE)
const MAX_PLACE_DISTANCE = 2000;

// D21: Room clamp margin
const CLAMP_OFFSET = 5;

type PrimitiveShape = PrimitiveEntry["shape"];

const SHAPE_LIST: PrimitiveShape[] = ["cone", "cube", "sphere", "cylinder"];
const SHAPE_LABELS: Record<PrimitiveShape, string> = {
  cone: "\u25B3 \u5186\u9310",
  cube: "\u25A1 \u7ACB\u65B9\u4F53",
  sphere: "\u25CB \u7403",
  cylinder: "\u2293 \u5186\u7B52",
};

function clampPosition(p: THREE.Vector3): THREE.Vector3 {
  const halfW = ROOM_W / 2;
  const halfH = ROOM_H / 2;
  return new THREE.Vector3(
    Math.max(-halfW + CLAMP_OFFSET, Math.min(halfW - CLAMP_OFFSET, p.x)),
    Math.max(-halfH + CLAMP_OFFSET, Math.min(halfH - CLAMP_OFFSET, p.y)),
    Math.max(ROOM_BACK_Z + CLAMP_OFFSET, Math.min(ROOM_FRONT_Z - CLAMP_OFFSET, p.z)),
  );
}

function createGeometry(shape: PrimitiveShape): THREE.BufferGeometry {
  switch (shape) {
    case "cone":
      return new THREE.ConeGeometry(0.5, 1.0, 16);
    case "cube":
      return new THREE.BoxGeometry(1.0, 1.0, 1.0);
    case "sphere":
      return new THREE.SphereGeometry(0.5, 16, 12);
    case "cylinder":
      return new THREE.CylinderGeometry(0.5, 0.5, 1.0, 16);
  }
}

// D31: Scale factor — primitives use unit-scale geometry, scaled up for room
const PRIMITIVE_SCALE = 80;

export class PrimitiveManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private roomState: RoomState;
  private myPeerId: string;
  private myColor: string;
  private raycaster = new THREE.Raycaster();
  private roomWalls: THREE.Group;
  private primitiveMeshes = new Map<string, THREE.Mesh>();
  private enabled = false;
  private selectedShape: PrimitiveShape = "cube";

  // UI elements
  private inputPanel: HTMLElement;
  private shapeButtons: Map<PrimitiveShape, HTMLButtonElement> = new Map();
  private clickHandler: (e: MouseEvent) => void;

  constructor(ctx: SceneContext, roomState: RoomState, myPeerId: string, myColor: string) {
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.container = ctx.container;
    this.roomState = roomState;
    this.myPeerId = myPeerId;
    this.myColor = myColor;
    this.roomWalls = ctx.roomWalls;

    // Build selection UI
    this.inputPanel = document.createElement("div");
    this.inputPanel.id = "primitive-input-panel";
    this.inputPanel.style.display = "none";

    for (const shape of SHAPE_LIST) {
      const btn = document.createElement("button");
      btn.className = "primitive-shape-btn";
      btn.textContent = SHAPE_LABELS[shape];
      btn.dataset.shape = shape;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectShape(shape);
      });
      this.inputPanel.appendChild(btn);
      this.shapeButtons.set(shape, btn);
    }

    // Prevent scene interaction when clicking panel
    this.inputPanel.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.inputPanel.addEventListener("wheel", (e) => e.stopPropagation());
    document.querySelector(".room-container")?.appendChild(this.inputPanel);

    // Highlight default selection
    this.selectShape(this.selectedShape);

    this.clickHandler = this.onCanvasClick.bind(this);
  }

  private selectShape(shape: PrimitiveShape): void {
    this.selectedShape = shape;
    for (const [s, btn] of this.shapeButtons) {
      btn.classList.toggle("active", s === shape);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.inputPanel.style.display = enabled ? "flex" : "none";
    if (enabled) {
      this.container.addEventListener("click", this.clickHandler);
      this.container.style.cursor = "crosshair";
    } else {
      this.container.removeEventListener("click", this.clickHandler);
      this.container.style.cursor = "";
    }
  }

  renderPrimitive(entry: PrimitiveEntry): void {
    const existing = this.primitiveMeshes.get(entry.id);
    if (existing) {
      this.scene.remove(existing);
      disposePrimitiveMesh(existing);
    }

    const mesh = createPrimitiveMesh(entry);
    this.scene.add(mesh);
    this.primitiveMeshes.set(entry.id, mesh);
  }

  removePrimitive(id: string): void {
    const mesh = this.primitiveMeshes.get(id);
    if (!mesh) return;
    this.scene.remove(mesh);
    disposePrimitiveMesh(mesh);
    this.primitiveMeshes.delete(id);
  }

  restorePrimitives(): void {
    const primitives = this.roomState.primitives.valuesByTime();
    for (const p of primitives) {
      this.renderPrimitive(p);
    }
  }

  dispose(): void {
    this.setEnabled(false);
    this.inputPanel.remove();
    for (const [, mesh] of this.primitiveMeshes) {
      this.scene.remove(mesh);
      disposePrimitiveMesh(mesh);
    }
    this.primitiveMeshes.clear();
  }

  // --- Private ---

  private onCanvasClick(e: MouseEvent): void {
    if (!this.enabled) return;
    // Ignore clicks on UI elements
    if (
      (e.target as HTMLElement).closest(
        "#chat-panel, #status-bar, #peer-list, #sticker-input-panel, #settings-panel, #primitive-input-panel, #sticker-rate-limit-notice",
      )
    )
      return;

    // Raycast against walls
    const rect = this.container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.near = this.camera.near;
    this.raycaster.far = MAX_PLACE_DISTANCE;

    const hits = this.raycaster.intersectObjects(this.roomWalls.children, false);

    let position: THREE.Vector3;
    if (hits.length > 0) {
      // Wall hit — offset from wall surface by PRIMITIVE_WALL_OFFSET units along normal
      const hit = hits[0];
      const normal = hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
        : new THREE.Vector3(0, 0, 1);
      position = hit.point.clone().add(normal.multiplyScalar(PRIMITIVE_WALL_OFFSET));
    } else {
      // No wall hit — place at MAX_PLACE_DISTANCE along ray
      position = this.raycaster.ray.origin
        .clone()
        .add(this.raycaster.ray.direction.clone().multiplyScalar(MAX_PLACE_DISTANCE));
    }

    // Clamp to room bounds
    position = clampPosition(position);

    const entry: PrimitiveEntry = {
      id: uuidv4(),
      author_peer_id: this.myPeerId,
      color: this.myColor,
      shape: this.selectedShape,
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { x: 0, y: 0, z: 0 },
      timestamp: Date.now(),
    };

    this.roomState.addPrimitive(entry);
    this.renderPrimitive(entry);
  }
}

// --- Mesh creation ---

function createPrimitiveMesh(entry: PrimitiveEntry): THREE.Mesh {
  const geometry = createGeometry(entry.shape);
  const material = new THREE.MeshStandardMaterial({
    color: entry.color,
    roughness: 0.6,
    metalness: 0.1,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(entry.position.x, entry.position.y, entry.position.z);
  mesh.rotation.set(entry.rotation.x, entry.rotation.y, entry.rotation.z);
  mesh.scale.setScalar(PRIMITIVE_SCALE);

  return mesh;
}

function disposePrimitiveMesh(mesh: THREE.Mesh): void {
  (mesh.material as THREE.Material).dispose();
  mesh.geometry.dispose();
}
