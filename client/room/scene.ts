// Three.js dual-renderer scene setup (D6, FS-2)
// CSS3DRenderer for iframe display + WebGLRenderer for 3D objects (strokes, avatars)
// Uses depth mask technique for correct occlusion between CSS3D and WebGL layers.

import * as THREE from "three";
import { CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

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

  // --- Camera ---
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

  // --- OrbitControls (bound to CSS renderer's DOM for pointer events) ---
  const controls = new OrbitControls(camera, cssRenderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 500;
  controls.maxDistance = 4000;

  // --- Ambient light ---
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));

  // --- Animation loop ---
  let animationId = 0;

  function animate(): void {
    animationId = requestAnimationFrame(animate);
    controls.update();
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
