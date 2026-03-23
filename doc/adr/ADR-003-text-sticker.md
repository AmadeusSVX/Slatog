# ADR-003: チャット機能のトグル化とテキストステッカー機能の追加

## ステータス

**提案中（Proposed）**

## 日付

2026-03-22

## コンテキスト

ADR-001 D9で定義したテキストチャット機能は、ルーム内のコミュニケーション手段として設計された。しかし、不特定多数が参加可能なオープンルームにおいてチャット機能は必ずしもポジティブな影響を与えるとは限らず、荒らしや炎上のリスクを内包している。チャット機能の有効/無効をサーバ運用者が制御可能にする必要がある。

また、チャットに代わるライトウェイトなコミュニケーション手段として、3D空間の壁面にテキストを貼り付ける「テキストステッカー」機能を導入する。テキストステッカーは壁面上に残り続ける視覚的なコミュニケーションであり、チャットの即時性とは異なる空間的・永続的な表現手段を提供する。

## 決定事項

### D22: チャット機能のトグル — 環境変数によるON/OFF切り替え

D12のプロキシ機能（`SLATOG_PROXY=1`）と同様に、チャット機能を環境変数で有効/無効を切り替えられるようにする。

**環境変数**:

```
環境変数: SLATOG_CHAT
値:       0 または 1
デフォルト: 1（有効）

例:
  SLATOG_CHAT=1  → チャット機能有効（デフォルト）
  SLATOG_CHAT=0  → チャット機能無効
```

**無効時の動作**:

- チャットウィンドウ（2D UIパネル）を非表示にする
- チャット入力欄を非表示にする
- 3D空間内の吹き出し表示を無効化する
- チャットメッセージの送受信を停止する（reliableチャネルでのCHAT_MSGの送信・受信を無視）
- RoomStateの`chat_messages`領域は空のまま維持され、共有プール（D5改定）の容量がステッカー・ストロークに利用可能となる

**設定の伝播**:

- チャットの有効/無効はサーバ側の設定であり、ルーム参加時にサーバからクライアントに通知する
- REST APIレスポンスに`chat_enabled`フラグを追加する

```
GET /api/rooms/:url_key レスポンス拡張:
  {
    sessions: [...],
    features: {
      chat_enabled: boolean,    // D22
      proxy_enabled: boolean    // D12（既存）
    }
  }
```

- クライアントは`chat_enabled: false`の場合、チャット関連UIを描画しない

**根拠**: チャット機能はコミュニケーションを促進する一方で、匿名参加可能な環境では荒らし・炎上のリスクがある。D12のプロキシと同様に環境変数でトグル可能にすることで、サーバ運用者がリスクに応じて機能を制御できる。デフォルトON（有効）とすることで、プロトタイプ段階での機能検証を妨げない。

### D23: テキストステッカー — 壁面へのテキスト貼付機能

テキストボックスに入力した文字列を、3D空間内の壁面上にステッカーとして貼り付ける機能を実装する。

**UIフロー**:

```
1. ユーザーがステッカーモードを有効化（UIボタンまたはショートカットキー）
2. テキスト入力欄が表示される（画面下部、最大140文字）
3. テキストを入力後、壁面上の任意の位置をクリック
4. クリック位置にテキストステッカーが貼り付けられる
5. ステッカーモードを解除するまで繰り返しクリックで貼付可能
```

**クリック位置の決定 — Raycast**:

```
1. マウスクリック位置からカメラを起点にRaycastを発射
2. 壁面（D16の床・天井・左右壁・奥壁）との交差判定
3a. 壁面と交差 → 交差点にステッカーを配置
3b. 壁面と非交差（空中クリック等） → 配置しない（無視）
```

- Raycastの対象は壁面メッシュのみとし、iframe（CSS3DObject）やアバター等は対象外とする
- ステッカーは交差した壁面の法線方向を向いて配置される（壁に貼り付いた状態）

**ステッカーの描画**:

```
描画方式: WebGL SpriteMaterial + CanvasTexture
  - Canvas2Dでテキストを描画 → テクスチャ化 → Meshとして壁面上に配置
  - D9の吹き出し（方式A）と同じアプローチ

ステッカーの見た目:
  ┌─────────────────────┐
  │ userName             │  ← ユーザー名（小さめフォント、D24で制御）
  │ ここにテキストが     │  ← 本文（ユーザーカラーで描画）
  │ 表示される           │
  └─────────────────────┘
  - 背景: 半透明白（rgba(255,255,255,0.85)）
  - テキスト色: ユーザーカラー（D15のUSER_COLORS[color_index]）
  - ボーダー: ユーザーカラーで1pxの枠線
  - 角丸: 4px
  - ユーザー名: 本文フォントサイズの60%、左上に表示
```

- ステッカーはPlaneGeometry上にCanvasTextureを適用したMeshとして描画する
- Zファイティング防止のため、壁面から微小オフセット（D21のOFFSET相当）を設けて配置する

**RoomState変更（D3拡張）**:

```typescript
TextSticker {
  id: string              // UUID v4
  author_peer_id: string
  author_name: string     // 貼付時点の表示名（ピア離脱後も表示可能にするため）
  color: string           // D15のユーザーカラー
  text: string            // UTF-8、最大140文字
  position: {x, y, z}    // 壁面上の配置座標
  normal: {x, y, z}      // 貼付先壁面の法線ベクトル
  show_author: boolean    // ユーザー名表示のON/OFF（D24、貼付時点の設定値）
  timestamp: number       // Unix ms — LWW用・削除優先度用
}
```

```diff
 RoomState {
   url_key: string
   scroll_position: LWWRegister<{x, y}>
   strokes: LWWMap<stroke_id, Stroke>
   chat_messages: LWWMap<msg_id, ChatMessage>
+  text_stickers: LWWMap<sticker_id, TextSticker>
   peers: Map<peer_id, PeerState>
   host_peer_id: string
 }
```

**同期**: reliableチャネルでSTICKER_ADDメッセージを全ピアに送信する。途中参加者にはRoomStateスナップショットにテキストステッカーが含まれる。

**64KBバジェット管理（D5改定）**:

ADR-001 D5のカテゴリ別固定上限方式を廃止し、完全共有プール方式に改定する。テキストステッカーの追加に伴いカテゴリが3つに増えたため、固定枠の配分では利用パターンに応じた柔軟なバジェット活用ができない。

```
63KB共有プール（64KB - メタデータ1KB固定確保）:
  チャット履歴・テキストステッカー・ペンストロークが同一プールを共有する。
  カテゴリ別の個別上限は設けない。

削除アルゴリズム（enforcebudget改定）:
  function enforcebudget(state):
    meta_size = serialize(state.meta).byteLength        // ≤ 1KB
    content_size = serialize(state.chat_messages).byteLength
                 + serialize(state.text_stickers).byteLength
                 + serialize(state.strokes).byteLength
    pool_budget = 65536 - meta_size

    while content_size > pool_budget:
      // 全カテゴリ（chat_messages, text_stickers, strokes）の中から
      // 最古のtimestampを持つアイテムを1件削除
      remove oldest item by timestamp across all categories
      content_size を再計算
```

- 全ピアが同一データと同一アルゴリズムで独立に削除判定を実行するため、結果整合性により収束する（D5と同様）
- チャット無効時（D22）はチャットデータが存在しないため、63KB全量をステッカー+ストロークで利用可能
- カテゴリ間の圧迫が発生しうるが、timestamp順の公平な削除により特定カテゴリが不当に優遇されない
- 1ステッカーあたりの最大サイズはヘッダ含め約500byte（140文字UTF-8 + メタデータ）であり、63KB共有プールでは理論上最大約126枚を保持可能（他カテゴリが空の場合）

**根拠**: テキストステッカーはチャットの代替ではなく、空間に情報を残す異なるコミュニケーション手段である。壁面への貼付というメタファーは現実世界の付箋やポスターに対応し、直感的に理解可能である。Raycastによる配置はD21（ペンストローク）と同様の壁面インタラクションパターンであり、ユーザーの操作モデルに一貫性がある。

### D24: テキストステッカーのユーザー名表示トグル — クライアント設定

テキストステッカーの左上に表示されるユーザー名の表示/非表示を、クライアント側の設定で切り替えられるようにする。

**設定**:

```
設定名: showStickerAuthor
保存先: localStorage
デフォルト: true（表示する）
```

**UI**:

- ルーム画面内の設定パネル（歯車アイコン等）にトグルスイッチを配置する
- ラベル: 「ステッカーにユーザー名を表示」
- トグル変更時、以降に貼付するステッカーに設定値が反映される

**動作**:

```
showStickerAuthor = true の場合:
  ┌─────────────────────┐
  │ Alice                │  ← ユーザー名が表示される
  │ ここにテキスト       │
  └─────────────────────┘

showStickerAuthor = false の場合:
  ┌─────────────────────┐
  │ ここにテキスト       │  ← ユーザー名なし
  └─────────────────────┘
```

- この設定は**貼付時点の値がTextStickerの`show_author`フィールドに記録される**（D23参照）
- 他ユーザーのステッカー表示は、そのステッカーの`show_author`値に従う（閲覧側の設定ではなく、貼付者の設定が優先される）
- 設定変更は既に貼付済みのステッカーには影響しない

**根拠**: 匿名性を重視するユーザーはユーザー名を非表示にしたい場合がある。一方、デフォルトONとすることで「誰が書いたか」が明確になり、コミュニケーションの文脈を把握しやすくする。貼付者の意思を尊重する設計（貼付時点で確定）により、プライバシーの制御を貼付者自身に委ねる。

## 実装ロードマップへの影響

以下の項目をADR-001/ADR-002のロードマップに追加する:

### Phase 3への追加（マルチプレイ同期）

- D22: チャット機能トグル（環境変数`SLATOG_CHAT` + features API + クライアント側UI制御）
- D23: テキストステッカー同期（reliableチャネルでのSTICKER_ADD送受信）

### Phase 2への追加（3D空間 + Webページ表示）

- D23: テキストステッカー描画（CanvasTexture + Mesh + Raycast配置）
- D24: ステッカーユーザー名表示トグル（localStorage設定 + 設定パネルUI）

## RoomState / バジェット変更サマリ

本ADRによる変更を一覧化する。

**RoomState（D3拡張）**:

```diff
 RoomState {
   url_key: string
   scroll_position: LWWRegister<{x, y}>
   strokes: LWWMap<stroke_id, Stroke>
   chat_messages: LWWMap<msg_id, ChatMessage>
+  text_stickers: LWWMap<sticker_id, TextSticker>
   peers: Map<peer_id, PeerState>
   host_peer_id: string
 }
```

**TextSticker（新規）**:

```typescript
TextSticker {
  id: string              // UUID v4
  author_peer_id: string
  author_name: string     // 貼付時点の表示名
  color: string           // D15のユーザーカラー
  text: string            // UTF-8、最大140文字
  position: {x, y, z}    // 壁面上の配置座標
  normal: {x, y, z}      // 貼付先壁面の法線ベクトル
  show_author: boolean    // ユーザー名表示ON/OFF（D24）
  timestamp: number       // Unix ms
}
```

**64KBバジェット（D5改定）**:

ADR-001 D5のカテゴリ別固定上限を廃止し、完全共有プールに改定する。

```
64KB (65,536 bytes) 総バジェット
├── メタデータ: 1KB固定確保
└── 共有プール: 63KB
    チャット履歴・テキストステッカー・ペンストロークが共有
    超過時: 全カテゴリ横断で最古timestampから逐次削除
```

**REST APIレスポンス拡張**:

```diff
 GET /api/rooms/:url_key レスポンス:
   {
     sessions: [...],
+    features: {
+      chat_enabled: boolean,
+      proxy_enabled: boolean
+    }
   }
```

## 参考

- [ADR-001: Slatog初期アーキテクチャ](./ADR-001-slatog.md)
- [ADR-002: ユーザー識別・ルーム空間・セッション永続化](./ADR-002-enhancements.md)
