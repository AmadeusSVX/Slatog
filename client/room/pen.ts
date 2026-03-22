// D3, D15, D17, D21: Pen stroke drawing in 3D space
// D17: Uses Line2 + LineMaterial for screen-space line width control.
// D21: Raycasts against room wall meshes so strokes land on whichever wall the user faces.
//      Display coordinates are clamped as safety net; original coords preserved in RoomState.
// State-based sync: finishStroke() mutates RoomState only; broadcast is handled by main.ts.
// reconcileUI calls renderStroke/removeStroke for incremental scene updates.

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { v4 as uuidv4 } from "uuid";
import type { RoomState } from "../../shared/room-state.js";
import type { StrokeEntry } from "../../shared/data-protocol.js";
import type { SceneContext } from "./scene.js";
import { ROOM_W, ROOM_H, ROOM_BACK_Z, ROOM_FRONT_Z } from "./scene.js";
import { USER_COLORS } from "../../shared/colors.js";

const DEFAULT_LINE_WIDTH = 5; // D17: screen-space pixels

// D21: Z-fighting prevention margin (units inside from wall surface)
const STROKE_CLAMP_OFFSET = 5;

function clampStrokePoint(p: { x: number; y: number; z: number }): {
  x: number;
  y: number;
  z: number;
} {
  const halfW = ROOM_W / 2;
  const halfH = ROOM_H / 2;
  return {
    x: Math.max(-halfW + STROKE_CLAMP_OFFSET, Math.min(halfW - STROKE_CLAMP_OFFSET, p.x)),
    y: Math.max(-halfH + STROKE_CLAMP_OFFSET, Math.min(halfH - STROKE_CLAMP_OFFSET, p.y)),
    z: Math.max(
      ROOM_BACK_Z + STROKE_CLAMP_OFFSET,
      Math.min(ROOM_FRONT_Z - STROKE_CLAMP_OFFSET, p.z),
    ),
  };
}

export class PenManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private roomState: RoomState;
  private myPeerId: string;
  private raycaster = new THREE.Raycaster();
  private roomWalls: THREE.Group;
  private isDrawing = false;
  private currentPoints: THREE.Vector3[] = [];
  private currentLine: Line2 | null = null;
  private strokeLines = new Map<string, Line2>();
  private enabled = false;
  private color: string;
  private resolution = new THREE.Vector2(1, 1);
  private pointerDownHandler: (e: PointerEvent) => void;
  private pointerMoveHandler: (e: PointerEvent) => void;
  private pointerUpHandler: () => void;

  constructor(ctx: SceneContext, roomState: RoomState, myPeerId: string, colorIndex = 0) {
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.roomState = roomState;
    this.myPeerId = myPeerId;
    this.container = ctx.container;
    this.roomWalls = ctx.roomWalls;
    this.color = USER_COLORS[colorIndex % USER_COLORS.length];
    this.resolution.set(ctx.container.clientWidth, ctx.container.clientHeight);

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

  renderStroke(stroke: StrokeEntry): void {
    const existing = this.strokeLines.get(stroke.id);
    if (existing) {
      this.scene.remove(existing);
      existing.geometry.dispose();
      (existing.material as THREE.Material).dispose();
    }

    const lineWidth = stroke.width || DEFAULT_LINE_WIDTH;
    const line = createLine2FromPoints(stroke.points, stroke.color, lineWidth, this.resolution);
    this.scene.add(line);
    this.strokeLines.set(stroke.id, line);
  }

  removeStroke(id: string): void {
    const line = this.strokeLines.get(id);
    if (!line) return;
    this.scene.remove(line);
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
    this.strokeLines.delete(id);
  }

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

  private onPointerDown(e: PointerEvent): void {
    if (!this.enabled || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("#chat-panel, #status-bar, #peer-list")) return;

    this.isDrawing = true;
    this.currentPoints = [];
    const point = this.screenToWorld(e);
    if (point) this.currentPoints.push(point);

    this.currentLine = createLine2FromPoints(
      this.currentPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      this.color,
      DEFAULT_LINE_WIDTH,
      this.resolution,
    );
    this.scene.add(this.currentLine);
    e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDrawing || !this.currentLine) return;
    const point = this.screenToWorld(e);
    if (!point) return;

    this.currentPoints.push(point);
    this.scene.remove(this.currentLine);
    this.currentLine.geometry.dispose();
    (this.currentLine.material as THREE.Material).dispose();
    this.currentLine = createLine2FromPoints(
      this.currentPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      this.color,
      DEFAULT_LINE_WIDTH,
      this.resolution,
    );
    this.scene.add(this.currentLine);
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
      width: DEFAULT_LINE_WIDTH,
      timestamp: Date.now(),
    };

    this.strokeLines.set(id, this.currentLine);
    this.roomState.addStroke(entry);

    this.currentLine = null;
    this.currentPoints = [];
  }

  // D21: Raycast against room wall meshes to find the nearest wall surface hit
  private screenToWorld(e: PointerEvent): THREE.Vector3 | null {
    const rect = this.container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.roomWalls.children, false);
    if (hits.length === 0) return null;
    // Offset the hit point slightly toward the camera (inside the room) to prevent z-fighting
    const hit = hits[0];
    const offset = hit.face
      ? hit.face.normal
          .clone()
          .transformDirection(hit.object.matrixWorld)
          .multiplyScalar(STROKE_CLAMP_OFFSET)
      : new THREE.Vector3();
    return hit.point.clone().add(offset);
  }
}

function createLine2FromPoints(
  points: { x: number; y: number; z: number }[],
  color: string,
  lineWidth: number,
  resolution: THREE.Vector2,
): Line2 {
  const positions: number[] = [];
  for (const p of points) {
    // D21: clamp display coordinates to room bounds as safety net
    const c = clampStrokePoint(p);
    positions.push(c.x, c.y, c.z);
  }

  const geometry = new LineGeometry();
  geometry.setPositions(positions);

  const material = new LineMaterial({
    color: new THREE.Color(color).getHex(),
    linewidth: lineWidth,
    resolution,
  });

  return new Line2(geometry, material);
}
