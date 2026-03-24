// D38/D39/D42: VR controller movement & interaction
//
// D42 revised mapping:
//   Left stick Y: forward/backward translation
//   Left stick X: horizontal strafe
//   Right stick Y: vertical movement (world Y axis)
//   Right stick X: yaw rotation (offset applied to xrRigGroup)
//   Trigger (selectstart/selectend): pen stroke drawing
//
// Controller models displayed via XRControllerModelFactory.

import * as THREE from "three";
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js";
import { v4 as uuidv4 } from "uuid";
import type { SceneContext } from "./scene.js";
import type { RoomState } from "../../shared/room-state.js";
import type { StrokeEntry } from "../../shared/data-protocol.js";

// Movement parameters
const MOVE_SPEED = 200; // units per second
const YAW_SPEED = 1.5; // radians per second
const DEADZONE = 0.15;

// Ray pointer visual
const RAY_LENGTH = 1500;
const RAY_COLOR = 0xffffff;

// Pen stroke defaults (match pen.ts)
const DEFAULT_LINE_WIDTH = 5;

export class VRControlsManager {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private xrRigGroup: THREE.Group;
  private roomState: RoomState;
  private myPeerId: string;
  private penColor: string;

  // Controllers
  private controller0: THREE.Group;
  private controller1: THREE.Group;

  // Pen drawing state
  private isDrawing = false;
  private drawingController: THREE.Group | null = null;
  private currentPoints: THREE.Vector3[] = [];
  private currentLine: THREE.Line | null = null;

  // Previous frame time for delta-time movement
  private lastTime = 0;

  constructor(ctx: SceneContext, roomState: RoomState, myPeerId: string, penColor: string) {
    this.renderer = ctx.webglRenderer;
    this.scene = ctx.scene;
    this.xrRigGroup = ctx.xrRigGroup;
    this.roomState = roomState;
    this.myPeerId = myPeerId;
    this.penColor = penColor;

    // --- Controller grip models ---
    const controllerModelFactory = new XRControllerModelFactory();

    const controllerGrip0 = this.renderer.xr.getControllerGrip(0);
    controllerGrip0.add(controllerModelFactory.createControllerModel(controllerGrip0));
    this.scene.add(controllerGrip0);

    const controllerGrip1 = this.renderer.xr.getControllerGrip(1);
    controllerGrip1.add(controllerModelFactory.createControllerModel(controllerGrip1));
    this.scene.add(controllerGrip1);

    // --- Controller target ray spaces ---
    this.controller0 = this.renderer.xr.getController(0);
    this.controller1 = this.renderer.xr.getController(1);
    this.scene.add(this.controller0);
    this.scene.add(this.controller1);

    // Ray pointer visuals
    this.controller0.add(createRayLine());
    this.controller1.add(createRayLine());

    // --- Controller events ---
    this.controller0.addEventListener(
      "selectstart",
      this.onSelectStart.bind(this, this.controller0),
    );
    this.controller0.addEventListener("selectend", this.onSelectEnd.bind(this));
    this.controller1.addEventListener(
      "selectstart",
      this.onSelectStart.bind(this, this.controller1),
    );
    this.controller1.addEventListener("selectend", this.onSelectEnd.bind(this));
  }

  /** Call from setAnimationLoop when in VR */
  update(): void {
    const session = this.renderer.xr.getSession();
    if (!session) return;

    const now = performance.now();
    const dt = this.lastTime > 0 ? (now - this.lastTime) / 1000 : 0;
    this.lastTime = now;

    // Read thumbstick inputs
    for (const source of session.inputSources) {
      if (!source.gamepad) continue;
      const axes = source.gamepad.axes;
      // Standard XR gamepad: axes[2] = X, axes[3] = Y

      if (source.handedness === "left") {
        const axisX = axes.length > 2 ? axes[2] : 0;
        const axisY = axes.length > 3 ? axes[3] : 0;
        // D42: Left stick Y = forward/backward, X = strafe
        this.applyForwardMovement(axisY, dt);
        this.applyStrafeMovement(axisX, dt);
      } else if (source.handedness === "right") {
        const axisX = axes.length > 2 ? axes[2] : 0;
        const axisY = axes.length > 3 ? axes[3] : 0;
        // D42: Right stick Y = vertical, X = yaw rotation
        this.applyVerticalMovement(axisY, dt);
        this.applyYawRotation(axisX, dt);
      }
    }

    // If drawing, add current controller position to stroke
    if (this.isDrawing && this.drawingController) {
      const pos = new THREE.Vector3();
      this.drawingController.getWorldPosition(pos);
      this.addStrokePoint(pos);
    }
  }

  /** Reset timestamp when entering VR */
  resetTime(): void {
    this.lastTime = 0;
  }

  dispose(): void {
    this.scene.remove(this.controller0);
    this.scene.remove(this.controller1);
  }

  // --- Movement ---

  private applyForwardMovement(axisY: number, dt: number): void {
    if (Math.abs(axisY) < DEADZONE) return;

    // Forward direction = xrRigGroup yaw + head yaw, projected onto XZ
    const xrCamera = this.renderer.xr.getCamera();
    const forward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(xrCamera.quaternion)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.xrRigGroup.rotation.y)
      .setY(0)
      .normalize();

    // axisY negative = forward (push stick up)
    this.xrRigGroup.position.addScaledVector(forward, -axisY * MOVE_SPEED * dt);
  }

  private applyYawRotation(axisX: number, dt: number): void {
    if (Math.abs(axisX) < DEADZONE) return;
    // Rotate xrRigGroup around Y axis (negative = turn left when stick pushed left)
    this.xrRigGroup.rotation.y -= axisX * YAW_SPEED * dt;
  }

  private applyVerticalMovement(axisY: number, dt: number): void {
    if (Math.abs(axisY) < DEADZONE) return;
    // axisY negative = up (push stick up)
    this.xrRigGroup.position.y -= axisY * MOVE_SPEED * dt;
  }

  private applyStrafeMovement(axisX: number, dt: number): void {
    if (Math.abs(axisX) < DEADZONE) return;

    // Right direction = xrRigGroup yaw + head yaw, projected onto XZ
    const xrCamera = this.renderer.xr.getCamera();
    const forward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(xrCamera.quaternion)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.xrRigGroup.rotation.y)
      .setY(0)
      .normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    this.xrRigGroup.position.addScaledVector(right, axisX * MOVE_SPEED * dt);
  }

  // --- Pen drawing ---

  private onSelectStart(controller: THREE.Group): void {
    this.isDrawing = true;
    this.drawingController = controller;
    this.currentPoints = [];

    const pos = new THREE.Vector3();
    controller.getWorldPosition(pos);
    this.currentPoints.push(pos.clone());

    this.currentLine = createPreviewLine(this.currentPoints, this.penColor);
    this.scene.add(this.currentLine);
  }

  private onSelectEnd(): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.drawingController = null;

    if (this.currentLine) {
      this.scene.remove(this.currentLine);
      this.currentLine.geometry.dispose();
      (this.currentLine.material as THREE.Material).dispose();
      this.currentLine = null;
    }

    if (this.currentPoints.length >= 2) {
      const id = uuidv4();
      const entry: StrokeEntry = {
        id,
        authorPeerId: this.myPeerId,
        points: this.currentPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        color: this.penColor,
        width: DEFAULT_LINE_WIDTH,
        timestamp: Date.now(),
      };
      this.roomState.addStroke(entry);
    }

    this.currentPoints = [];
  }

  private addStrokePoint(pos: THREE.Vector3): void {
    if (this.currentPoints.length > 0) {
      const last = this.currentPoints[this.currentPoints.length - 1];
      if (pos.distanceTo(last) < 2) return;
    }
    this.currentPoints.push(pos.clone());

    if (this.currentLine) {
      this.scene.remove(this.currentLine);
      this.currentLine.geometry.dispose();
      (this.currentLine.material as THREE.Material).dispose();
    }
    this.currentLine = createPreviewLine(this.currentPoints, this.penColor);
    this.scene.add(this.currentLine);
  }
}

// --- Helpers ---

function createRayLine(): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -RAY_LENGTH),
  ]);
  const material = new THREE.LineBasicMaterial({
    color: RAY_COLOR,
    transparent: true,
    opacity: 0.5,
  });
  return new THREE.Line(geometry, material);
}

function createPreviewLine(points: THREE.Vector3[], color: string): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(color),
  });
  return new THREE.Line(geometry, material);
}
