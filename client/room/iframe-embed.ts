// D12: Hybrid iframe embedding with proxy check flow
// 1. GET /api/proxy/check?url=... to determine embeddability
// 2. embeddable=true  → iframe.src = original URL
// 3. embeddable=false + supported=true → iframe.src = proxy URL
// 4. embeddable=false + supported=false → show error

import * as THREE from "three";
import { CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { SLATOG_CONFIG } from "../../shared/config.js";
import { createDepthMask } from "./scene.js";
import type { SceneContext } from "./scene.js";

// Iframe dimensions in 3D world units
const IFRAME_WIDTH = 1024;
const IFRAME_HEIGHT = 768;
// CSS3DObject scale factor: DOM pixels → world units
const CSS_SCALE = 1;

export interface EmbedResult {
  cssObject: CSS3DObject;
  depthMask: THREE.Mesh;
  iframe: HTMLIFrameElement;
  dispose(): void;
}

interface ProxyCheckResponse {
  embeddable: boolean;
  supported: boolean;
  url: string;
  proxyUrl: string | null;
  error?: string;
}

/**
 * Check URL embeddability via the server and create an iframe in 3D space.
 * Returns null if the URL is not supported (proxy off + not embeddable).
 */
export async function embedWebPage(
  ctx: SceneContext,
  urlKey: string,
  onError: (msg: string) => void,
): Promise<EmbedResult | null> {
  // --- Check embeddability ---
  let checkResult: ProxyCheckResponse;
  try {
    const res = await fetch(
      `${SLATOG_CONFIG.API_BASE}/api/proxy/check?url=${encodeURIComponent(urlKey)}`,
    );
    checkResult = await res.json();
    if (!res.ok) {
      onError(checkResult.error ?? "URL確認に失敗しました");
      return null;
    }
  } catch {
    onError("サーバーとの通信に失敗しました");
    return null;
  }

  if (!checkResult.supported) {
    onError("このURLはiframe埋め込みが許可されていないため、Slatogでは表示できません");
    return null;
  }

  // Determine iframe src
  const iframeSrc = checkResult.embeddable ? checkResult.url : checkResult.proxyUrl!;

  // --- Create iframe DOM element ---
  const wrapper = document.createElement("div");
  wrapper.style.width = `${IFRAME_WIDTH}px`;
  wrapper.style.height = `${IFRAME_HEIGHT}px`;
  wrapper.style.background = "#fff";
  wrapper.style.borderRadius = "4px";
  wrapper.style.overflow = "hidden";
  wrapper.style.boxShadow = "0 0 40px rgba(0,0,0,0.5)";

  const iframe = document.createElement("iframe");
  iframe.src = iframeSrc;
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "none";
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
  wrapper.appendChild(iframe);

  // --- CSS3DObject ---
  const cssObject = new CSS3DObject(wrapper);
  cssObject.position.set(0, 0, 0);
  cssObject.scale.setScalar(CSS_SCALE);
  ctx.cssScene.add(cssObject);

  // --- Depth mask (FS-2) ---
  const maskWidth = IFRAME_WIDTH * CSS_SCALE;
  const maskHeight = IFRAME_HEIGHT * CSS_SCALE;
  const depthMask = createDepthMask(maskWidth, maskHeight, cssObject.position);
  ctx.scene.add(depthMask);

  function dispose(): void {
    ctx.cssScene.remove(cssObject);
    ctx.scene.remove(depthMask);
    depthMask.geometry.dispose();
    (depthMask.material as THREE.Material).dispose();
  }

  return { cssObject, depthMask, iframe, dispose };
}

/** Width/height constants exported for scroll sync and other modules */
export { IFRAME_WIDTH, IFRAME_HEIGHT };
