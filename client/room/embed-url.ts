// D13: oEmbed / embed URL rewrite for known services
// Converts viewer URLs to official embed-friendly URLs (client-side only, no server needed).
// These embed URLs are designed for iframe use and don't require header-stripping proxy.

interface EmbedRule {
  match: (url: URL) => boolean;
  rewrite: (url: URL) => string;
}

const EMBED_RULES: EmbedRule[] = [
  // YouTube: watch, shorts, youtu.be → /embed/{ID}
  {
    match: (u) =>
      (u.hostname === "www.youtube.com" || u.hostname === "youtube.com") &&
      u.pathname === "/watch" &&
      !!u.searchParams.get("v"),
    rewrite: (u) => `https://www.youtube.com/embed/${u.searchParams.get("v")}`,
  },
  {
    match: (u) =>
      (u.hostname === "www.youtube.com" || u.hostname === "youtube.com") &&
      u.pathname.startsWith("/shorts/"),
    rewrite: (u) => `https://www.youtube.com/embed/${u.pathname.split("/shorts/")[1]}`,
  },
  {
    match: (u) => u.hostname === "youtu.be" && u.pathname.length > 1,
    rewrite: (u) => `https://www.youtube.com/embed/${u.pathname.slice(1)}`,
  },
  // YouTube: already an embed URL — pass through
  {
    match: (u) =>
      (u.hostname === "www.youtube.com" || u.hostname === "youtube.com") &&
      u.pathname.startsWith("/embed/"),
    rewrite: (u) => u.href,
  },
];

/**
 * Try to rewrite a URL to its embed-friendly form.
 * Returns the embed URL string if a known rule matches, or null otherwise.
 */
export function tryEmbedRewrite(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  for (const rule of EMBED_RULES) {
    if (rule.match(parsed)) {
      return rule.rewrite(parsed);
    }
  }

  return null;
}
