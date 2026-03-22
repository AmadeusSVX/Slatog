# ADR-001: Slatog — URL共有型マルチプレイ3Dコラボレーションルームのアーキテクチャ

## ステータス

**提案中（Proposed）** — Feasibility Study Phase

## 日付

2026-03-18

## プロジェクト名

**Slatog**（仮称） — Slate（石板）+ Together（一緒に）の短縮形。読み: スレトグ。URLを中心に人が集まり、3D空間上で共同閲覧・描画・チャットを行うサービス。

## コンテキスト

Slatog は、特定のURLをキーとしてルームを生成し、複数ユーザーがThree.jsベースの3D空間内でWebページを共同閲覧・テキストチャット・ペン描画・アバター移動によるコミュニケーションを行うブラウザベースアプリケーションである。サーバコストを最小化するため、P2P方式を採用し、サーバ側はシグナリングとルームディスカバリのみを担う。

## 決定事項

### D1: 接続方式 — WebRTC DataChannel + シグナリングサーバ

ブラウザのセキュリティサンドボックスにより生UDPソケットは使用不可であるため、P2P通信にはWebRTC DataChannelを採用する。シグナリングサーバはSDP交換・ICE candidate中継・ルームディスカバリを担い、接続確立後のデータ通信はブラウザ間で直接行う。

IPアドレスの直接公開は行わず、WebRTCの標準的な接続確立フロー（ICE/STUN/TURN）に従う。

**根拠**: ブラウザベース＋P2Pの両前提を満たす唯一の選択肢である。WebRTC DataChannelのunreliableモード（maxRetransmits=0, ordered=false）は生UDPに十分近い特性を持ち、性能上の不都合はない。WebTransportはクライアント-サーバ型でありP2Pアーキテクチャに適合しない。

### D2: P2Pトポロジ — フルメッシュ（上限10人）

プロトタイプフェーズでは上限10人のフルメッシュ（最大45接続）を採用する。DataChannelのデータ通信のみ（映像・音声なし）であるため、帯域消費は各ピア100KB/s以下に収まる見込み。

各接続に2つのDataChannelを開設する:

- `state`（reliable, ordered）: ペンストローク、チャットメッセージ、スクロール位置、ホストマイグレーション、参加/離脱通知
- `realtime`（unreliable, unordered）: アバター位置・回転の20Hz更新

**根拠**: 10人規模ではフルメッシュの接続数が許容範囲であり、ツリー型やSFU型の複雑性を回避できる。将来の32〜64人スケールでは階層型メッシュまたは軽量SFUへの移行を前提とする。

### D3: 状態管理 — CRDT分散保持

ルーム状態は全参加者が保持する。ホストは「シグナリングサーバとの窓口」に役割を限定し、特権的な状態管理者としない。

ルーム状態の構造:

```
RoomState {
  url_key: string
  scroll_position: LWWRegister<{x, y}>
  strokes: LWWMap<stroke_id, Stroke>
  chat_messages: LWWMap<msg_id, ChatMessage>
  peers: Map<peer_id, PeerState>
  host_peer_id: string
}

ChatMessage {
  id: string                // UUID v4
  author_peer_id: string
  author_name: string       // 送信時点の表示名（ピア離脱後も表示可能にするため）
  text: string              // UTF-8、最大280文字
  timestamp: number         // Unix ms — LWW用・削除優先度用
}
```

**根拠**: 状態を分散保持することで、ホストマイグレーション時の状態転送が不要になる。新ホストは「窓口役」を引き継ぐだけで済む。

### D4: スクロール競合解決 — Last Write Wins (LWW)

全参加者がWebページのスクロール操作可能とし、競合解決はタイムスタンプに基づくLWWとする。100msデバウンス付き。

**根拠**: プロトタイプフェーズではシンプルさを優先する。UXの問題が顕在化した場合は「最後にスクロールした人のカーソルを表示」「ロック機構」等の改善を検討する。

### D5: ルームステート上限 — 64KBバジェット管理

ルーム状態全体（ストローク＋チャット履歴＋メタデータ）のシリアライズサイズを64KB以下に制限する。データ種別ごとに以下のバジェット配分とする:

```
64KB (65,536 bytes) 総バジェット
├── メタデータ（url_key, scroll_position, peers, host_peer_id）: 1KB固定確保
├── チャット履歴: 16KB上限
└── ペンストローク: 残り全量（約47KB）
```

**チャット履歴の削除ポリシー**: チャット領域が16KBを超過した場合、最も古いタイムスタンプのメッセージから逐次削除する。1メッセージあたりの最大サイズはヘッダ含め約350byte（280文字UTF-8 + メタデータ）であり、16KB枠で直近約45件を保持可能。

**ペンストロークの削除ポリシー**: ストローク領域が残余バジェット（総量 - メタデータ - 実チャット使用量）を超過した場合、最も古いタイムスタンプのストロークから逐次削除する。

**バジェット計算の決定的アルゴリズム**:

```
function enforcebudget(state):
  meta_size = serialize(state.meta).byteLength        // ≤ 1KB
  chat_size = serialize(state.chat_messages).byteLength
  stroke_size = serialize(state.strokes).byteLength

  // Phase 1: チャット枠の強制（16KB上限）
  while chat_size > 16384:
    remove oldest chat_message by timestamp
    chat_size = serialize(state.chat_messages).byteLength

  // Phase 2: ストローク枠の強制（残余バジェット）
  stroke_budget = 65536 - meta_size - chat_size
  while stroke_size > stroke_budget:
    remove oldest stroke by timestamp
    stroke_size = serialize(state.strokes).byteLength
```

全ピアが同一データと同一アルゴリズムで独立に削除判定を実行するため、結果整合性により収束する。

**根拠**: 64KBはWebRTC DataChannelの単一SCTPメッセージの実効上限に近く、途中参加者への状態スナップショット送信が1メッセージで完結する。チャットとストロークで固定分割せず、チャットに上限を設けた上でストロークに残りを割り当てることで、チャットが少ないルームでは描画に多くの容量を使える柔軟性を持たせている。

### D6: Webページ表示 — CSS3DRenderer + iframe

Three.jsのCSS3DRendererを用いてiframeを3D空間内にDOM要素として直接配置する。WebGLRendererと同一カメラで重ねて描画し、アバター・ペンストローク等はWebGL側で描画する。

**根拠**: テクスチャ化方式（html2canvas等）はSame-Origin Policyにより大半の外部サイトで機能しない。CSS3DRendererであればiframeをそのまま配置でき、ページのインタラクティブ性を維持できる。

### D7: ホストマイグレーション — シグナリングサーバ主導

ホストのWebSocket切断をシグナリングサーバがping/pongタイムアウト（15秒）で検知し、残存ピアリストからpeer_idの辞書順最小のピアを新ホストに選出する。選出結果をシグナリングサーバから全ピアに通知し、KVを更新する。

**根拠**: リーダー選出をサーバ側で行うことで、P2Pネットワーク上での分散合意の実装を回避する。状態はD3により全ピアが保持しているため、マイグレーション時の状態転送は発生しない。

### D8: シグナリングサーバ技術選定

プロトタイプ: Node.js + `ws` + インメモリMap

```
KVスキーマ（セッション単位）:
  key: room_id (string, UUID)   // セッション固有ID
  value: {
    url_key: string             // 対象URL（同一URLに複数セッション可）
    peers: string[]             // 接続中のpeer_idリスト
    host_peer_id: string
    peer_count: number
    created_at: number          // Unix ms
  }

インデックス（インメモリMapで実装）:
  url_key → [room_id, room_id, ...]   // 逆引き用
```

本番移行時: Redis KV + Cloudflare Workers / Durable Objects を検討。

### D9: テキストチャット — 3D吹き出し + チャットウィンドウ二重表示

参加者はテキストメッセージを送信でき、以下の2箇所に同時表示する:

1. **3D空間内の吹き出し**: 送信者のアバター上部にスプライトまたはCSS3Dオブジェクトとして表示。一定時間（5秒）後にフェードアウト。直近1件のみ表示。
2. **チャットウィンドウ（2D UI）**: 画面端に固定配置されたHTML/CSSのチャットパネル。スクロール可能な履歴表示。途中参加者にもルーム状態内のチャット履歴が表示される。

**吹き出しの実装方式**:

```
方式A: WebGL SpriteMaterial + CanvasTexture
  - Canvas2Dでテキストを描画 → テクスチャ化 → Spriteとしてアバター上部に配置
  - メリット: WebGLデプスバッファに統合、他オブジェクトとの前後関係が正確
  - デメリット: テキスト更新のたびにテクスチャ再生成（軽微なコスト）

方式B: CSS3DObject
  - HTMLのdiv要素をCSS3DRendererで配置
  - メリット: テキストレンダリングが高品質、スタイリング自由度が高い
  - デメリット: iframe同様にWebGLとの深度整合問題あり（FS-2の結果に依存）
```

プロトタイプでは方式Aを採用する。FS-2で前面描画が可能と判明した場合は方式Bへの切り替えを検討する。

**メッセージ送信フロー**:

```
1. ユーザーがチャット入力欄でEnter押下
2. ChatMessageオブジェクト生成（UUID, peer_id, name, text, timestamp）
3. ローカルのRoomState.chat_messagesに追加
4. reliableチャネルで全ピアにCHAT_MSG送信
5. ローカル: チャットウィンドウに追記 + アバター吹き出し表示（5秒タイマー開始）
6. 受信側: 同じ処理をリモートアバターに対して実行
7. enforcebudget()によりチャット16KB超過時は古いメッセージを削除
   （削除はチャットウィンドウの表示からも除去される）
```

**入力文字数制限**: 1メッセージ最大280文字。吹き出し表示では3行を超える場合は末尾を省略（"..."）し、チャットウィンドウでは全文表示する。

**根拠**: 3D空間内の吹き出しにより「誰が発言しているか」が空間的に直感把握でき、チャットウィンドウにより履歴の追跡と途中参加者のキャッチアップが可能になる。チャット履歴を64KBステートに含めることで、途中参加者への状態スナップショットにチャット履歴が自動的に含まれ、追加の同期機構が不要となる。

### D10: ランディングページ + ルームディスカバリUI

シグナリングサーバと同一プロセスでLPを配信する。LPはサービスの入口であり、ルームの発見と参加・新規作成を担う。

**LP表示内容**:

```
┌─────────────────────────────────────────────┐
│  Slatog                                 │
│  ─────────────────────────────────           │
│  URLを入力して新しいルームを開始:                  │
│  [ https://example.com/article    ] [開始]     │
│                                               │
│  ─── アクティブなルーム ───                      │
│                                               │
│  1. https://en.wikipedia.org/wiki/...          │
│     👥 8人 · セッション 2個                      │
│     [参加する]                                  │
│                                               │
│  2. https://news.ycombinator.com               │
│     👥 5人 · セッション 1個                      │
│     [参加する]                                  │
│                                               │
│  3. https://example.com/blog/post-1            │
│     👥 3人 · セッション 1個                      │
│     [参加する]                                  │
│  ...                                          │
└─────────────────────────────────────────────┘
```

**ランキングデータの取得**: KVストア内の全ルームエントリを参照し、同一url_keyを持つセッションの合計peer_countで降順ソートする。LPはポーリング（10秒間隔）またはWebSocket経由でリアルタイム更新する。

**KVスキーマの拡張**: D8のKVスキーマを維持したまま、ランキング生成に必要なデータはKVの全エントリ走査で取得する。プロトタイプ（インメモリMap）では全件走査のコストは無視できる。本番移行時にRedis Sorted Setなどへの最適化を検討する。

```
ランキング生成（擬似コード）:
  entries = kv.getAll()
  grouped = groupBy(entries, e => e.url_key)
  ranking = grouped.map(g => {
    url_key: g.key,
    total_peers: sum(g.sessions.map(s => s.peer_count)),
    session_count: g.sessions.length
  })
  ranking.sort(by total_peers DESC)
```

**URL入力→参加フロー**:

```
1. ユーザーがURL入力欄にURLを入力し「開始」押下
   OR ランキングの「参加する」を押下
2. LP → シグナリングサーバ: GET /api/rooms?url_key={encoded_url}
3a. 既存セッションあり（かつ空きあり）:
    → クライアントをルーム画面に遷移、WebSocket接続開始、JOIN_ROOMフロー（D1）へ
3b. 既存セッションあり（全セッション満員）:
    → 新規セッション作成、自動的にホストとなる
3c. セッションなし:
    → 新規ルーム＋セッション作成、自動的にホストとなる
```

**サーバ構成**: D11で定義する単一プロセス構成に従う。LP配信・REST API・WebSocketシグナリングを同一サーバで提供する。

**プレビュー表示（将来オプション）**: ランキング内の各URLについてサムネイル画像を表示する。実装方式はFS-1の結果に依存する（iframe埋め込み可能ならミニiframe、不可ならサーバサイドスクリーンショット）。プロトタイプではURL文字列のみの表示とする。

**根拠**: ルームディスカバリUIとシグナリングサーバの同居は、D11の「分離可能なモノリス」方針に沿う。REST APIを経由するレイヤー分離により、将来のスケール時にフロントエンドとバックエンドを独立にデプロイ可能な構造を初期から確保している。

### D11: 単一サーバ完結構成と将来の分離戦略

プロトタイプでは1台のNode.jsプロセスが全機能を担う。ただし、コード構造とプロトコル設計の段階で将来の分離境界を意識し、各レイヤー間の結合を最小化する。

**プロトタイプ構成（単一プロセス）**:

```
Node.js プロセス
│
├── [A] 静的アセット配信
│   ├── /                     → LP（HTML + CSS + JS バンドル）
│   ├── /room/:url_key        → ルーム画面（HTML + CSS + JS バンドル）
│   └── /assets/*             → 共有アセット（Three.js, アバターモデル等）
│
├── [B] REST API
│   ├── GET  /api/rooms       → ランキング（全ルーム集計）
│   ├── GET  /api/rooms/:url_key → 特定URLのセッション一覧
│   └── POST /api/rooms       → 新規ルーム作成要求
│
├── [C] WebSocketシグナリング
│   └── ws://host/signaling   → SDP交換, ICE中継, JOIN/LEAVE, HOST_MIGRATION
│
└── [D] KVストア（インメモリMap）
    ├── sessions: Map<room_id, SessionData>
    └── url_index: Map<url_key, room_id[]>
```

**分離を前提とした設計原則**:

1. **静的アセット[A]はビルド成果物として独立させる**: LP用バンドルとルーム画面用バンドルをそれぞれ独立したエントリポイントとしてビルドする。サーバ側テンプレートエンジン（EJS, Pug等）による動的HTMLレンダリングは使用しない。全ページをSPA（またはMPA）として静的ファイルのみで構成し、動的データはREST API [B]から取得する。
2. **REST API [B]はKV [D]への唯一のアクセス経路とする**: LP・ルーム画面のJavaScriptからKVデータへのアクセスは必ず`/api/rooms`経由とし、サーバ内部でのインメモリ直接参照は[B]のハンドラ内に閉じる。これにより[A]を別ホスト（CDN等）に移してもAPI URLの変更のみで動作する。
3. **WebSocket [C]はシグナリング専用とし、REST APIとステートを共有しない**: WebSocketハンドラからKV [D]への書き込みは行うが、読み取りに関するビジネスロジック（ランキング集計等）はREST API [B]側に集約する。これにより[C]を独立プロセス/サーバに分離した際にも[B]の修正が不要となる。
4. **KV [D]はインターフェースで抽象化する**: インメモリMapへのアクセスを直接行わず、KVインターフェース（get, set, delete, list, getByUrlKey）を定義し、その実装としてインメモリMapを使う。将来のRedis/Cloudflare KV移行時はインターフェース実装の差し替えのみで完了する。

**KVインターフェース定義（プロトタイプ）**:

```typescript
interface RoomStore {
  getSession(roomId: string): SessionData | null
  setSession(roomId: string, data: SessionData): void
  deleteSession(roomId: string): void
  getSessionsByUrl(urlKey: string): SessionData[]
  getAllUrls(): UrlSummary[]  // ランキング用集計
}

// プロトタイプ実装
class InMemoryRoomStore implements RoomStore { ... }

// 将来実装
class RedisRoomStore implements RoomStore { ... }
```

**将来の分離マップ**:

```
Phase: プロトタイプ
  [A] + [B] + [C] + [D] → 単一Node.jsプロセス

Phase: 中規模（数百ルーム）
  [A] → CDN (Cloudflare Pages, Vercel, etc.)
  [B] + [C] + [D] → 単一サーバ（[D]をRedisに移行）

Phase: 大規模（数千ルーム以上）
  [A] → CDN
  [B] → APIサーバ群（水平スケール）
  [C] → シグナリングサーバ群（リージョン分散）
  [D] → マネージドRedis / Cloudflare Durable Objects
```

各フェーズ移行時に必要な変更:

| 移行 | 変更箇所 | 変更内容 |
|---|---|---|
| [A]のCDN分離 | クライアントJS | API/WSのURLを環境変数から取得するよう変更。CORS設定追加 |
| [D]のRedis移行 | サーバ | `InMemoryRoomStore`を`RedisRoomStore`に差し替え |
| [B]と[C]の分離 | サーバ | [C]からのKV書き込みを[B]のREST API経由に変更、または[D]を共有Redis経由でアクセス |
| [C]のリージョン分散 | インフラ | ロードバランサーでWSをリージョン別にルーティング。KVはリージョン間で共有 |

**クライアントJSの環境変数パターン（初期から導入）**:

```javascript
// config.js — ビルド時に環境変数から注入
const SLATOG_CONFIG = {
  API_BASE:      '__API_BASE__'      || '',          // 同一オリジン時は空文字
  WS_SIGNALING:  '__WS_SIGNALING__'  || `ws://${location.host}/signaling`,
  STUN_SERVERS:  ['stun:stun.l.google.com:19302'],
};

// 使用側
fetch(`${SLATOG_CONFIG.API_BASE}/api/rooms`);
new WebSocket(SLATOG_CONFIG.WS_SIGNALING);
```

プロトタイプでは全てデフォルト値（同一オリジン）で動作する。分離時にビルド環境変数を設定するだけで接続先が切り替わる。

**根拠**: 単一サーバ完結はプロトタイプの立ち上げ速度を最大化する。同時に、[A][B][C][D]の責務分離とインターフェース抽象化を初期から行うことで、将来の段階的なスケールアウトにおいて大規模なリファクタリングを回避できる。この「分離可能なモノリス」パターンは、プロダクトの不確実性が高い初期段階で最もコストパフォーマンスの高いアプローチである。

## Feasibility Study計画

アーキテクチャ上の技術リスクを早期に検証するため、P2P通信の実装に先立ち以下の検証を実施する。

### FS-1: iframe埋め込み成功率調査

**目的**: CSS3DRenderer方式の実用性を判定する。埋め込み不可サイトの割合が高い場合、プロキシ方式またはサーバサイドスクリーンショット方式への変更を検討する閾値を設定する。

**手法**: 主要Webサイト50件に対し、`X-Frame-Options`および`Content-Security-Policy: frame-ancestors`ヘッダを調査する。併せて実際にiframe埋め込みを試行し、レンダリング結果を確認する。

**対象サイトカテゴリ**（各10件程度）:

- ニュース/メディア（CNN, BBC, NHK, etc.）
- SNS/コミュニティ（Twitter, Reddit, etc.）
- ドキュメント/Wiki（Wikipedia, MDN, GitHub, etc.）
- EC/サービス（Amazon, YouTube, etc.）
- 技術ブログ/個人サイト

**判定基準**:

| 埋め込み成功率 | 判定 |
|---|---|
| 70%以上 | CSS3DRenderer + iframe方式で進行 |
| 40〜70% | iframe方式を主軸としつつ、フォールバック（プロキシ or スクリーンショット）を並行実装 |
| 40%未満 | プロキシ方式を主軸に切り替え。iframe方式は補助的手段に格下げ |

**成果物**: 調査結果一覧（サイト名、ヘッダ値、埋め込み可否、備考）と判定レポート

**所要時間見込み**: 2〜4時間（調査用HTMLページの作成含む）

### FS-2: CSS3D + WebGL重ね合わせ検証

**目的**: iframe（CSS3DRenderer）とペンストローク/アバター（WebGLRenderer）の重ね合わせ描画が制御可能かを検証する。

**手法**: 単一HTMLファイルで以下の構成を実装し、描画結果を確認する。

```
構成:
  CSS3DRenderer (z-index下層) → iframe表示
  WebGLRenderer (z-index上層, pointer-events: none) → 3Dオブジェクト描画
  同一カメラで同一シーン座標に配置
```

**検証項目**:

1. **前面描画**: WebGLで描画したストロークがiframeの前面に表示されるか
2. **深度整合**: カメラ角度を変えたとき、iframeとWebGLオブジェクトの前後関係が正しく描画されるか
3. **入力イベント**: iframe上でのスクロール・クリックと、iframe外での3Dカメラ操作・ペン入力が共存できるか
4. **パフォーマンス**: 2レンダラー同時稼働時のフレームレート（60fps維持可能か）

**既知のリスク**: CSS3DRendererはDOM要素をCSS transformで配置するため、WebGLのデプスバッファとは独立している。iframe前面へのWebGL描画は標準的な手法では不可能である可能性が高い。

**代替案（検証不合格時）**:

- **案A**: ペンストロークをiframeの裏面・周囲に限定する（前面描画を諦める）
- **案B**: iframe領域にCSS maskを適用し、WebGLオブジェクトが重なる部分のみiframeを非表示にする（疑似的な前後関係）
- **案C**: Webページをサーバサイドレンダリング（Puppeteer）でスクリーンショット化し、WebGLテクスチャとして統一する（コスト増・インタラクティブ性低下と引き換えに描画を完全制御可能）

**成果物**: 検証用HTMLファイルと結果レポート（スクリーンショット付き）

**所要時間見込み**: 3〜5時間

### FS-1/FS-2の結果に基づく次フェーズ判断

```
FS-1: 成功率70%以上  AND  FS-2: 前面描画可能
  → 当初設計のまま進行

FS-1: 成功率70%以上  AND  FS-2: 前面描画不可
  → ペン描画をiframe周囲に限定（案A）で進行

FS-1: 成功率40〜70%  AND  FS-2: 任意
  → フォールバック付きiframe方式で進行

FS-1: 成功率40%未満
  → プロキシ方式を主軸に再設計（追加ADR発行）
```

### FS実施結果（2026-03-21）

**FS-1結果**: 成功率18.0%（9/50サイト）。SNS 0%、EC/サービス 0%、ニュース 10%、ドキュメント 70%、技術ブログ 10%。詳細は `doc/fs/fs1-report.md` を参照。

**FS-2結果**: 全検証項目PASS。depth maskテクニック（`colorWrite: false` + `depthWrite: true` + `renderOrder: -1` の平面メッシュ）により、CSS3DRendererのiframeとWebGLRendererの3Dオブジェクトの深度整合を実現。前面描画・入力イベント共存・60fps維持を確認。詳細は `doc/fs/fs2-report.md` を参照。

**判定**: FS-1成功率40%未満 → 下記D12（プロキシ方式）を追加決定。

### D12: Webページ表示 — ハイブリッドiframe＋ヘッダ除去プロキシ

FS-1/FS-2の結果を受けて、D6（CSS3DRenderer + iframe）を拡張する。

**表示方式の判定フロー**:

```
1. クライアントがURL入力
2. GET /api/proxy/check?url={url}
   サーバがHEADリクエストでX-Frame-Options / frame-ancestorsを確認
3a. embeddable=true  → iframe.src = 元URL（直接埋め込み）
3b. embeddable=false AND プロキシ有効 → iframe.src = /api/proxy?url=...（プロキシ経由）
3c. embeddable=false AND プロキシ無効 → エラー表示「このURLはSlatog非対応です」
```

**プロキシの設計原則**:

- **デフォルトOFF**: プロキシは環境変数 `SLATOG_PROXY=1` で明示的に有効化する。無効時はiframe直接埋め込み可能なサイトのみ対応
- **HTMLのみプロキシ**: HTML本体のみをサーバ経由で取得し、`X-Frame-Options`と`frame-ancestors`を除去。CSS/JS/画像はブラウザが元サーバから直接取得する（`<base href>` タグ挿入による相対パス解決）
- **ナビゲーションインターセプト**: iframe内のリンククリックをプロキシ経由URLにリダイレクトするスクリプトをHTML内に注入
- **キャッシュ**: 同一URL 5分間キャッシュ。同一ルーム内の複数ユーザーはキャッシュヒット
- **SSRF防止**: プライベートIP・localhost・内部ホスト名を拒否

**プロキシ無効時の非対応エラー**:

```
/api/proxy/check レスポンス:
  { embeddable: false, supported: false, url: "...", proxyUrl: null }

クライアント側:
  supported=false の場合、3D空間にiframeを配置せず、
  「このURLはiframe埋め込みが許可されていないため、Slatogでは表示できません」
  というエラーメッセージをUI上に表示する。
```

**サーバ構成（D11更新）**:

```
Node.js プロセス
├── [A] 静的アセット配信
├── [B] REST API
├── [C] WebSocketシグナリング
├── [D] KVストア（インメモリMap）
└── [E] Proxy（デフォルトOFF、SLATOG_PROXY=1で有効化）
    ├── GET /api/proxy/check?url=...  → 埋め込み可否判定（常時有効）
    └── GET /api/proxy?url=...        → ヘッダ除去プロキシ（SLATOG_PROXY=1時のみ）
```

**既知の制約（プロキシ有効時）**:

| 制約 | 影響 |
|------|------|
| iframe内JSのfetch/XHR | CORS失敗の可能性。SPA的コンテンツの一部が動作しない |
| Cookie/認証 | プロキシ経由ではユーザーCookieが送信されない |
| CSP script-src | 注入スクリプト実行のためプロキシ応答からscript-srcを除去 |

**不採用案: ホストのCSS3Dレンダリング結果をテクスチャとして他ピアに配信**:

ホストがCSS3DRendererの描画結果をキャプチャし、WebRTC DataChannel経由でテクスチャとして他クライアントに配信する方式を検討したが、以下の理由で不採用とした:

1. CSS3DRendererはDOM出力（CSS transform）でありピクセル読み出しAPIが存在しない
2. html2canvasはcross-origin iframeを走査不可。same-originプロキシ経由でも複雑なページの再現が不安定
3. getDisplayMedia()はユーザー許可が毎回必要かつ要素単位のキャプチャ不可
4. 仮にキャプチャ可能でも1024x768フレームの配信は各ピア0.5〜1MB/s以上となりD2の帯域前提（100KB/s以下）を大幅に超過

現設計（各クライアント独立iframe読み込み＋スクロール位置同期）を維持する。

**根拠**: プロキシはサーバ負荷を増加させるため、デフォルトOFFとする。iframe直接埋め込みが可能なサイト（ドキュメント系、成功率70%）はプロキシ不要で動作する。プロキシが必要な運用環境でのみ有効化することで、サーバコストを制御可能にする。将来のマルチプラットフォーム展開（Quest VR等）ではブラウザ拡張に依存できないため、サーバサイドプロキシが唯一の汎用的解決策である。

### D13: oEmbed / 埋め込みURL変換 — ヘッダ除去プロキシとの責務分離

D12のヘッダ除去プロキシ（`SLATOG_PROXY=1`）は、iframe埋め込みを拒否するサイトの応答ヘッダを除去してiframe表示を強制する機能である。一方、YouTube・X(Twitter)・Spotify等のサービスは、**閲覧用URL（`youtube.com/watch?v=...`）自体がiframeを拒否していても、別途iframe埋め込み専用URL（`youtube.com/embed/...`）を公式に提供している**。この2つは本質的に異なる機能であり、混同してはならない。

**2つのプロキシ機能の分類**:

| 機能 | 目的 | サーバ負荷 | 有効化条件 |
|------|------|-----------|-----------|
| **埋め込みURL変換**（D13） | 閲覧URLを公式embed URLに変換 | なし（クライアント側URL書換のみ） | 常時有効 |
| **ヘッダ除去プロキシ**（D12） | iframe拒否ヘッダをサーバ側で除去 | あり（HTMLフェッチ+書換） | `SLATOG_PROXY=1` |

**埋め込みURL変換の判定フロー（D12を拡張）**:

```
1. クライアントがURL入力
2. クライアント側で既知サービスの埋め込みURL変換を試行
   YouTube: youtube.com/watch?v=ID → youtube.com/embed/ID
   等のパターンマッチ
3a. 変換成功 → iframe.src = 変換後URL（直接埋め込み、プロキシ不要）
3b. 変換不可 → 従来のD12フロー（proxy/check → 直接 or プロキシ or エラー）
```

**既知サービスの変換ルール（クライアント側、サーバ不要）**:

```
YouTube:
  youtube.com/watch?v={ID}         → youtube.com/embed/{ID}
  youtu.be/{ID}                    → youtube.com/embed/{ID}
  youtube.com/shorts/{ID}          → youtube.com/embed/{ID}

（将来追加候補）
Spotify:
  open.spotify.com/track/{ID}      → open.spotify.com/embed/track/{ID}
Vimeo:
  vimeo.com/{ID}                   → player.vimeo.com/video/{ID}
```

**設計原則**:

- **埋め込みURL変換はクライアント側のみで完結する**。サーバへのリクエストは発生しない（`proxy/check`も不要）。変換後URLは各サービスが公式に提供するiframe対応URLであり、`X-Frame-Options`による拒否は発生しない。
- **変換ルールはホワイトリスト方式**。未知のサービスには適用せず、D12の従来フロー（`proxy/check`）にフォールバックする。
- **ヘッダ除去プロキシ（D12）は変換不可能なサイト専用**。公式embed URLが存在するサービスにはプロキシを使わない。

**根拠**: YouTube等のサービスはiframeによる閲覧URLの直接埋め込みを拒否するが、埋め込み専用URLを公式に提供している。この場合、ヘッダ除去プロキシは不要であるだけでなく、プロキシ経由ではCSP/CORS制約によりプレーヤーが正常動作しない。公式embed URLへの変換はサーバ負荷ゼロかつ互換性が最も高い解決策である。

**深度整合（FS-2結果の反映）**:

iframe（CSS3DObject）とWebGLオブジェクトの深度整合には、depth maskテクニックを使用する:

```javascript
// iframe位置と同一サイズ・位置のPlaneGeometryをWebGLシーンに追加
const mask = new THREE.Mesh(
  new THREE.PlaneGeometry(iframeWidth, iframeHeight),
  new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true })
);
mask.position.copy(cssObject.position);
mask.scale.copy(cssObject.scale);
mask.renderOrder = -1; // 他のWebGLオブジェクトより先に描画
```

これによりiframe背後のWebGLオブジェクトが正しくオクルージョンされ、iframe前面のオブジェクト（ストローク、アバター）は可視のまま維持される。直接iframe・プロキシiframeの両方で同一のdepth mask方式が適用される。

## FS後の実装ロードマップ

### Phase 1: コア通信基盤（1〜2週間）

- プロジェクト構成: LP用エントリポイントとルーム画面用エントリポイントを分離したビルド構成
- 環境変数config（API_BASE, WS_SIGNALING）の導入（D11方針）
- KVインターフェース定義 + InMemoryRoomStore実装（D11方針）
- シグナリングサーバ実装（Node.js + ws + InMemoryRoomStore）
- HTTP API実装（GET /api/rooms、GET /api/rooms/:url_key）
- LP骨格配信（静的HTML、URL入力→ルーム画面遷移の最小フロー）
- WebRTC接続確立（2ピア間のSDP交換、ICE candidate中継）
- DataChannel開設（reliable + unreliableの2チャネル）
- 2ピア間でのメッセージ送受信動作確認

### Phase 2: 3D空間 + Webページ表示（1〜2週間）

- Three.js空間のセットアップ（CSS3DRenderer + WebGLRenderer二重構成）
- iframe埋め込み（FS-1/FS-2の結果を反映）
- カメラ操作（OrbitControls）
- スクロール共有（LWW、100msデバウンス）

### Phase 3: マルチプレイ同期（2〜3週間）

- ルーム状態CRDT実装（LWWRegister, LWWMap）
- アバター位置同期（unreliableチャネル、20Hz）
- ペンストローク同期（reliableチャネル）
- テキストチャット同期（reliableチャネル）
- チャットウィンドウUI（2D HTML/CSS、画面端固定パネル）
- 3D吹き出し表示（SpriteMaterial + CanvasTexture、5秒フェードアウト）
- 64KBステートバジェット管理（チャット16KB上限＋ストローク残余バジェット）
- 途中参加者へのスナップショット送信（チャット履歴含む）

### Phase 4: ルーム管理 + LP完成（1〜2週間）

- LP完成（アクティブルームランキング表示、参加人数・セッション数表示、10秒ポーリング更新）
- ルームディスカバリ完全フロー（URL入力 or ランキングクリック → 既存参加 / 新規作成 分岐）
- ホストマイグレーション
- ピア切断検知とクリーンアップ
- 10人上限到達時の新規セッション生成と同一url_keyへのセッション追加

### Phase 5: 統合テスト + UX改善（1〜2週間）

- 10人同時接続テスト
- 異なるネットワーク環境での接続安定性検証
- 64KBステート制限のUX評価（チャット約45件 + ストローク容量の体感確認）
- チャット吹き出し視認性テスト（複数人同時発言時の重なり、フェードアウト長の調整）
- パフォーマンスプロファイリングと最適化

## 将来の検討事項（本ADRのスコープ外）

- 音声チャット（WebRTC MediaStreamの追加）
- 32〜64人スケール対応（トポロジ変更: 階層型メッシュ or SFU）
- TURN サーバ運用（企業ネットワーク対応）
- 永続化（ストローク・チャットデータのサーバ側保存）
- 認証・アクセス制御
- ランキングのモデレーション（URLブラックリスト、bot参加によるランキング操作対策、レート制限、通報機能）
- LP/フロントエンドのCDN分離とKVの外部サービス移行
- ルームプレビューサムネイル表示

## 参考

- [WebRTC DataChannel API](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel)
- [Three.js CSS3DRenderer](https://threejs.org/docs/#examples/en/renderers/CSS3DRenderer)
- [CRDT概要 (Martin Kleppmann)](https://crdt.tech/)
- [SCTP unreliable mode](https://www.rfc-editor.org/rfc/rfc8831)
