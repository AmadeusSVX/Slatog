// Three.js dual-renderer scene setup (D6, FS-2, D16)
// CSS3DRenderer for iframe display + WebGLRenderer for 3D objects (strokes, avatars)
// Uses depth mask technique for correct occlusion between CSS3D and WebGL layers.
//
// D16: Room geometry added around existing coordinate system.
// Existing coords are UNCHANGED: camera z=1500, iframe z=0, avatars z=600.
// Room wraps around this space: back wall z=0, front wall z=1600.

import * as THREE from "three";
import { CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// D16: Room dimensions in CSS-pixel units (matching existing coordinate system)
// Back wall at z=0 (where iframe lives), extends toward camera (+z).
const ROOM_W = 3000; // X: -1500 to +1500
const ROOM_H = 1500; // Y: -750 to +750
const ROOM_D = 2400; // Z: 0 to +2400

// Camera/target clamp: 50-unit margin from each wall
const CLAMP_X = [-1450, 1450] as const;
const CLAMP_Y = [-700, 700] as const;
const CLAMP_Z = [50, 2350] as const;

export interface SceneContext {
  scene: THREE.Scene;
  cssScene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  webglRenderer: THREE.WebGLRenderer;
  cssRenderer: CSS3DRenderer;
  controls: OrbitControls;
  container: HTMLElement;
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

  // --- Camera (unchanged) ---
  const camera = new THREE.PerspectiveCamera(50, width / height, 1, 5000);
  camera.position.set(0, 0, 1500);

  // --- CSS3DRenderer (lower layer) ---
  const cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(width, height);
  cssRenderer.domElement.style.position = "absolute";
  cssRenderer.domElement.style.top = "0";
  cssRenderer.domElement.style.left = "0";
  cssRenderer.domElement.style.zIndex = "0";
  container.appendChild(cssRenderer.domElement);

  // --- WebGLRenderer (upper layer, transparent) ---
  const webglRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  webglRenderer.setPixelRatio(window.devicePixelRatio);
  webglRenderer.setSize(width, height);
  webglRenderer.domElement.style.position = "absolute";
  webglRenderer.domElement.style.top = "0";
  webglRenderer.domElement.style.left = "0";
  webglRenderer.domElement.style.zIndex = "1";
  webglRenderer.domElement.style.pointerEvents = "none";
  container.appendChild(webglRenderer.domElement);

  // --- OrbitControls (unchanged binding) ---
  const controls = new OrbitControls(camera, cssRenderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 500;
  controls.maxDistance = 4000;

  // --- D16: Lighting ---
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.3);
  dirLight.position.set(500, 800, 1000);
  scene.add(dirLight);

  // --- D16: Room geometry ---
  buildRoom(scene);

  // --- Animation loop ---
  let animationId = 0;

  function animate(): void {
    animationId = requestAnimationFrame(animate);

    // D16: Clamp controls target and camera to room bounds
    clampVec3(controls.target);
    controls.update();
    clampVec3(camera.position);

    webglRenderer.render(scene, camera);
    cssRenderer.render(cssScene, camera);
  }
  animate();

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
    cancelAnimationFrame(animationId);
    window.removeEventListener("resize", onResize);
    controls.dispose();
    webglRenderer.dispose();
    container.removeChild(webglRenderer.domElement);
    container.removeChild(cssRenderer.domElement);
  }

  return { scene, cssScene, camera, webglRenderer, cssRenderer, controls, container, dispose };
}

// -----------------------------------------------------------------------
// D16: Room construction — 5 planes (back wall omitted for CSS3D iframe)
// -----------------------------------------------------------------------

function buildRoom(scene: THREE.Scene): void {
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
  // Room starts at z=-10 (behind iframe depth mask at z=0) to avoid z-fighting.
  const backZ = -10;
  const frontZ = backZ + ROOM_D;
  const midZ = (backZ + frontZ) / 2;

  // Floor (y = -halfH, normal +Y)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -halfH, midZ);
  scene.add(floor);

  // Ceiling (y = +halfH, normal -Y)
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), wallMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, halfH, midZ);
  scene.add(ceiling);

  // Left wall (x = -halfW, normal +X)
  const left = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(-halfW, 0, midZ);
  scene.add(left);

  // Right wall (x = +halfW, normal -X)
  const right = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, ROOM_H), wallMat);
  right.rotation.y = -Math.PI / 2;
  right.position.set(halfW, 0, midZ);
  scene.add(right);

  // Front wall (z = frontZ, normal -Z)
  const front = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), wallMat);
  front.rotation.y = Math.PI;
  front.position.set(0, 0, frontZ);
  scene.add(front);

  // Back wall (z = backZ, normal +Z)
  const back = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), wallMat);
  back.position.set(0, 0, backZ);
  scene.add(back);
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
