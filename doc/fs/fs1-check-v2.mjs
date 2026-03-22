// FS-1 v2: iframe埋め込み + oEmbed対応の総合調査
// 3段階判定: IFRAME (直接) / OEMBED (ラッパー経由) / NONE (非対応)

// oEmbed providers: endpoint + URL pattern that supports oEmbed
const OEMBED_PROVIDERS = {
  "Twitter/X": {
    endpoint: "https://publish.twitter.com/oembed",
    testUrl: "https://x.com/elonmusk/status/1585841080431321088",
    urlPatterns: ["x.com/*/status/*", "twitter.com/*/status/*"],
    note: "個別ツイートのみ。タイムラインは非対応",
  },
  Reddit: {
    endpoint: "https://www.reddit.com/oembed",
    testUrl: "https://www.reddit.com/r/webdev/comments/1jgnqzk/",
    urlPatterns: ["reddit.com/r/*/comments/*"],
    note: "個別投稿のみ。サブレディットトップは非対応",
  },
  YouTube: {
    endpoint: "https://www.youtube.com/oembed",
    testUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    urlPatterns: ["youtube.com/watch?v=*", "youtu.be/*"],
    note: "個別動画のみ。トップページ・チャンネルは非対応",
  },
  Spotify: {
    endpoint: "https://open.spotify.com/oembed",
    testUrl: "https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8",
    urlPatterns: ["open.spotify.com/track/*", "open.spotify.com/album/*", "open.spotify.com/playlist/*"],
    note: "トラック/アルバム/プレイリスト",
  },
  Instagram: {
    // Instagram oEmbed requires Facebook app token since 2020
    endpoint: null,
    testUrl: null,
    urlPatterns: [],
    note: "oEmbed APIにFacebook App Tokenが必要。実質利用不可",
  },
  Facebook: {
    endpoint: null,
    testUrl: null,
    urlPatterns: [],
    note: "oEmbed APIにFacebook App Tokenが必要。実質利用不可",
  },
  TikTok: {
    endpoint: "https://www.tiktok.com/oembed",
    testUrl: "https://www.tiktok.com/@tiktok/video/7456025980498678046",
    urlPatterns: ["tiktok.com/@*/video/*"],
    note: "個別動画のみ",
  },
  Flickr: {
    endpoint: "https://www.flickr.com/services/oembed",
    testUrl: "https://www.flickr.com/photos/bfrg/2753667228/",
    urlPatterns: ["flickr.com/photos/*/*"],
    note: "個別写真のみ",
  },
  // TechCrunch: no oEmbed support confirmed
  TechCrunch: {
    endpoint: null,
    testUrl: null,
    urlPatterns: [],
    note: "oEmbed非対応",
  },
  // Medium: Cloudflare bot protection blocks server-side access
  Medium: {
    endpoint: null,
    testUrl: null,
    urlPatterns: [],
    note: "oEmbedエンドポイント存在するがCloudflare bot保護で実質利用不可",
  },
};

// Map site names to oEmbed provider key
const SITE_OEMBED_MAP = {
  "Twitter/X": "Twitter/X",
  Reddit: "Reddit",
  YouTube: "YouTube",
  Spotify: "Spotify",
  Instagram: "Instagram",
  Facebook: "Facebook",
  TechCrunch: "TechCrunch",
  Medium: "Medium",
};

const SITES = [
  // ニュース/メディア (10件)
  { category: "ニュース/メディア", name: "CNN", url: "https://www.cnn.com" },
  { category: "ニュース/メディア", name: "BBC", url: "https://www.bbc.com" },
  { category: "ニュース/メディア", name: "NHK", url: "https://www3.nhk.or.jp" },
  { category: "ニュース/メディア", name: "Reuters", url: "https://www.reuters.com" },
  { category: "ニュース/メディア", name: "The Guardian", url: "https://www.theguardian.com" },
  { category: "ニュース/メディア", name: "NY Times", url: "https://www.nytimes.com" },
  { category: "ニュース/メディア", name: "Asahi Shimbun", url: "https://www.asahi.com" },
  { category: "ニュース/メディア", name: "TechCrunch", url: "https://techcrunch.com" },
  { category: "ニュース/メディア", name: "The Verge", url: "https://www.theverge.com" },
  { category: "ニュース/メディア", name: "Ars Technica", url: "https://arstechnica.com" },

  // SNS/コミュニティ (10件)
  { category: "SNS/コミュニティ", name: "Twitter/X", url: "https://x.com" },
  { category: "SNS/コミュニティ", name: "Reddit", url: "https://www.reddit.com" },
  { category: "SNS/コミュニティ", name: "Facebook", url: "https://www.facebook.com" },
  { category: "SNS/コミュニティ", name: "LinkedIn", url: "https://www.linkedin.com" },
  { category: "SNS/コミュニティ", name: "Instagram", url: "https://www.instagram.com" },
  { category: "SNS/コミュニティ", name: "Discord", url: "https://discord.com" },
  { category: "SNS/コミュニティ", name: "Hacker News", url: "https://news.ycombinator.com" },
  { category: "SNS/コミュニティ", name: "Stack Overflow", url: "https://stackoverflow.com" },
  { category: "SNS/コミュニティ", name: "Mastodon (mstdn.jp)", url: "https://mstdn.jp" },
  { category: "SNS/コミュニティ", name: "Bluesky", url: "https://bsky.app" },

  // ドキュメント/Wiki (10件)
  { category: "ドキュメント/Wiki", name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Main_Page" },
  { category: "ドキュメント/Wiki", name: "MDN Web Docs", url: "https://developer.mozilla.org" },
  { category: "ドキュメント/Wiki", name: "GitHub", url: "https://github.com" },
  { category: "ドキュメント/Wiki", name: "GitLab", url: "https://gitlab.com" },
  { category: "ドキュメント/Wiki", name: "Rust docs", url: "https://doc.rust-lang.org/book/" },
  { category: "ドキュメント/Wiki", name: "Python docs", url: "https://docs.python.org/3/" },
  { category: "ドキュメント/Wiki", name: "Node.js docs", url: "https://nodejs.org/en/docs" },
  { category: "ドキュメント/Wiki", name: "Arch Wiki", url: "https://wiki.archlinux.org" },
  { category: "ドキュメント/Wiki", name: "W3Schools", url: "https://www.w3schools.com" },
  { category: "ドキュメント/Wiki", name: "DevDocs", url: "https://devdocs.io" },

  // EC/サービス (10件)
  { category: "EC/サービス", name: "Amazon", url: "https://www.amazon.com" },
  { category: "EC/サービス", name: "YouTube", url: "https://www.youtube.com" },
  { category: "EC/サービス", name: "Google", url: "https://www.google.com" },
  { category: "EC/サービス", name: "Google Maps", url: "https://maps.google.com" },
  { category: "EC/サービス", name: "Netflix", url: "https://www.netflix.com" },
  { category: "EC/サービス", name: "Spotify", url: "https://www.spotify.com" },
  { category: "EC/サービス", name: "Notion", url: "https://www.notion.so" },
  { category: "EC/サービス", name: "Figma", url: "https://www.figma.com" },
  { category: "EC/サービス", name: "Twitch", url: "https://www.twitch.tv" },
  { category: "EC/サービス", name: "Rakuten", url: "https://www.rakuten.co.jp" },

  // 技術ブログ/個人サイト (10件)
  { category: "技術ブログ/個人サイト", name: "Medium", url: "https://medium.com" },
  { category: "技術ブログ/個人サイト", name: "Dev.to", url: "https://dev.to" },
  { category: "技術ブログ/個人サイト", name: "Zenn", url: "https://zenn.dev" },
  { category: "技術ブログ/個人サイト", name: "Qiita", url: "https://qiita.com" },
  { category: "技術ブログ/個人サイト", name: "Hashnode", url: "https://hashnode.com" },
  { category: "技術ブログ/個人サイト", name: "CSS-Tricks", url: "https://css-tricks.com" },
  { category: "技術ブログ/個人サイト", name: "Smashing Magazine", url: "https://www.smashingmagazine.com" },
  { category: "技術ブログ/個人サイト", name: "freeCodeCamp", url: "https://www.freecodecamp.org" },
  { category: "技術ブログ/個人サイト", name: "web.dev", url: "https://web.dev" },
  { category: "技術ブログ/個人サイト", name: "Hatenablog (example)", url: "https://blog.hatena.ne.jp" },
];

// --- iframe check (same as v1) ---
async function checkIframeEmbeddable(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });

    let xfo = res.headers.get("x-frame-options") || "";
    let csp = res.headers.get("content-security-policy") || "";
    let frameAncestors = csp.match(/frame-ancestors\s+([^;]+)/i)?.[1] || "";

    // Some servers only send CSP on GET
    if (!xfo && !frameAncestors) {
      const getRes = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      xfo = getRes.headers.get("x-frame-options") || xfo;
      const getCsp = getRes.headers.get("content-security-policy") || "";
      frameAncestors = getCsp.match(/frame-ancestors\s+([^;]+)/i)?.[1] || frameAncestors;
      await getRes.text(); // consume body
    }

    let blocked = false;
    let reason = "";

    if (xfo) {
      const upper = xfo.toUpperCase();
      if (upper === "DENY" || upper === "SAMEORIGIN" || upper.startsWith("ALLOW-FROM")) {
        blocked = true;
        reason = `X-Frame-Options: ${xfo}`;
      }
    }
    if (frameAncestors) {
      const tokens = frameAncestors.trim().split(/\s+/);
      if (!tokens.includes("*")) {
        blocked = true;
        reason = reason ? `${reason} + frame-ancestors` : `frame-ancestors: ${frameAncestors.trim()}`;
      }
    }

    return { embeddable: !blocked, xfo: xfo || "(none)", frameAncestors: frameAncestors || "(none)", reason: reason || "(no restriction)" };
  } catch (err) {
    return { embeddable: false, xfo: "ERROR", frameAncestors: "ERROR", reason: err.message };
  }
}

// --- oEmbed check ---
async function checkOembed(siteName, siteUrl) {
  const providerKey = SITE_OEMBED_MAP[siteName];

  // Also try oEmbed discovery in HTML for sites not in known providers
  if (!providerKey) {
    return await discoverOembed(siteUrl, siteName);
  }

  const provider = OEMBED_PROVIDERS[providerKey];
  if (!provider.endpoint) {
    return { supported: false, note: provider.note, method: "N/A" };
  }

  // Test the oEmbed endpoint with the test URL
  try {
    const testUrl = provider.testUrl;
    const oembedUrl = `${provider.endpoint}?url=${encodeURIComponent(testUrl)}&format=json`;
    const res = await fetch(oembedUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Slatog/0.1)" },
    });

    if (res.ok) {
      const data = await res.json();
      if (data.html || data.type) {
        return {
          supported: true,
          type: data.type || "unknown",
          note: provider.note,
          urlPatterns: provider.urlPatterns,
          method: "known-provider",
        };
      }
    }
    return { supported: false, note: `oEmbed endpoint returned ${res.status}`, method: "known-provider" };
  } catch (err) {
    return { supported: false, note: `oEmbed check failed: ${err.message}`, method: "known-provider" };
  }
}

async function discoverOembed(url, siteName) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    const html = await res.text();

    // Look for <link rel="alternate" type="application/json+oembed" ...>
    const jsonMatch = html.match(/<link[^>]+type=["']application\/json\+oembed["'][^>]*href=["']([^"']+)["']/i);
    const xmlMatch = html.match(/<link[^>]+type=["']text\/xml\+oembed["'][^>]*href=["']([^"']+)["']/i);
    // Also try href before type
    const jsonMatch2 = html.match(/<link[^>]+href=["']([^"']+)["'][^>]*type=["']application\/json\+oembed["']/i);
    const xmlMatch2 = html.match(/<link[^>]+href=["']([^"']+)["'][^>]*type=["']text\/xml\+oembed["']/i);

    const discoveredUrl = jsonMatch?.[1] || jsonMatch2?.[1] || xmlMatch?.[1] || xmlMatch2?.[1];

    if (discoveredUrl) {
      // Verify the discovered endpoint works
      try {
        const oRes = await fetch(discoveredUrl.replace(/&amp;/g, "&"), {
          signal: AbortSignal.timeout(10000),
          headers: { "User-Agent": "Mozilla/5.0 (compatible; Slatog/0.1)" },
        });
        if (oRes.ok) {
          const contentType = oRes.headers.get("content-type") || "";
          if (contentType.includes("json")) {
            const data = await oRes.json();
            if (data.html || data.type) {
              return { supported: true, type: data.type || "unknown", note: "HTMLリンクタグで発見", method: "discovery" };
            }
          } else {
            await oRes.text(); // consume XML
            return { supported: true, type: "unknown", note: "HTMLリンクタグで発見 (XML)", method: "discovery" };
          }
        }
      } catch {}
      return { supported: true, type: "unknown", note: "oEmbedリンク検出（未検証）", method: "discovery" };
    }

    // Try well-known WordPress oEmbed endpoint
    try {
      const wpUrl = new URL(url);
      const wpOembed = `${wpUrl.origin}/wp-json/oembed/1.0/embed?url=${encodeURIComponent(url)}&format=json`;
      const wpRes = await fetch(wpOembed, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Slatog/0.1)" },
      });
      if (wpRes.ok) {
        const data = await wpRes.json();
        if (data.html || data.type) {
          return { supported: true, type: data.type || "unknown", note: "WordPress oEmbed", method: "wp-json" };
        }
      }
    } catch {}

    return { supported: false, note: "oEmbed未対応", method: "discovery" };
  } catch (err) {
    return { supported: false, note: `Discovery失敗: ${err.message}`, method: "discovery" };
  }
}

// --- Main ---
async function main() {
  console.log("FS-1 v2: iframe + oEmbed 総合調査開始...\n");

  const results = [];
  for (let i = 0; i < SITES.length; i += 5) {
    const batch = SITES.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(async (site) => {
        const iframe = await checkIframeEmbeddable(site.url);
        const oembed = await checkOembed(site.name, site.url);

        let displayMethod;
        if (iframe.embeddable) {
          displayMethod = "IFRAME";
        } else if (oembed.supported) {
          displayMethod = "OEMBED";
        } else {
          displayMethod = "NONE";
        }

        return { ...site, iframe, oembed, displayMethod };
      })
    );
    results.push(...batchResults);
    process.stdout.write(`  ${Math.min(i + 5, SITES.length)}/${SITES.length} sites checked\n`);
  }

  // --- Output ---
  console.log("\n=== FS-1 v2 調査結果 ===\n");

  const categories = [...new Set(results.map((r) => r.category))];
  let totalIframe = 0, totalOembed = 0, totalNone = 0;

  for (const cat of categories) {
    console.log(`### ${cat}`);
    console.log("| サイト | iframe直接 | oEmbed | 表示方式 | 備考 |");
    console.log("|--------|-----------|--------|----------|------|");

    const catResults = results.filter((r) => r.category === cat);
    for (const r of catResults) {
      const iframeStatus = r.iframe.embeddable ? "OK" : "NG";
      const oembedStatus = r.oembed.supported ? `OK (${r.oembed.note})` : "NG";
      console.log(`| ${r.name} | ${iframeStatus} | ${oembedStatus} | **${r.displayMethod}** | ${r.iframe.embeddable ? "" : r.iframe.reason} |`);

      if (r.displayMethod === "IFRAME") totalIframe++;
      else if (r.displayMethod === "OEMBED") totalOembed++;
      else totalNone++;
    }
    console.log();
  }

  const total = results.length;
  const supported = totalIframe + totalOembed;
  const supportRate = ((supported / total) * 100).toFixed(1);

  console.log("=== サマリー ===");
  console.log(`対象サイト数: ${total}`);
  console.log(`IFRAME (直接埋め込み): ${totalIframe}`);
  console.log(`OEMBED (ラッパー経由): ${totalOembed}`);
  console.log(`NONE (非対応): ${totalNone}`);
  console.log(`プロキシ不要の対応率: ${supportRate}% (${supported}/${total})`);
  console.log();
  console.log(`=== 方式別内訳 ===`);
  console.log(`iframe直接: ${((totalIframe / total) * 100).toFixed(1)}%`);
  console.log(`oEmbed: ${((totalOembed / total) * 100).toFixed(1)}%`);
  console.log(`非対応 (プロキシ必要): ${((totalNone / total) * 100).toFixed(1)}%`);

  // Save JSON
  const fs = await import("fs");
  const output = {
    results,
    summary: {
      total,
      iframe: totalIframe,
      oembed: totalOembed,
      none: totalNone,
      supportRate,
    },
  };
  fs.writeFileSync("doc/fs/fs1-results-v2.json", JSON.stringify(output, null, 2));
  console.log("\n結果をdoc/fs/fs1-results-v2.jsonに保存しました。");
}

main();
