// [E] Proxy utilities: URL validation, header stripping, base tag injection, cache

import { isIP } from "net";

// --- SSRF Prevention ---

const PRIVATE_RANGES = [
  /^127\./, // loopback
  /^10\./, // class A
  /^172\.(1[6-9]|2\d|3[01])\./, // class B
  /^192\.168\./, // class C
  /^169\.254\./, // link-local
  /^0\./, // current network
  /^::1$/, // IPv6 loopback
  /^fc00:/i, // IPv6 unique local
  /^fe80:/i, // IPv6 link-local
];

function isPrivateIp(hostname: string): boolean {
  return PRIVATE_RANGES.some((re) => re.test(hostname));
}

export function validateProxyUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProxyError(400, "Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ProxyError(400, "Only http/https URLs are allowed");
  }

  // Block private IPs (direct IP in hostname)
  if (isIP(parsed.hostname) && isPrivateIp(parsed.hostname)) {
    throw new ProxyError(403, "Private/internal URLs are not allowed");
  }

  // Block common internal hostnames
  const h = parsed.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) {
    throw new ProxyError(403, "Private/internal URLs are not allowed");
  }

  return parsed;
}

// --- Header processing ---

const FRAME_BLOCKING_HEADERS = ["x-frame-options"];

export function stripFrameHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  headers.forEach((value, key) => {
    const lower = key.toLowerCase();

    // Remove X-Frame-Options entirely
    if (FRAME_BLOCKING_HEADERS.includes(lower)) return;

    // Remove frame-ancestors and script-src from CSP
    // frame-ancestors: allows iframe embedding
    // script-src: allows our injected navigation interceptor script
    if (lower === "content-security-policy") {
      const stripped = value
        .split(";")
        .map((d) => d.trim())
        .filter((d) => {
          const dl = d.toLowerCase();
          return !dl.startsWith("frame-ancestors") && !dl.startsWith("script-src");
        })
        .join("; ");
      if (stripped) {
        result[key] = stripped;
      }
      return;
    }

    result[key] = value;
  });

  return result;
}

// --- HTML processing: inject <base> tag + navigation interceptor ---

export function injectBaseTag(html: string, baseUrl: string): string {
  // Compute base href: origin + path up to last slash
  const parsed = new URL(baseUrl);
  const pathParts = parsed.pathname.split("/");
  pathParts.pop(); // remove filename portion
  const basePath = pathParts.join("/") + "/";
  const baseHref = parsed.origin + basePath;

  const origin = parsed.origin;

  const baseTag = `<base href="${escapeHtml(baseHref)}">`;

  // Script to intercept navigation + scroll sync via postMessage
  const navScript = `<script>(function(){
var O="${escapeAttr(origin)}";
function proxyHref(u){
  try{var p=new URL(u,location.href);
  if(p.origin===O)return"/api/proxy?url="+encodeURIComponent(p.href);
  if(p.protocol==="http:"||p.protocol==="https:")return"/api/proxy?url="+encodeURIComponent(p.href);
  }catch(e){}return u;
}
document.addEventListener("click",function(e){
  var a=e.target.closest("a");
  if(!a||!a.href)return;
  var h=a.getAttribute("href");
  if(!h||h.startsWith("#")||h.startsWith("javascript:"))return;
  e.preventDefault();e.stopPropagation();
  location.href=proxyHref(a.href);
},true);
document.addEventListener("submit",function(e){
  var f=e.target;if(!f.action)return;
  e.preventDefault();
  location.href=proxyHref(f.action);
},true);
var _lx=0,_ly=0;
function _reportScroll(){
  var sx=window.scrollX||window.pageXOffset||0;
  var sy=window.scrollY||window.pageYOffset||0;
  if(sx!==_lx||sy!==_ly){_lx=sx;_ly=sy;
    window.parent.postMessage({type:"SLATOG_SCROLL",x:sx,y:sy},"*");
  }
}
window.addEventListener("scroll",_reportScroll,{passive:true});
setInterval(_reportScroll,200);
window.addEventListener("message",function(e){
  if(e.data&&e.data.type==="SLATOG_SCROLL_TO"){
    window.scrollTo(e.data.x||0,e.data.y||0);
    _lx=e.data.x||0;_ly=e.data.y||0;
  }
});
})();</script>`;

  // Insert after <head>
  const headMatch = html.match(/<head(\s[^>]*)?>/i);
  if (headMatch) {
    const idx = headMatch.index! + headMatch[0].length;
    return html.slice(0, idx) + baseTag + navScript + html.slice(idx);
  }

  // No <head> found — prepend
  return baseTag + navScript + html;
}

function escapeAttr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Embeddability check ---

export function checkEmbeddable(headers: Headers): boolean {
  // Check X-Frame-Options
  const xfo = headers.get("x-frame-options");
  if (xfo) {
    const upper = xfo.toUpperCase();
    if (upper === "DENY" || upper === "SAMEORIGIN" || upper.startsWith("ALLOW-FROM")) {
      return false;
    }
  }

  // Check CSP frame-ancestors
  const csp = headers.get("content-security-policy") || "";
  const match = csp.match(/frame-ancestors\s+([^;]+)/i);
  if (match) {
    const tokens = match[1].trim().split(/\s+/);
    // Only embeddable if bare "*" is present
    if (!tokens.includes("*")) {
      return false;
    }
  }

  return true;
}

// --- Response cache ---

interface CacheEntry {
  body: string;
  headers: Record<string, string>;
  contentType: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100;

export function getCached(url: string): CacheEntry | null {
  const entry = cache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(url);
    return null;
  }
  return entry;
}

export function setCache(url: string, entry: Omit<CacheEntry, "expiresAt">): void {
  // Evict oldest if at capacity
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
  }
  cache.set(url, { ...entry, expiresAt: Date.now() + CACHE_TTL_MS });
}

// --- Error type ---

export class ProxyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
