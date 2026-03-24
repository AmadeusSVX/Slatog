// Three.js dual-renderer scene setup (D6, FS-2, D16, D34, D36)
// CSS3DRenderer for iframe display + WebGLRenderer for 3D objects (strokes, avatars)
// Uses depth mask technique for correct occlusion between CSS3D and WebGL layers.
//
// D16: Room geometry added around existing coordinate system.
// Existing coords are UNCHANGED: camera z=1500, iframe z=0, avatars z=600.
// Room wraps around this space: back wall z=0, front wall z=1600.
//
// D34: Custom FPS-style camera controller (OrbitControls removed).
// Left drag = view rotation, right drag = horizontal translation,
// middle drag = screen-plane translation, wheel = forward/back translation,
// 1-finger = rotation, 2-finger = translation + pinch zoom.
//
// D36: WebXR VR session support via Three.js WebXRManager.
// VRButton shows when immersive-vr is supported. setAnimationLoop replaces rAF.

import * as THREE from "three";
import { CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";

// D16: Room dimensions in CSS-pixel units (matching existing coordinate system)
// Back wall at z=0 (where iframe lives), extends toward camera (+z).
export const ROOM_W = 3000; // X: -1500 to +1500
export const ROOM_H = 1500; // Y: -750 to +750
export const ROOM_D = 3600; // Z: 0 to +3600 (D34: extended rear space)
export const ROOM_BACK_Z = -10; // behind iframe depth mask at z=0
export const ROOM_FRONT_Z = ROOM_BACK_Z + ROOM_D;

// Camera/target clamp: 50-unit margin from each wall
const CLAMP_X = [-1450, 1450] as const;
const CLAMP_Y = [-700, 700] as const;
const CLAMP_Z = [50, 3550] as const;

export interface CameraControls {
  enabled: boolean;
}

export interface SceneContext {
  scene: THREE.Scene;
  cssScene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  webglRenderer: THREE.WebGLRenderer;
  cssRenderer: CSS3DRenderer;
  controls: CameraControls;
  container: HTMLElement;
  roomWalls: THREE.Group; // D21: raycast targets for pen drawing on any wall
  xrRigGroup: THREE.Group; // D36: parent group for VR camera — move this to move the user
  isInVR(): boolean; // D36: true when an XR session is active
  setOnVRFrame(cb: (() => void) | null): void; // D41: register callback invoked each XR frame
  dispose(): void;
}

/**
 * Create the dual-renderer 3D scene.
 * CSS3DRenderer sits underneath, WebGLRenderer overlays with transparent background.
 * Both share the same camera so objects are spatially aligned.
 */
export function createScene(container: HTMLElement): SceneContext {
  const width = container.clientWidth;
  const height = container.clientHeight;

  // --- Scenes ---
  const scene = new THREE.Scene();
  const cssScene = new THREE.Scene();

  // --- Camera (D34: start at room rear for better overview on mobile) ---
  const camera = new THREE.PerspectiveCamera(50, width / height, 1, 5000);
  camera.position.set(0, 0, 3500);

  // --- CSS3DRenderer (lower layer) ---
  const cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(width, height);
  cssRenderer.domElement.style.position = "absolute";
  cssRenderer.domElement.style.top = "0";
  cssRenderer.domElement.style.left = "0";
  cssRenderer.domElement.style.zIndex = "0";
  container.appendChild(cssRenderer.domElement);

  // --- WebGLRenderer (upper layer, transparent) ---
  const webglRenderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
  });
  webglRenderer.setPixelRatio(window.devicePixelRatio);
  webglRenderer.setSize(width, height);
  webglRenderer.domElement.style.position = "absolute";
  webglRenderer.domElement.style.top = "0";
  webglRenderer.domElement.style.left = "0";
  webglRenderer.domElement.style.zIndex = "1";
  webglRenderer.domElement.style.pointerEvents = "none";
  container.appendChild(webglRenderer.domElement);

  // --- D36: WebXR VR support ---
  webglRenderer.xr.enabled = true;

  // XR Rig Group: parent of the camera. Move this group to move the user in VR.
  const xrRigGroup = new THREE.Group();
  xrRigGroup.add(camera);
  scene.add(xrRigGroup);

  // Add VR button if immersive-vr is supported
  if (navigator.xr) {
    navigator.xr.isSessionSupported("immersive-vr").then((supported) => {
      if (supported) {
        const vrButton = VRButton.createButton(webglRenderer);
        document.body.appendChild(vrButton);
      }
    });
  }

  // Track VR session state + D41: VR frame callback
  let inVR = false;
  let onVRFrame: (() => void) | null = null;

  webglRenderer.xr.addEventListener("sessionstart", () => {
    inVR = true;
    controls.enabled = false;
    // D40: Transfer desktop camera position to xrRigGroup so user doesn't teleport to origin
    xrRigGroup.position.copy(camera.position);
    // Reset camera local position since xrRigGroup now holds the offset
    camera.position.set(0, 0, 0);
    // Hide 2D UI overlays in VR mode
    const uiEls = container.querySelectorAll<HTMLElement>(
      "#status-bar, #peer-list, #chat-panel, #sticker-input-panel, #primitive-input-panel, #settings-panel, #sticker-rate-limit-notice, #embed-error, #debug-log",
    );
    for (const el of uiEls) el.style.display = "none";
    // Hide CSS3D layer (iframes don't render in VR)
    cssRenderer.domElement.style.display = "none";
  });
  webglRenderer.xr.addEventListener("sessionend", () => {
    inVR = false;
    controls.enabled = true;
    // D40: Transfer xrRigGroup position back to camera for desktop mode
    camera.position.copy(xrRigGroup.position);
    xrRigGroup.position.set(0, 0, 0);
    xrRigGroup.rotation.set(0, 0, 0);
    // Restore CSS3D layer
    cssRenderer.domElement.style.display = "";
    // Restore status bar (always visible)
    const statusBar = container.querySelector<HTMLElement>("#status-bar");
    if (statusBar) statusBar.style.display = "";
  });

  // =======================================================================
  // D34: Custom FPS-style camera controller
  // =======================================================================

  const controls: CameraControls = { enabled: true };

  // Camera rotation state (Euler YXZ order)
  let yaw = 0; // Y-axis rotation (horizontal)
  let pitch = 0; // X-axis rotation (vertical)
  const PITCH_LIMIT = Math.PI / 2 - 0.01;
  const ROTATE_SPEED = 0.003;
  const MOVE_SPEED = 1.5;
  const WHEEL_SPEED = 0.5;

  function updateCameraRotation(): void {
    camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
  }

  // --- Mouse ---
  const domEl = cssRenderer.domElement;
  let dragButton = -1;
  let prevMX = 0;
  let prevMY = 0;

  function onMouseDown(e: MouseEvent): void {
    if (!controls.enabled) return;
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      dragButton = e.button;
      prevMX = e.clientX;
      prevMY = e.clientY;
    }
  }

  function onMouseMove(e: MouseEvent): void {
    if (!controls.enabled || dragButton < 0) return;
    const dx = e.clientX - prevMX;
    const dy = e.clientY - prevMY;
    prevMX = e.clientX;
    prevMY = e.clientY;

    if (dragButton === 0) {
      // Left button: view rotation (look around in place)
      yaw -= dx * ROTATE_SPEED;
      pitch -= dy * ROTATE_SPEED;
      pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
      updateCameraRotation();
    } else if (dragButton === 2) {
      // Right button: horizontal plane translation (XZ based on camera yaw)
      const fwd = new THREE.Vector3(0, 0, -1);
      fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const rt = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      camera.position.addScaledVector(rt, -dx * MOVE_SPEED);
      camera.position.addScaledVector(fwd, dy * MOVE_SPEED);
    } else if (dragButton === 1) {
      // Middle button: screen-plane translation (perpendicular to view)
      const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(rt, -dx * MOVE_SPEED);
      camera.position.addScaledVector(up, dy * MOVE_SPEED);
    }
  }

  function onMouseUp(): void {
    dragButton = -1;
  }

  // Wheel: forward/backward translation along view direction
  function onWheel(e: WheelEvent): void {
    if (!controls.enabled) return;
    e.preventDefault();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    camera.position.addScaledVector(fwd, -e.deltaY * WHEEL_SPEED);
  }

  function onContextMenu(e: Event): void {
    e.preventDefault();
  }

  // --- Touch ---
  let touchCount = 0;
  let prevTX = 0;
  let prevTY = 0;
  let pinchDist = 0;

  function touchCenter(ts: TouchList): [number, number] {
    let x = 0;
    let y = 0;
    for (let i = 0; i < ts.length; i++) {
      x += ts[i].clientX;
      y += ts[i].clientY;
    }
    return [x / ts.length, y / ts.length];
  }

  function touchDistance(ts: TouchList): number {
    if (ts.length < 2) return 0;
    const dx = ts[0].clientX - ts[1].clientX;
    const dy = ts[0].clientY - ts[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function onTouchStart(e: TouchEvent): void {
    if (!controls.enabled) return;
    touchCount = e.touches.length;
    const [cx, cy] = touchCenter(e.touches);
    prevTX = cx;
    prevTY = cy;
    if (touchCount >= 2) {
      pinchDist = touchDistance(e.touches);
    }
  }

  function onTouchMove(e: TouchEvent): void {
    if (!controls.enabled) return;
    e.preventDefault();
    const [cx, cy] = touchCenter(e.touches);
    const dx = cx - prevTX;
    const dy = cy - prevTY;
    prevTX = cx;
    prevTY = cy;

    if (e.touches.length === 1) {
      // 1-finger: view rotation
      yaw -= dx * ROTATE_SPEED;
      pitch -= dy * ROTATE_SPEED;
      pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
      updateCameraRotation();
    } else if (e.touches.length >= 2) {
      // 2-finger drag: horizontal plane translation (same as right button)
      const fwd = new THREE.Vector3(0, 0, -1);
      fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const rt = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      camera.position.addScaledVector(rt, -dx * MOVE_SPEED);
      camera.position.addScaledVector(fwd, dy * MOVE_SPEED);

      // Pinch: forward/backward translation along view direction
      const newDist = touchDistance(e.touches);
      if (pinchDist > 0 && newDist > 0) {
        const delta = newDist - pinchDist;
        const viewFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        camera.position.addScaledVector(viewFwd, delta * MOVE_SPEED);
      }
      pinchDist = newDist;
    }
  }

  function onTouchEnd(e: TouchEvent): void {
    touchCount = e.touches.length;
    if (touchCount === 0) {
      pinchDist = 0;
    }
  }

  domEl.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
  domEl.addEventListener("wheel", onWheel, { passive: false });
  domEl.addEventListener("contextmenu", onContextMenu);
  domEl.addEventListener("touchstart", onTouchStart, { passive: true });
  domEl.addEventListener("touchmove", onTouchMove, { passive: false });
  domEl.addEventListener("touchend", onTouchEnd);

  // --- D16: Lighting ---
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(500, 800, 1000);
  scene.add(dirLight);

  // --- D16: Room geometry ---
  const roomWalls = buildRoom(scene);

  // --- Animation loop (D36: setAnimationLoop for WebXR compatibility) ---
  webglRenderer.setAnimationLoop(() => {
    // D41: Process VR controller input inside the XR frame callback
    if (inVR && onVRFrame) {
      onVRFrame();
    }

    // D16: Clamp camera to room bounds (skip in VR — XRRigGroup handles position)
    if (!inVR) {
      clampVec3(camera.position);
    }

    webglRenderer.render(scene, camera);
    // CSS3DRenderer is not XR-aware; only render when not in VR
    if (!inVR) {
      cssRenderer.render(cssScene, camera);
    }
  });

  // --- Resize handling ---
  function onResize(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    webglRenderer.setSize(w, h);
    cssRenderer.setSize(w, h);
  }
  window.addEventListener("resize", onResize);

  function dispose(): void {
    webglRenderer.setAnimationLoop(null);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    domEl.removeEventListener("mousedown", onMouseDown);
    domEl.removeEventListener("wheel", onWheel);
    domEl.removeEventListener("contextmenu", onContextMenu);
    domEl.removeEventListener("touchstart", onTouchStart);
    domEl.removeEventListener("touchmove", onTouchMove);
    domEl.removeEventListener("touchend", onTouchEnd);
    webglRenderer.dispose();
    container.removeChild(webglRenderer.domElement);
    container.removeChild(cssRenderer.domElement);
  }

  return {
    scene,
    cssScene,
    camera,
    webglRenderer,
    cssRenderer,
    controls,
    container,
    roomWalls,
    xrRigGroup,
    isInVR: () => inVR,
    setOnVRFrame: (cb: (() => void) | null) => {
      onVRFrame = cb;
    },
    dispose,
  };
}

// -----------------------------------------------------------------------
// D16: Room construction — 5 planes (back wall omitted for CSS3D iframe)
// -----------------------------------------------------------------------

function buildRoom(scene: THREE.Scene): THREE.Group {
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xf0ede8,
    roughness: 0.85,
    metalness: 0.0,
  });
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xe0ddd8,
    roughness: 0.85,
    metalness: 0.0,
  });

  const halfW = ROOM_W / 2;
  const halfH = ROOM_H / 2;
  const midZ = (ROOM_BACK_Z + ROOM_FRONT_Z) / 2;

  const group = new THREE.Group();

  // Floor (y = -halfH, normal +Y)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -halfH, midZ);
  group.add(floor);

  // Ceiling (y = +halfH, normal -Y)
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), wallMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, halfH, midZ);
  group.add(ceiling);

  // Left wall (x = -halfW, normal +X)
  const left = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(-halfW, 0, midZ);
  group.add(left);

  // Right wall (x = +halfW, normal -X)
  const right = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), wallMat);
  right.rotation.y = -Math.PI / 2;
  right.position.set(halfW, 0, midZ);
  group.add(right);

  // Front wall (z = ROOM_FRONT_Z, normal -Z)
  const front = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), wallMat);
  front.rotation.y = Math.PI;
  front.position.set(0, 0, ROOM_FRONT_Z);
  group.add(front);

  // Back wall (z = ROOM_BACK_Z, normal +Z)
  const back = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), wallMat);
  back.position.set(0, 0, ROOM_BACK_Z);
  group.add(back);

  scene.add(group);
  return group;
}

// -----------------------------------------------------------------------
// D16: Camera clamp
// -----------------------------------------------------------------------

function clampVec3(v: THREE.Vector3): void {
  v.x = Math.max(CLAMP_X[0], Math.min(CLAMP_X[1], v.x));
  v.y = Math.max(CLAMP_Y[0], Math.min(CLAMP_Y[1], v.y));
  v.z = Math.max(CLAMP_Z[0], Math.min(CLAMP_Z[1], v.z));
}

/**
 * Create a depth mask plane for an iframe CSS3DObject.
 * This invisible plane writes to the depth buffer so WebGL objects
 * behind the iframe are correctly occluded, while objects in front remain visible.
 * (FS-2 depth mask technique: colorWrite=false, depthWrite=true, renderOrder=-1)
 */
export function createDepthMask(
  width: number,
  height: number,
  position: THREE.Vector3,
): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  const mask = new THREE.Mesh(geometry, material);
  mask.position.copy(position);
  mask.renderOrder = -1;
  return mask;
}
