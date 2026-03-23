# Slatog

**Slate + Together** — URLを中心に人が集まり、3D空間上でWebページを共同閲覧・チャット・描画するブラウザベースのマルチプレイコラボレーションルーム。

## 概要

Slatogは、特定のURLをキーとしてルームを生成し、最大10人のユーザーがThree.jsベースの3D空間内で以下のコミュニケーションを行えるWebアプリケーションです:

- **Webページ共同閲覧** — CSS3DRenderer + iframeで壁面にWebページを配置
- **テキストチャット** — 3Dアバター吹き出し + 2Dチャットウィンドウの二重表示（環境変数でON/OFF切替可能）
- **テキストステッカー** — 3D空間の壁面にテキストを貼り付けるコミュニケーション手段（最大32文字）
- **プリミティブ配置** — 3D空間に基本形状（円錐・立方体・球・円筒）を配置
- **ペン描画** — 3D空間内でのフリーハンド描画（Line2 + LineMaterial、太い線幅対応）
- **アバター移動** — 20Hz更新のリアルタイム位置同期（ユーザーカラー統一）
- **ユーザー識別** — localStorage永続化によるユーザー名・ID管理
- **セッション永続化** — サーバサイドステートキャッシュによる状態復元

## アーキテクチャ

### P2P通信

- **WebRTC DataChannel** によるブラウザ間直接通信（サーバコスト最小化）
- **フルメッシュトポロジ** — 最大10人、2チャネル構成:
  - `state`（reliable, ordered）: チャット、ペンストローク、スクロール位置等
  - `realtime`（unreliable, unordered）: アバター位置・回転の20Hz更新
- **CRDT分散状態管理** — 全ピアが状態を保持、ホストマイグレーション時の状態転送不要

### サーバ（シグナリング + ルームディスカバリ + ステートキャッシュ）

- **Node.js + Express + ws** — シグナリング、REST API、静的ファイル配信を単一プロセスで提供
- **インメモリKVストア** — セッション管理（URL → ルーム群のインデックス付き）+ ステートキャッシュ
- **リバースプロキシ** — iframe埋め込み不可サイト向けのヘッダー除去プロキシ（`SLATOG_PROXY=1`で有効化）
- **セッション自動削除** — TTLベースの非アクティブセッション削除（`SLATOG_SESSION_TTL`環境変数）

### クライアント

- **Vite** によるマルチページ構成（ランディングページ + ルームページ）
- **Three.js** — 3Dレンダリング（WebGL + CSS3DRenderer）
- **物理ルーム空間** — 壁・床・天井で囲まれた部屋、ライティング、カメラ制限

### ルーム状態

- 64KB上限のバジェット管理（メタデータ1KB + 63KB共有プール: チャット・ステッカー・ストローク・プリミティブ・BANリスト）
- Last Write Wins (LWW) による競合解決
- ステッカー連投規制（レートリミット）+ 自動BANシステム

## 技術スタック

| カテゴリ     | 技術               |
| ------------ | ------------------ |
| ランタイム   | Node.js            |
| 言語         | TypeScript         |
| サーバ       | Express 5, ws      |
| クライアント | Vite, Three.js     |
| P2P          | WebRTC DataChannel |
| テスト       | Vitest             |
| リンター     | ESLint, Prettier   |

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

## 環境変数

| 変数                           | デフォルト | 説明                                                 |
| ------------------------------ | ---------- | ---------------------------------------------------- |
| `PORT`                         | `3000`     | サーバリッスンポート                                 |
| `SLATOG_PROXY`                 | (無効)     | `1`に設定でプロキシ有効化                            |
| `SLATOG_CHAT`                  | `1`        | `0`に設定でチャット機能無効化                        |
| `SLATOG_SESSION_TTL`           | `-1`       | 非アクティブセッション自動削除までの秒数（-1で無効） |
| `SLATOG_STATE_SYNC_INTERVAL`   | `30000`    | ステートキャッシュ送信間隔（ms、クライアント側設定） |
| `SLATOG_STICKER_RATE_WINDOW`   | `30`       | ステッカー連投監視ウィンドウ（秒）                   |
| `SLATOG_STICKER_RATE_LIMIT`    | `5`        | ウィンドウ内最大ステッカー投稿数                     |
| `SLATOG_STICKER_BAN_ENABLED`   | `1`        | 自動BAN有効/無効（0で無効）                          |
| `SLATOG_STICKER_BAN_THRESHOLD` | `2`        | BAN発動までの規制回数                                |
| `SLATOG_STICKER_BAN_MODE`      | `ban`      | `kick`（再接続可）or `ban`（IP BAN）                 |
| `SLATOG_STICKER_BAN_DURATION`  | `3600`     | BAN持続時間（秒、0で永久BAN）                        |

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
│   ├── auth.ts              # D14 ユーザー識別（AuthProvider + localStorage）
│   ├── landing/             # ランディングページ（URL入力 + ルーム一覧）
│   │   ├── index.html
│   │   └── main.ts
│   ├── room/                # ルームページ（WebRTC接続 + 3D空間 + マルチプレイ）
│   │   ├── index.html
│   │   ├── main.ts                # ルームエントリポイント（全モジュール統合）
│   │   ├── scene.ts               # D16 物理ルーム空間 + Three.js二重レンダラー
│   │   ├── iframe-embed.ts        # D12+D13+D16 ハイブリッドiframe壁面埋め込み
│   │   ├── embed-url.ts           # D13 既知サービスembed URL変換
│   │   ├── scroll-sync.ts         # D4 スクロール共有（LWW + 100msデバウンス）
│   │   ├── signaling-client.ts    # WebSocketシグナリングクライアント
│   │   ├── peer-manager.ts        # WebRTC PeerConnection管理
│   │   ├── avatar.ts              # D15 アバター3D表示 + ユーザーカラー
│   │   ├── chat.ts                # D15 チャットUI + ユーザーカラー
│   │   ├── chat-bubble.ts         # 3D吹き出し（SpriteMaterial + CanvasTexture）
│   │   ├── pen.ts                 # D15+D17+D21+D29 ペン描画（Line2 + LineMaterial + 壁面クランプ + 近距離描画）
│   │   ├── primitive.ts           # D31+D32 プリミティブ配置（Raycast + MeshStandardMaterial + 壁面クランプ）
│   │   └── sticker.ts             # D23+D24+D30+D33 テキストステッカー（CanvasTexture + Raycast配置 + フォントサイズ調整 + 32文字制限）
│   └── styles.css
├── server/
│   ├── index.ts          # サーバエントリポイント + D20 TTLタイマー
│   ├── api.ts            # [B] REST API + D18 ステートキャッシュAPI
│   ├── signaling.ts      # [C] WebSocketシグナリング + D14 userId
│   ├── store.ts          # [D] KVストア（D18 stateCache, D20 deleteExpiredSessions）
│   ├── proxy.ts          # [E] ヘッダ除去プロキシ
│   └── proxy-utils.ts    # プロキシユーティリティ
├── shared/
│   ├── colors.ts        # D15 ユーザーカラーパレット（10色）
│   ├── config.ts        # クライアント環境変数設定
│   ├── protocol.ts      # シグナリングプロトコル型定義（D14 userId追加）
│   ├── data-protocol.ts # DataChannelメッセージ型定義（D15 colorIndex追加）
│   ├── crdt.ts          # CRDT（LWWRegister, LWWMap）
│   └── room-state.ts    # ルーム状態管理 + 64KBバジェット
└── doc/
    ├── adr/             # 設計仕様（ADR）
    └── fs/              # Feasibility Study成果物
```

## シグナリングプロトコル

WebSocket `/signaling` で以下のメッセージを交換します:

### クライアント → サーバ

| メッセージ      | 説明                                           |
| --------------- | ---------------------------------------------- |
| `JOIN_ROOM`     | ルーム参加（urlKey, peerId, peerName, userId） |
| `LEAVE_ROOM`    | ルーム離脱                                     |
| `SDP_OFFER`     | SDP Offerの中継                                |
| `SDP_ANSWER`    | SDP Answerの中継                               |
| `ICE_CANDIDATE` | ICE Candidateの中継                            |
| `STICKER_ADD`   | ステッカー貼付通知（レートリミット用）         |

### サーバ → クライアント

| メッセージ                 | 説明                                               |
| -------------------------- | -------------------------------------------------- |
| `ROOM_JOINED`              | ルーム参加完了（roomId, 既存ピア一覧, ホスト情報） |
| `PEER_JOINED`              | 新ピア参加通知（peerId, peerName, userId）         |
| `PEER_LEFT`                | ピア離脱通知                                       |
| `SDP_OFFER` / `SDP_ANSWER` | SDP中継                                            |
| `ICE_CANDIDATE`            | ICE Candidate中継                                  |
| `HOST_MIGRATION`           | ホスト移行通知                                     |
| `ERROR`                    | エラー通知                                         |
| `STICKER_RATE_LIMITED`     | ステッカー連投規制通知                             |
| `STICKER_BANNED`           | ステッカースパムによるBAN通知                      |

## API

| エンドポイント                  | 説明                                                    |
| ------------------------------- | ------------------------------------------------------- |
| `GET /api/rooms`                | URL一覧（アクティブ優先、ピア数降順、非アクティブ含む） |
| `GET /api/rooms/:urlKey`        | 特定URLのセッション一覧 + features（chat_enabled等）    |
| `POST /api/rooms/:roomId/state` | ステートキャッシュ送信（ホストから30秒間隔）            |
| `GET /api/rooms/:roomId/state`  | ステートキャッシュ取得（セッション復元用）              |
| `GET /api/proxy/check?url=...`  | URL埋め込み可否チェック                                 |
| `GET /api/proxy?url=...`        | ヘッダー除去プロキシ（要 `SLATOG_PROXY=1`）             |
| `WebSocket /signaling`          | シグナリング（SDP交換、ICE中継）                        |

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

### Phase 2: 3D空間 + Webページ表示

- [x] Three.js空間セットアップ（CSS3DRenderer + WebGLRenderer二重構成）
- [x] depth maskテクニック（FS-2結果反映: colorWrite=false, depthWrite=true, renderOrder=-1）
- [x] iframe埋め込み（D12ハイブリッド: proxy/check → 直接 or プロキシ経由）
- [x] カメラ操作（OrbitControls）
- [x] スクロール共有（LWW、100msデバウンス、DataChannel state経由）
- [x] D16: 物理ルーム空間（壁・床・天井 + MeshStandardMaterial + ライティング + カメラ制限）
- [x] D17: ペンストローク線幅改善（Line2 + LineMaterial、デフォルト5px）
- [x] D21: ペンストローク壁面クランプ（描画座標をルーム内にクランプ、Zファイティング防止マージン）

### Phase 3: マルチプレイ同期

- [x] ルーム状態CRDT実装（LWWRegister, LWWMap）
- [x] DataChannelメッセージプロトコル定義（state + realtimeチャネル）
- [x] 64KBステートバジェット管理（63KB共有プール: 優先度ベース削除 chat→sticker→stroke→bannedIps）
- [x] アバター位置同期（unreliableチャネル、20Hz、球体メッシュ + 名前ラベル）
- [x] テキストチャット同期（reliableチャネル、280文字制限）
- [x] チャットウィンドウUI（2D HTML/CSS、画面左下固定パネル）
- [x] 3D吹き出し表示（SpriteMaterial + CanvasTexture、5秒フェードアウト）
- [x] ペンストローク同期（reliableチャネル、3D空間内フリーハンド描画）
- [x] 途中参加者へのスナップショット送信（チャット履歴・ストローク含む）
- [x] D18: サーバサイドステートキャッシュ（ホストから30秒間隔で送信）
- [x] D22: チャット機能トグル（環境変数`SLATOG_CHAT` + features API + クライアント側UI制御）
- [x] D23: テキストステッカー同期（reliableチャネルでのステッカー送受信）

### Phase 2への追加（3D空間 + Webページ表示）

- [x] D23: テキストステッカー描画（CanvasTexture + PlaneGeometry + Raycast壁面配置）
- [x] D24: ステッカーユーザー名表示トグル（localStorage設定 + 設定パネルUI）

### Phase 4: ルーム管理 + LP完成

- [x] D14: ユーザー名設定 + localStorage永続化 + AuthProviderインターフェース
- [x] D15: ユーザーカラー自動割り当て（10色パレット、アバター/チャット/ストローク統一色）
- [x] D19: セッション復元（参加者0のセッション表示 + ステートリストア）
- [x] D20: セッション自動削除（TTLベース、`SLATOG_SESSION_TTL`環境変数）

### Phase 5: ライティング・ステッカー改善・荒らし対策（ADR-004）

- [x] D25: ディレクショナルライト強度復元（0.3→0.6）
- [x] D26: テキストステッカー背景透過・枠線なし・テキストアウトライン追加
- [x] D27: ステッカー貼付後のテキストボックスクリア（荒らし連打防止）
- [x] D28: ステッカー連投規制（サーバ側レートリミット）+ 自動BANシステム
- [x] D28: enforcebudget優先度ベース削除（chat→sticker→stroke→bannedIps）

### Phase 6: ペン描画距離・フォントサイズ調整（ADR-005）

- [x] D29: ペン描画距離の短縮（Raycaster far=100、空中描画対応、壁面クランプ維持）
- [x] D30: テキストステッカーフォントサイズ変更（スライダーUI、localStorage保存、CanvasTexture動的計算）

### Phase 7: プリミティブ配置・ステッカー制限縮小（ADR-006）

- [x] D31: プリミティブ配置UI（4種選択 + Raycast配置 + MeshStandardMaterial + 壁面クランプ）
- [x] D32: プリミティブのRoomState追加・reliableチャネルでの同期・64KBバジェット管理
- [x] D33: テキストステッカー文字数制限を140文字→32文字に縮小

### Phase 8: 未着手

- [ ] 統合テスト + UX改善

## 設計仕様

詳細な設計仕様（ADR）は [`doc/adr/`](doc/adr/) を参照してください。

- [ADR-001](doc/adr/ADR-001-slatog.md) — 初期アーキテクチャ（WebRTC, CRDT, シグナリング, プロキシ等）
- [ADR-002](doc/adr/ADR-002-enhancements.md) — ユーザー識別・ルーム空間・セッション永続化
- [ADR-003](doc/adr/ADR-003-text-sticker.md) — チャットトグル・テキストステッカー・ユーザー名表示設定
- [ADR-004](doc/adr/ADR-004-sticker-fixes.md) — ライティング復元・テキストステッカー改善・荒らし対策
- [ADR-005](doc/adr/ADR-005-pen-range-and-font-size.md) — ペン描画距離の短縮・テキストステッカーフォントサイズ調整
- [ADR-006](doc/adr/ADR-006-primitives-and-sticker-limit.md) — プリミティブ配置モードとテキストステッカー文字数制限

## ライセンス

ISC
