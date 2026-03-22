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
make install
```

## 開発

```bash
# サーバ起動（ポート3000）
npm run dev

# クライアント開発サーバ（別ターミナル、Vite devサーバ）
npm run dev:client
```

開発時はVite devサーバが`/api`と`/signaling`をサーバ（localhost:3000）にプロキシします。

## コマンド

```bash
make test          # テスト実行
make lint          # リント
make format        # フォーマット
make install       # 依存パッケージインストール
npm run typecheck  # 型チェック
npm run build      # プロダクションビルド
```

## プロジェクト構成

```
├── client/
│   ├── landing/          # ランディングページ（URL入力 + ルーム一覧）
│   │   ├── index.html
│   │   └── main.ts
│   ├── room/             # ルームページ（WebRTC接続 + 3D空間）
│   │   ├── index.html
│   │   ├── main.ts
│   │   ├── signaling-client.ts   # WebSocketシグナリングクライアント
│   │   └── peer-manager.ts       # WebRTC PeerConnection管理
│   └── styles.css
├── server/
│   ├── index.ts          # サーバエントリポイント
│   ├── api.ts            # [B] REST API
│   ├── signaling.ts      # [C] WebSocketシグナリング
│   ├── store.ts          # [D] KVストア（InMemoryRoomStore）
│   ├── proxy.ts          # [E] ヘッダ除去プロキシ
│   └── proxy-utils.ts    # プロキシユーティリティ
├── shared/
│   ├── config.ts         # クライアント環境変数設定
│   └── protocol.ts       # シグナリングプロトコル型定義
└── doc/
    ├── adr/              # 設計仕様（ADR）
    └── fs/               # Feasibility Study成果物
```

## シグナリングプロトコル

WebSocket `/signaling` で以下のメッセージを交換します:

### クライアント → サーバ

| メッセージ | 説明 |
|-----------|------|
| `JOIN_ROOM` | ルーム参加（urlKey, peerId, peerName） |
| `LEAVE_ROOM` | ルーム離脱 |
| `SDP_OFFER` | SDP Offerの中継 |
| `SDP_ANSWER` | SDP Answerの中継 |
| `ICE_CANDIDATE` | ICE Candidateの中継 |

### サーバ → クライアント

| メッセージ | 説明 |
|-----------|------|
| `ROOM_JOINED` | ルーム参加完了（roomId, 既存ピア一覧, ホスト情報） |
| `PEER_JOINED` | 新ピア参加通知 |
| `PEER_LEFT` | ピア離脱通知 |
| `SDP_OFFER` / `SDP_ANSWER` | SDP中継 |
| `ICE_CANDIDATE` | ICE Candidate中継 |
| `HOST_MIGRATION` | ホスト移行通知 |
| `ERROR` | エラー通知 |

## API

| エンドポイント | 説明 |
|--------------|------|
| `GET /api/rooms` | アクティブなURL一覧（ピア数降順） |
| `GET /api/rooms/:urlKey` | 特定URLのセッション一覧 |
| `GET /api/proxy/check?url=...` | URL埋め込み可否チェック |
| `GET /api/proxy?url=...` | ヘッダー除去プロキシ（要 `SLATOG_PROXY=1`） |
| `WebSocket /signaling` | シグナリング（SDP交換、ICE中継） |

## 実装状況

### Phase 1: コア通信基盤

- [x] LP用・ルーム画面用エントリポイント分離（Vite MPA構成）
- [x] 環境変数config（API_BASE, WS_SIGNALING）
- [x] KVインターフェース + InMemoryRoomStore実装
- [x] REST API（GET /api/rooms、GET /api/rooms/:urlKey）
- [x] シグナリングサーバ（SDP交換、ICE中継、JOIN/LEAVE、HOST_MIGRATION）
- [x] LP骨格UI（URL入力 → ルーム遷移、アクティブルーム一覧表示）
- [x] WebRTC接続確立（DataChannel: reliable `state` + unreliable `realtime`）
- [x] プロキシモジュール（埋め込み可否チェック + ヘッダ除去プロキシ）

### Phase 2〜5: 未着手

- [ ] Three.js 3D空間 + Webページ表示
- [ ] マルチプレイ同期（CRDT、アバター、ペン、チャット）
- [ ] ルーム管理 + LP完成
- [ ] 統合テスト + UX改善

## 設計仕様

詳細な設計仕様（ADR）は [`doc/adr/`](doc/adr/) を参照してください。

## ライセンス

ISC
