// FS-1: iframe埋め込み成功率調査
// X-Frame-Options と Content-Security-Policy: frame-ancestors を調査する

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

async function checkSite(site) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(site.url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const xfo = res.headers.get("x-frame-options") || "";
    const csp = res.headers.get("content-security-policy") || "";
    const frameAncestors = csp.match(/frame-ancestors\s+([^;]+)/i)?.[1] || "";

    let embeddable = "YES";
    let reason = "";

    if (xfo) {
      const xfoUpper = xfo.toUpperCase();
      if (xfoUpper === "DENY") {
        embeddable = "NO";
        reason = `X-Frame-Options: ${xfo}`;
      } else if (xfoUpper === "SAMEORIGIN") {
        embeddable = "NO";
        reason = `X-Frame-Options: ${xfo}`;
      } else if (xfoUpper.startsWith("ALLOW-FROM")) {
        embeddable = "NO";
        reason = `X-Frame-Options: ${xfo}`;
      }
    }

    if (frameAncestors) {
      // frame-ancestors allows any origin only if it contains a bare "*" token
      // "*.example.com" is a subdomain wildcard, NOT open access
      const tokens = frameAncestors.trim().split(/\s+/);
      const allowsAny = tokens.some((t) => t === "*");
      if (!allowsAny) {
        embeddable = "NO";
        reason = reason ? `${reason} + frame-ancestors: ${frameAncestors.trim()}` : `frame-ancestors: ${frameAncestors.trim()}`;
      }
    }

    // HEAD might not return CSP; try GET if no headers found
    if (!xfo && !frameAncestors) {
      // Some servers only send CSP on GET
      const getRes = await fetch(site.url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      const getCsp = getRes.headers.get("content-security-policy") || "";
      const getXfo = getRes.headers.get("x-frame-options") || "";
      const getFrameAncestors = getCsp.match(/frame-ancestors\s+([^;]+)/i)?.[1] || "";

      // Consume body to avoid memory leak
      await getRes.text();

      if (getXfo) {
        const xfoUpper = getXfo.toUpperCase();
        if (xfoUpper === "DENY" || xfoUpper === "SAMEORIGIN") {
          embeddable = "NO";
          reason = `X-Frame-Options: ${getXfo}`;
        }
      }
      if (getFrameAncestors) {
        const tokens = getFrameAncestors.trim().split(/\s+/);
        const allowsAny = tokens.some((t) => t === "*");
        if (!allowsAny) {
          embeddable = "NO";
          reason = reason ? `${reason} + frame-ancestors: ${getFrameAncestors.trim()}` : `frame-ancestors: ${getFrameAncestors.trim()}`;
        }
      }

      return {
        ...site,
        status: res.status,
        xFrameOptions: getXfo || xfo || "(none)",
        frameAncestors: getFrameAncestors || frameAncestors || "(none)",
        embeddable,
        reason: reason || "(no restriction found)",
      };
    }

    return {
      ...site,
      status: res.status,
      xFrameOptions: xfo || "(none)",
      frameAncestors: frameAncestors || "(none)",
      embeddable,
      reason: reason || "(no restriction found)",
    };
  } catch (err) {
    return {
      ...site,
      status: "ERROR",
      xFrameOptions: "N/A",
      frameAncestors: "N/A",
      embeddable: "UNKNOWN",
      reason: err.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  console.log("FS-1: iframe埋め込み成功率調査開始...\n");

  const results = [];
  // Run in batches of 5 to avoid overwhelming
  for (let i = 0; i < SITES.length; i += 5) {
    const batch = SITES.slice(i, i + 5);
    const batchResults = await Promise.all(batch.map(checkSite));
    results.push(...batchResults);
    process.stdout.write(`  ${Math.min(i + 5, SITES.length)}/${SITES.length} sites checked\n`);
  }

  // Output results
  console.log("\n=== 調査結果 ===\n");

  const categories = [...new Set(results.map((r) => r.category))];
  let totalYes = 0;
  let totalNo = 0;
  let totalUnknown = 0;

  for (const cat of categories) {
    console.log(`### ${cat}`);
    console.log("| サイト | HTTP | X-Frame-Options | frame-ancestors | 埋込可否 | 備考 |");
    console.log("|--------|------|-----------------|-----------------|----------|------|");

    const catResults = results.filter((r) => r.category === cat);
    for (const r of catResults) {
      console.log(
        `| ${r.name} | ${r.status} | ${r.xFrameOptions} | ${r.frameAncestors} | ${r.embeddable} | ${r.reason} |`
      );
      if (r.embeddable === "YES") totalYes++;
      else if (r.embeddable === "NO") totalNo++;
      else totalUnknown++;
    }
    console.log();
  }

  const total = results.length;
  const successRate = ((totalYes / (total - totalUnknown)) * 100).toFixed(1);

  console.log("=== サマリー ===");
  console.log(`対象サイト数: ${total}`);
  console.log(`埋め込み可能 (YES): ${totalYes}`);
  console.log(`埋め込み不可 (NO): ${totalNo}`);
  console.log(`不明 (UNKNOWN): ${totalUnknown}`);
  console.log(`成功率: ${successRate}% (${totalYes}/${total - totalUnknown})`);
  console.log();

  if (parseFloat(successRate) >= 70) {
    console.log("判定: CSS3DRenderer + iframe方式で進行");
  } else if (parseFloat(successRate) >= 40) {
    console.log("判定: iframe方式を主軸としつつ、フォールバック（プロキシ or スクリーンショット）を並行実装");
  } else {
    console.log("判定: プロキシ方式を主軸に切り替え。iframe方式は補助的手段に格下げ");
  }

  // Output JSON for programmatic use
  const outputData = { results, summary: { total, yes: totalYes, no: totalNo, unknown: totalUnknown, successRate } };
  const fs = await import("fs");
  fs.writeFileSync("doc/fs/fs1-results.json", JSON.stringify(outputData, null, 2));
  console.log("\n結果をdoc/fs/fs1-results.jsonに保存しました。");
}

main();
