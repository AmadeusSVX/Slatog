# Slatog

**Slate + Together** — URLを中心に人が集まり、3D空間上でWebページを共同閲覧・チャット・描画するブラウザベースのマルチプレイコラボレーションルーム。

## 概要

Slatogは、特定のURLをキーとしてルームを生成し、最大10人のユーザーがThree.jsベースの3D空間内で以下のコミュニケーションを行えるWebアプリケーションです:

- **Webページ共同閲覧** — CSS3DRenderer + iframeで3D空間内にWebページを配置
- **テキストチャット** — 3Dアバター吹き出し + 2Dチャットウィンドウの二重表示
- **ペン描画** — 3D空間内でのフリーハンド描画
- **アバター移動** — 20Hz更新のリアルタイム位置同期

## アーキテクチャ

### P2P通信

- **WebRTC DataChannel** によるブラウザ間直接通信（サーバコスト最小化）
- **フルメッシュトポロジ** — 最大10人、2チャネル構成:
  - `state`（reliable, ordered）: チャット、ペンストローク、スクロール位置等
  - `realtime`（unreliable, unordered）: アバター位置・回転の20Hz更新
- **CRDT分散状態管理** — 全ピアが状態を保持、ホストマイグレーション時の状態転送不要

### サーバ（シグナリング + ルームディスカバリ）

- **Node.js + Express + ws** — シグナリング、REST API、静的ファイル配信を単一プロセスで提供
- **インメモリKVストア** — セッション管理（URL → ルーム群のインデックス付き）
- **リバースプロキシ** — iframe埋め込み不可サイト向けのヘッダー除去プロキシ（`SLATOG_PROXY=1`で有効化）

### クライアント

- **Vite** によるマルチページ構成（ランディングページ + ルームページ）
- **Three.js** — 3Dレンダリング（WebGL + CSS3DRenderer）

### ルーム状態

- 64KB上限のバジェット管理（メタデータ1KB + チャット16KB + ストローク残り）
- Last Write Wins (LWW) による競合解決

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| ランタイム | Node.js |
| 言語 | TypeScript |
| サーバ | Express 5, ws |
| クライアント | Vite, Three.js |
| P2P | WebRTC DataChannel |
| テスト | Vitest |
| リンター | ESLint, Prettier |

## セットアップ

```bash
npm install
```

## 開発

```bash
# サーバ起動
npm run dev

# クライアント開発サーバ（別ターミナル）
npm run dev:client
```

## コマンド

```bash
npm test          # テスト実行
npm run lint      # リント
npm run format    # フォーマット
npm run typecheck # 型チェック
npm run build     # プロダクションビルド
```

## API

| エンドポイント | 説明 |
|--------------|------|
| `GET /api/rooms` | アクティブなURL一覧（ピア数降順） |
| `GET /api/rooms/:urlKey` | 特定URLのセッション一覧 |
| `GET /api/proxy/check?url=...` | URL埋め込み可否チェック |
| `GET /api/proxy?url=...` | ヘッダー除去プロキシ（要 `SLATOG_PROXY=1`） |
| `WebSocket /signaling` | シグナリング（SDP交換、ICE中継） |

## 設計仕様

詳細な設計仕様（ADR）は [`doc/adr/`](doc/adr/) を参照してください。

## ライセンス

ISC
