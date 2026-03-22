// D12 + D13: Hybrid iframe embedding
// Flow:
// 1. D13: Try embed URL rewrite for known services (YouTube etc.) — no server call
// 2. D12: GET /api/proxy/check → direct embed or header-stripping proxy or error

import * as THREE from "three";
import { CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { SLATOG_CONFIG } from "../../shared/config.js";
import { createDepthMask } from "./scene.js";
import { tryEmbedRewrite } from "./embed-url.js";
import type { SceneContext } from "./scene.js";

const IFRAME_WIDTH = 1024;
const IFRAME_HEIGHT = 768;
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
 * Embed a web page in the 3D scene.
 * 1. Try known-service embed URL rewrite (D13) — client-side, no server call
 * 2. Fall back to proxy/check flow (D12)
 */
export async function embedWebPage(
  ctx: SceneContext,
  urlKey: string,
  onError: (msg: string) => void,
): Promise<EmbedResult | null> {
  // --- D13: Try embed URL rewrite first ---
  const embedUrl = tryEmbedRewrite(urlKey);
  if (embedUrl) {
    return createIframeIn3D(ctx, embedUrl);
  }

  // --- D12: Proxy check flow ---
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

  const iframeSrc = checkResult.embeddable ? checkResult.url : checkResult.proxyUrl!;
  return createIframeIn3D(ctx, iframeSrc);
}

function createIframeIn3D(ctx: SceneContext, iframeSrc: string): EmbedResult {
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
  iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
  wrapper.appendChild(iframe);

  const cssObject = new CSS3DObject(wrapper);
  cssObject.position.set(0, 0, 0);
  cssObject.scale.setScalar(CSS_SCALE);
  ctx.cssScene.add(cssObject);

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

export { IFRAME_WIDTH, IFRAME_HEIGHT };
