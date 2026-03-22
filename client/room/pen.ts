// D3: Pen stroke drawing in 3D space
// State-based sync: finishStroke() mutates RoomState only; broadcast is handled by main.ts.
// reconcileUI calls renderStroke/removeStroke for incremental scene updates.

import * as THREE from "three";
import { v4 as uuidv4 } from "uuid";
import type { RoomState } from "../../shared/room-state.js";
import type { StrokeEntry } from "../../shared/data-protocol.js";
import type { SceneContext } from "./scene.js";

const DEFAULT_COLOR = "#ff4444";
const DRAW_PLANE_Z = 10; // slightly in front of iframe (z=0)

export class PenManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private roomState: RoomState;
  private myPeerId: string;
  private container: HTMLElement;
  private raycaster = new THREE.Raycaster();
  private drawPlane: THREE.Plane;
  private isDrawing = false;
  private currentPoints: THREE.Vector3[] = [];
  private currentLine: THREE.Line | null = null;
  private strokeLines = new Map<string, THREE.Line>();
  private enabled = false;
  private color = DEFAULT_COLOR;
  private pointerDownHandler: (e: PointerEvent) => void;
  private pointerMoveHandler: (e: PointerEvent) => void;
  private pointerUpHandler: () => void;

  constructor(ctx: SceneContext, roomState: RoomState, myPeerId: string) {
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.roomState = roomState;
    this.myPeerId = myPeerId;
    this.container = ctx.container;
    this.drawPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -DRAW_PLANE_Z);

    this.pointerDownHandler = this.onPointerDown.bind(this);
    this.pointerMoveHandler = this.onPointerMove.bind(this);
    this.pointerUpHandler = this.onPointerUp.bind(this);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.container.addEventListener("pointerdown", this.pointerDownHandler);
      this.container.addEventListener("pointermove", this.pointerMoveHandler);
      this.container.addEventListener("pointerup", this.pointerUpHandler);
      this.container.style.cursor = "crosshair";
    } else {
      this.container.removeEventListener("pointerdown", this.pointerDownHandler);
      this.container.removeEventListener("pointermove", this.pointerMoveHandler);
      this.container.removeEventListener("pointerup", this.pointerUpHandler);
      this.container.style.cursor = "";
      this.finishStroke();
    }
  }

  setColor(color: string): void {
    this.color = color;
  }

  /** Render a stroke in the 3D scene (called from reconcileUI for remote strokes) */
  renderStroke(stroke: StrokeEntry): void {
    const existing = this.strokeLines.get(stroke.id);
    if (existing) {
      this.scene.remove(existing);
      existing.geometry.dispose();
      (existing.material as THREE.Material).dispose();
    }

    const material = new THREE.LineBasicMaterial({ color: stroke.color });
    const positions = new Float32Array(stroke.points.length * 3);
    for (let i = 0; i < stroke.points.length; i++) {
      positions[i * 3] = stroke.points[i].x;
      positions[i * 3 + 1] = stroke.points[i].y;
      positions[i * 3 + 2] = stroke.points[i].z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    this.strokeLines.set(stroke.id, line);
  }

  /** Remove a stroke from the 3D scene (called when enforceBudget removes it) */
  removeStroke(id: string): void {
    const line = this.strokeLines.get(id);
    if (!line) return;
    this.scene.remove(line);
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
    this.strokeLines.delete(id);
  }

  /** Re-render all strokes from RoomState (for late joiner snapshot apply) */
  restoreStrokes(): void {
    const strokes = this.roomState.strokes.valuesByTime();
    for (const stroke of strokes) {
      this.renderStroke(stroke);
    }
  }

  dispose(): void {
    this.setEnabled(false);
    for (const [, line] of this.strokeLines) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.strokeLines.clear();
  }

  // --- Private ---

  private onPointerDown(e: PointerEvent): void {
    if (!this.enabled || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("#chat-panel, #status-bar, #peer-list")) return;

    this.isDrawing = true;
    this.currentPoints = [];
    const point = this.screenToWorld(e);
    if (point) this.currentPoints.push(point);

    const material = new THREE.LineBasicMaterial({ color: this.color });
    const geometry = new THREE.BufferGeometry();
    this.currentLine = new THREE.Line(geometry, material);
    this.scene.add(this.currentLine);
    e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDrawing || !this.currentLine) return;
    const point = this.screenToWorld(e);
    if (!point) return;

    this.currentPoints.push(point);
    const positions = new Float32Array(this.currentPoints.length * 3);
    for (let i = 0; i < this.currentPoints.length; i++) {
      positions[i * 3] = this.currentPoints[i].x;
      positions[i * 3 + 1] = this.currentPoints[i].y;
      positions[i * 3 + 2] = this.currentPoints[i].z;
    }
    this.currentLine.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  }

  private onPointerUp(): void {
    if (!this.isDrawing) return;
    this.finishStroke();
  }

  private finishStroke(): void {
    this.isDrawing = false;
    if (!this.currentLine || this.currentPoints.length < 2) {
      if (this.currentLine) {
        this.scene.remove(this.currentLine);
        this.currentLine.geometry.dispose();
        (this.currentLine.material as THREE.Material).dispose();
      }
      this.currentLine = null;
      this.currentPoints = [];
      return;
    }

    const id = uuidv4();
    const entry: StrokeEntry = {
      id,
      authorPeerId: this.myPeerId,
      points: this.currentPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      color: this.color,
      width: 3,
      timestamp: Date.now(),
    };

    // Keep the current THREE.Line as the rendered stroke
    this.strokeLines.set(id, this.currentLine);

    // Mutate RoomState — onChange callback will trigger broadcast
    this.roomState.addStroke(entry);

    this.currentLine = null;
    this.currentPoints = [];
  }

  private screenToWorld(e: PointerEvent): THREE.Vector3 | null {
    const rect = this.container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const target = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.drawPlane, target);
  }
}
