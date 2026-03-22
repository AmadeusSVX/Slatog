// [E] Proxy handlers: header-stripping reverse proxy + embeddability check

import type { Express } from "express";
import {
  validateProxyUrl,
  stripFrameHeaders,
  injectBaseTag,
  checkEmbeddable,
  getCached,
  setCache,
  ProxyError,
} from "./proxy-utils.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB

// Proxy is OFF by default. Enable with SLATOG_PROXY=1
function isProxyEnabled(): boolean {
  return process.env.SLATOG_PROXY === "1";
}

export function setupProxy(app: Express): void {
  // GET /api/proxy/check?url=... — check if a URL can be embedded directly
  app.get("/api/proxy/check", async (req, res) => {
    const rawUrl = req.query.url as string | undefined;
    if (!rawUrl) {
      res.status(400).json({ error: "url query parameter is required" });
      return;
    }

    try {
      const parsed = validateProxyUrl(rawUrl);
      const proxyEnabled = isProxyEnabled();

      const resp = await fetch(parsed.href, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Slatog/0.1)" },
      });

      const embeddable = checkEmbeddable(resp.headers);

      if (embeddable) {
        res.json({ embeddable: true, supported: true, url: parsed.href, proxyUrl: null });
      } else if (proxyEnabled) {
        res.json({
          embeddable: false,
          supported: true,
          url: parsed.href,
          proxyUrl: `/api/proxy?url=${encodeURIComponent(parsed.href)}`,
        });
      } else {
        // Proxy OFF + not embeddable → unsupported
        res.json({ embeddable: false, supported: false, url: parsed.href, proxyUrl: null });
      }
    } catch (err) {
      if (err instanceof ProxyError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: "Failed to check URL" });
    }
  });

  // GET /api/proxy?url=... — fetch URL with frame-blocking headers stripped
  app.get("/api/proxy", async (req, res) => {
    if (!isProxyEnabled()) {
      res.status(403).json({ error: "Proxy is disabled. Set SLATOG_PROXY=1 to enable." });
      return;
    }

    const rawUrl = req.query.url as string | undefined;
    if (!rawUrl) {
      res.status(400).json({ error: "url query parameter is required" });
      return;
    }

    try {
      const parsed = validateProxyUrl(rawUrl);
      const url = parsed.href;

      // Check cache
      const cached = getCached(url);
      if (cached) {
        res.set("Content-Type", cached.contentType);
        res.set("X-Slatog-Cache", "HIT");
        res.send(cached.body);
        return;
      }

      // Fetch from origin
      const resp = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Slatog/0.1)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      // Size check
      const contentLength = resp.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) {
        res.status(413).json({ error: "Response too large" });
        return;
      }

      const contentType = resp.headers.get("content-type") || "text/html";
      let body = await resp.text();

      // Strip frame-blocking headers
      const cleanHeaders = stripFrameHeaders(resp.headers);

      // Inject <base> tag for HTML responses
      if (contentType.includes("text/html")) {
        body = injectBaseTag(body, url);
      }

      // Cache the processed response
      setCache(url, { body, headers: cleanHeaders, contentType });

      // Send response
      res.set("Content-Type", contentType);
      res.set("X-Slatog-Cache", "MISS");
      res.send(body);
    } catch (err) {
      if (err instanceof ProxyError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      res.status(502).json({ error: "Failed to fetch URL" });
    }
  });
}
