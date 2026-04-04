// D12 + D13: Hybrid iframe embedding
// D43: VR mode — iframe contentDocument clone + HTMLMesh for WebXR display
// Flow:
// 1. D13: Try embed URL rewrite for known services (YouTube etc.) — no server call
// 2. D12: GET /api/proxy/check → direct embed or header-stripping proxy or error

import * as THREE from "three";
import { CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { HTMLMesh } from "three/examples/jsm/interactive/HTMLMesh.js";
import { SLATOG_CONFIG } from "../../shared/config.js";
import { createDepthMask } from "./scene.js";
import { tryEmbedRewrite } from "./embed-url.js";
import type { SceneContext } from "./scene.js";

const IFRAME_WIDTH = 1024;
const IFRAME_HEIGHT = 768;
const CSS_SCALE = 1.5;

// D43: Mirror refresh interval for VR mode DOM re-cloning
const MIRROR_REFRESH_INTERVAL = 3000;

// D43: HTMLMesh creates geometry at pixel * 0.001. To match CSS-pixel coordinate system
// (CSS3DObject effective size = IFRAME_WIDTH * CSS_SCALE), compensate: CSS_SCALE / 0.001
const VR_MESH_SCALE = CSS_SCALE / 0.001; // 1500

export interface VRMeshHandle {
  mesh: HTMLMesh;
  mirror: HTMLDivElement;
  mirrorInterval: number | undefined;
  dispose(): void;
}

export interface EmbedResult {
  cssObject: CSS3DObject;
  depthMask: THREE.Mesh;
  iframe: HTMLIFrameElement;
  /** Hidden same-origin proxy iframe for VR contentDocument access (cross-origin fallback) */
  proxyIframe: HTMLIFrameElement | null;
  url: string;
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
    return createIframeIn3D(ctx, embedUrl, urlKey);
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
  return createIframeIn3D(ctx, iframeSrc, urlKey);
}

function createIframeIn3D(ctx: SceneContext, iframeSrc: string, originalUrl: string): EmbedResult {
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

  // D43: If cross-origin, preload a hidden same-origin proxy iframe for VR contentDocument
  let proxyIframe: HTMLIFrameElement | null = null;
  try {
    const iframeOrigin = new URL(iframeSrc, window.location.href).origin;
    if (iframeOrigin !== window.location.origin) {
      proxyIframe = document.createElement("iframe");
      proxyIframe.src = `${SLATOG_CONFIG.API_BASE}/api/proxy?url=${encodeURIComponent(iframeSrc)}`;
      proxyIframe.style.position = "absolute";
      proxyIframe.style.left = "-9999px";
      proxyIframe.style.width = `${IFRAME_WIDTH}px`;
      proxyIframe.style.height = `${IFRAME_HEIGHT}px`;
      proxyIframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
      document.body.appendChild(proxyIframe);
    }
  } catch {
    // URL parse error — skip proxy iframe
  }

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
    if (proxyIframe?.parentNode) proxyIframe.parentNode.removeChild(proxyIframe);
  }

  return { cssObject, depthMask, iframe, proxyIframe, url: originalUrl, dispose };
}

// -----------------------------------------------------------------------
// D43: VR mode — HTMLMesh creation from iframe contentDocument clone
// -----------------------------------------------------------------------

/**
 * Create an HTMLMesh for a same-origin iframe by cloning its contentDocument.
 * Returns null if contentDocument is not accessible (cross-origin).
 */
export function createVRIframeMesh(
  iframe: HTMLIFrameElement,
  position: THREE.Vector3,
): VRMeshHandle | null {
  const doc = iframe.contentDocument;
  if (!doc) return null;

  const mirror = document.createElement("div");
  mirror.className = "vr-mirror";
  mirror.style.width = `${IFRAME_WIDTH}px`;
  mirror.style.height = `${IFRAME_HEIGHT}px`;
  mirror.style.overflow = "hidden";
  mirror.style.position = "absolute";
  mirror.style.left = "-9999px";

  cloneWithStyles(doc, mirror);
  document.body.appendChild(mirror);

  const mesh = new HTMLMesh(mirror);
  mesh.position.copy(position);
  mesh.scale.setScalar(VR_MESH_SCALE);

  const mirrorInterval = startMirrorRefresh(iframe, mirror);

  function dispose(): void {
    if (mirrorInterval !== undefined) clearInterval(mirrorInterval);
    mesh.dispose();
    if (mirror.parentNode) mirror.parentNode.removeChild(mirror);
  }

  return { mesh, mirror, mirrorInterval, dispose };
}

/**
 * Create a fallback HTMLMesh for cross-origin iframes (placeholder display).
 */
export function createFallbackMesh(url: string, position: THREE.Vector3): VRMeshHandle {
  const placeholder = document.createElement("div");
  placeholder.style.width = `${IFRAME_WIDTH}px`;
  placeholder.style.height = `${IFRAME_HEIGHT}px`;
  placeholder.style.background = "#1a1a2e";
  placeholder.style.color = "#fff";
  placeholder.style.display = "flex";
  placeholder.style.alignItems = "center";
  placeholder.style.justifyContent = "center";
  placeholder.style.fontSize = "24px";
  placeholder.style.padding = "20px";
  placeholder.style.boxSizing = "border-box";
  placeholder.style.wordBreak = "break-all";
  placeholder.textContent = url;

  document.body.appendChild(placeholder);
  placeholder.style.position = "absolute";
  placeholder.style.left = "-9999px";

  const mesh = new HTMLMesh(placeholder);
  mesh.position.copy(position);
  mesh.scale.setScalar(VR_MESH_SCALE);

  function dispose(): void {
    mesh.dispose();
    if (placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
  }

  return { mesh, mirror: placeholder, mirrorInterval: undefined, dispose };
}

/**
 * Clone iframe document into the mirror div with full styling.
 *
 * HTMLMesh's html2canvas uses window.getComputedStyle() on each element,
 * so CSS must be properly applied in the parent document context.
 *
 * Key techniques:
 * - Rewrite :root / html selectors → .vr-mirror so custom properties cascade
 * - Read cssRules (already URL-resolved) to avoid broken relative paths
 * - Strip href from <a> to prevent htmlevent dispatchEvent from navigating
 */
function cloneWithStyles(doc: Document, mirror: HTMLDivElement): void {
  mirror.innerHTML = "";

  // Collect CSS rules, rewriting :root/html selectors to target mirror container
  let inlineCss = "";
  for (const sheet of doc.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        inlineCss += rewriteCssRule(rule) + "\n";
      }
    } catch {
      // Cross-origin sheet — clone <link> with absolute href as fallback
      const node = sheet.ownerNode as HTMLElement | null;
      if (node?.tagName === "LINK") {
        const link = node.cloneNode(true) as HTMLLinkElement;
        link.href = new URL(node.getAttribute("href") ?? "", doc.baseURI).href;
        mirror.appendChild(link);
      }
    }
  }
  if (inlineCss) {
    const style = document.createElement("style");
    style.textContent = inlineCss;
    mirror.appendChild(style);
  }

  // Clone body (keeps `body` selectors working)
  const clonedBody = doc.body.cloneNode(true) as HTMLElement;

  // Strip href from anchors — htmlevent dispatches click directly on elements
  // without bubbling, so parent listeners can't intercept. Removing href
  // prevents the browser's default navigation action.
  for (const a of clonedBody.querySelectorAll("a[href]")) {
    a.removeAttribute("href");
  }

  mirror.appendChild(clonedBody);
}

/**
 * Rewrite CSS rule selectors: :root and html → .vr-mirror
 * so that custom properties and html-level styles cascade into the mirror div.
 */
function rewriteCssRule(rule: CSSRule): string {
  if (rule instanceof CSSStyleRule) {
    const sel = rule.selectorText;
    if (/:root/.test(sel) || /\bhtml\b/.test(sel)) {
      const newSel = sel.replace(/:root/g, ".vr-mirror").replace(/\bhtml\b/g, ".vr-mirror");
      return rule.cssText.replace(sel, newSel);
    }
  }
  return rule.cssText;
}

function startMirrorRefresh(iframe: HTMLIFrameElement, mirror: HTMLDivElement): number {
  return window.setInterval(() => {
    const doc = iframe.contentDocument;
    if (!doc) return;
    cloneWithStyles(doc, mirror);
  }, MIRROR_REFRESH_INTERVAL);
}

export { IFRAME_WIDTH, IFRAME_HEIGHT };
