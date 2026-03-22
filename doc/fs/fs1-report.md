# FS-1: iframe埋め込み + oEmbed対応 総合調査 結果レポート

## 調査日

2026-03-21 (v2: oEmbed対応を含む再調査)

## 調査方法

### iframe埋め込み判定

Node.jsスクリプトで各サイトへHTTP HEAD/GETリクエストを送信し、レスポンスヘッダを分析:
- `X-Frame-Options: DENY` or `SAMEORIGIN` → 埋め込み不可
- `frame-ancestors` にベア `*` トークンがない場合 → 埋め込み不可

### oEmbed対応判定

3つの方法で確認:
1. **既知プロバイダ**: Twitter/X, YouTube, Reddit, Spotify等の公開oEmbed APIエンドポイントにテストURLで実際にリクエスト
2. **HTMLディスカバリ**: ページHTML内の `<link rel="alternate" type="application/json+oembed">` タグを検索
3. **WordPress oEmbed**: `/wp-json/oembed/1.0/embed` エンドポイントを試行

### 3段階判定

| 表示方式 | 条件 | サーバ負荷 |
|---|---|---|
| IFRAME | iframe直接埋め込み可能 | なし |
| OEMBED | oEmbed API対応（個別コンテンツURL） | 極小（oEmbed API呼び出し + ラッパーHTML生成） |
| NONE | 上記いずれも不可 | プロキシ必要 |

## 調査結果サマリー

| 項目 | 件数 | 割合 |
|------|------|------|
| 対象サイト数 | 50 | 100% |
| IFRAME (直接埋め込み) | 9 | 18.0% |
| OEMBED (ラッパー経由) | 5 | 10.0% |
| **プロキシ不要の対応率** | **14** | **28.0%** |
| NONE (非対応、プロキシ必要) | 36 | 72.0% |

## カテゴリ別結果

### ニュース/メディア (1/10 = 10%)

| サイト | iframe | oEmbed | 表示方式 | 備考 |
|--------|--------|--------|----------|------|
| CNN | NG | NG | NONE | frame-ancestors制限 |
| BBC | NG | NG | NONE | SAMEORIGIN |
| NHK | NG | NG | NONE | frame-ancestors制限 |
| Reuters | NG | NG | NONE | frame-ancestors: 'self' |
| The Guardian | NG | NG | NONE | SAMEORIGIN |
| NY Times | NG | NG | NONE | DENY |
| **Asahi Shimbun** | **OK** | NG | **IFRAME** | |
| TechCrunch | NG | NG | NONE | SAMEORIGIN + frame-ancestors |
| The Verge | NG | NG | NONE | frame-ancestors制限 |
| Ars Technica | NG | NG | NONE | SAMEORIGIN |

### SNS/コミュニティ (2/10 = 20%)

| サイト | iframe | oEmbed | 表示方式 | 備考 |
|--------|--------|--------|----------|------|
| **Twitter/X** | NG | **OK** | **OEMBED** | 個別ツイートのみ。タイムラインは非対応 |
| **Reddit** | NG | **OK** | **OEMBED** | 個別投稿のみ。サブレディットトップは非対応 |
| Facebook | NG | NG | NONE | oEmbed APIにApp Token必要 |
| LinkedIn | NG | NG | NONE | |
| Instagram | NG | NG | NONE | oEmbed APIにApp Token必要 |
| Discord | NG | NG | NONE | |
| Hacker News | NG | NG | NONE | |
| Stack Overflow | NG | NG | NONE | |
| Mastodon (mstdn.jp) | NG | NG | NONE | |
| Bluesky | NG | NG | NONE | |

### ドキュメント/Wiki (7/10 = 70%)

| サイト | iframe | oEmbed | 表示方式 | 備考 |
|--------|--------|--------|----------|------|
| **Wikipedia** | **OK** | NG | **IFRAME** | |
| MDN Web Docs | NG | NG | NONE | DENY |
| GitHub | NG | NG | NONE | deny + frame-ancestors: 'none' |
| **GitLab** | **OK** | NG | **IFRAME** | |
| **Rust docs** | **OK** | NG | **IFRAME** | |
| **Python docs** | **OK** | NG | **IFRAME** | |
| **Node.js docs** | **OK** | NG | **IFRAME** | |
| **Arch Wiki** | **OK** | NG | **IFRAME** | |
| W3Schools | NG | NG | NONE | frame-ancestors制限 |
| **DevDocs** | **OK** | NG | **IFRAME** | |

### EC/サービス (2/10 = 20%)

| サイト | iframe | oEmbed | 表示方式 | 備考 |
|--------|--------|--------|----------|------|
| Amazon | NG | NG | NONE | SAMEORIGIN |
| **YouTube** | NG | **OK** | **OEMBED** | 個別動画のみ。トップ・チャンネルは非対応 |
| Google | NG | NG | NONE | SAMEORIGIN |
| Google Maps | NG | NG | NONE | SAMEORIGIN |
| Netflix | NG | NG | NONE | DENY |
| **Spotify** | NG | **OK** | **OEMBED** | トラック/アルバム/プレイリスト |
| Notion | NG | NG | NONE | SAMEORIGIN + frame-ancestors |
| Figma | NG | NG | NONE | SAMEORIGIN |
| Twitch | NG | NG | NONE | SAMEORIGIN |
| Rakuten | NG | NG | NONE | DENY |

### 技術ブログ/個人サイト (2/10 = 20%)

| サイト | iframe | oEmbed | 表示方式 | 備考 |
|--------|--------|--------|----------|------|
| Medium | NG | NG | NONE | oEmbedあるがCloudflare bot保護で実質不可 |
| Dev.to | NG | NG | NONE | frame-ancestors制限 |
| Zenn | NG | NG | NONE | SAMEORIGIN |
| Qiita | NG | NG | NONE | SAMEORIGIN |
| **Hashnode** | **OK** | NG | **IFRAME** | |
| **CSS-Tricks** | NG | **OK** | **OEMBED** | HTMLリンクタグで発見 (WordPress oEmbed) |
| Smashing Magazine | NG | NG | NONE | SAMEORIGIN |
| freeCodeCamp | NG | NG | NONE | SAMEORIGIN + frame-ancestors |
| web.dev | NG | NG | NONE | frame-ancestors制限 |
| Hatenablog | NG | NG | NONE | DENY |

## oEmbed対応サイトの重要な制約

oEmbed対応は**個別コンテンツURLに対してのみ有効**であり、サイトのトップページや一覧ページには適用されない:

| サービス | oEmbed対応URL例 | 非対応URL例 |
|---|---|---|
| Twitter/X | `x.com/user/status/123` | `x.com` (タイムライン) |
| YouTube | `youtube.com/watch?v=xxx` | `youtube.com` (トップ) |
| Reddit | `reddit.com/r/sub/comments/xxx` | `reddit.com` (トップ) |
| Spotify | `open.spotify.com/track/xxx` | `spotify.com` (トップ) |
| CSS-Tricks | `css-tricks.com/article-slug` | `css-tricks.com` (トップ) |

Slatogのユースケースでは、ユーザーが共有するURLが個別コンテンツ（ツイート、動画、記事）であるケースは多いため、oEmbedは実用的なフォールバック手段である。

## 分析

### v1 (iframe のみ) vs v2 (iframe + oEmbed) 比較

| 指標 | v1 | v2 | 改善 |
|------|-----|-----|------|
| プロキシ不要の対応率 | 18.0% | 28.0% | +10.0pt |
| 非対応 (プロキシ必要) | 82.0% | 72.0% | -10.0pt |

oEmbed追加により、Twitter/X・YouTube・Reddit・Spotify・CSS-Tricksの5サイトが新たにプロキシ不要で対応可能になった。特にTwitter/XとYouTubeはSlatogの主要ユースケース（SNS投稿や動画の共同視聴）に直結する。

### 4段階フォールバック方式の対応率

| フォールバック段階 | 累積対応率 | 追加サーバ負荷 |
|---|---|---|
| 1. iframe直接 | 18.0% | なし |
| 2. oEmbedラッパー | 28.0% | 極小 (oEmbed API呼び出しのみ) |
| 3. ヘッダ除去プロキシ | 100% (理論上) | 中 (HTML取得+ヘッダ加工) |
| 4. Puppeteerスクリーンショット | 100% | 大 (ヘッドレスブラウザ) |

プロキシOFFの場合: 28%のサイトが対応可能（ドキュメント系 + 主要SNS/動画の個別コンテンツ）。
プロキシONの場合: 理論上100%のサイトが対応可能。

## 判定

oEmbedの追加によりプロキシ不要の対応率が18% → 28%に改善したが、依然として72%のサイトが非対応。ADR-001の判定基準（40%未満）は変わらず、プロキシ方式の必要性は維持される。

ただし、oEmbedは**プロキシなしでTwitter/X・YouTubeに対応できる**点で大きな価値がある。プロキシをデフォルトOFFとする運用において、ドキュメント閲覧 + SNS投稿/動画共有という主要ユースケースをカバーできる。
