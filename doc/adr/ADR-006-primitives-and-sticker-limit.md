# ADR-006: プリミティブ配置モードとテキストステッカー文字数制限

## ステータス

**提案中（Proposed）**

## 日付

2026-03-23

## コンテキスト

1. **3D空間にオブジェクトを配置する手段がない**: 現在の3D空間ではペンストロークとテキストステッカーのみが配置可能であり、立体的なオブジェクトを配置する手段がない。空間の装飾やランドマークとして基本的な3Dプリミティブ（円錐・立方体・球・円筒）を配置できると、空間の表現力が大幅に向上する。
2. **テキストステッカーの文字数が過大**: ADR-003 D23ではテキストステッカーの最大文字数を140文字と定義しているが、壁面に貼り付ける用途としては過大である。長文ステッカーは視認性が低く、バジェットも圧迫する。付箋的な用途には32文字で十分であり、1ステッカーあたりのバジェット消費も削減できる。

## 決定事項

### D31: プリミティブ配置モード — 基本3D形状の選択・配置

ユーザーがプリミティブ（基本3D形状）を選択し、視界前方に配置する機能を追加する。

**配置可能なプリミティブ**:

| 種別   | Three.jsジオメトリ | デフォルトサイズ          |
| ------ | ------------------ | ------------------------- |
| 円錐   | ConeGeometry       | 半径0.5, 高さ1.0          |
| 立方体 | BoxGeometry        | 幅1.0 × 高さ1.0 × 奥行1.0 |
| 球     | SphereGeometry     | 半径0.5                   |
| 円筒   | CylinderGeometry   | 半径0.5, 高さ1.0          |

**UIフロー**:

```
1. ユーザーがプリミティブモードを有効化（UIボタンまたはショートカットキー）
2. プリミティブ選択UIが表示される（4種のアイコンボタン）
3. プリミティブ種別を選択
4. 3D空間内をクリック
5. カメラの視界前方にプリミティブが配置される
6. プリミティブモードを解除するまで繰り返しクリックで配置可能
```

**配置UIイメージ**:

```
プリミティブモード有効時:

┌──────────────────────────────────────┐
│ [△ 円錐] [□ 立方体] [○ 球] [⊡ 円筒] │
└──────────────────────────────────────┘
  選択中のプリミティブがハイライト表示
```

**配置位置の決定 — Raycast**:

```
1. マウスクリック位置からカメラを起点にRaycastを発射
2a. 壁面（D16）と交差した場合:
    → 交差点から壁面法線方向に0.5ユニットオフセットした位置に配置
    → プリミティブが壁面にめり込まないようにする
2b. 壁面と交差しなかった場合:
    → カメラ位置からRay方向にPEN_MAX_DRAW_DISTANCE（D29: 100ユニット）
      進んだ地点に配置
```

- 配置されたプリミティブは部屋の壁面クランプ（D21相当）を適用し、部屋外に配置されないようにする
- プリミティブのマテリアルは配置者のユーザーカラー（D15）を適用する

**プリミティブのマテリアル**:

```typescript
const material = new THREE.MeshStandardMaterial({
  color: USER_COLORS[color_index], // D15のユーザーカラー
  roughness: 0.6,
  metalness: 0.1,
});
```

- `MeshStandardMaterial`を使用し、D16のライティングによる自然なシェーディングを実現する

**根拠**: 基本プリミティブは3D空間の表現力を最小限の実装コストで向上させる。4種のプリミティブ（円錐・立方体・球・円筒）はThree.jsの標準ジオメトリで即座に利用可能であり、カスタムモデルのインポート機能と比較して実装複雑性が極めて低い。Raycastによる配置はD21（ペンストローク）・D23（テキストステッカー）と同様の壁面インタラクションパターンであり、操作モデルに一貫性がある。

### D32: プリミティブの状態同期 — RoomStateへの追加と64KBバジェット管理

D31で配置されたプリミティブの位置・姿勢情報をRoomStateに追加し、64KBバジェットの共有プール（D5改定、ADR-003）で管理する。

**Primitiveデータ構造**:

```typescript
Primitive {
  id: string              // UUID v4
  author_peer_id: string
  color: string           // D15のユーザーカラー
  shape: "cone" | "cube" | "sphere" | "cylinder"
  position: {x, y, z}    // 配置座標
  rotation: {x, y, z}    // 姿勢（オイラー角、ラジアン）
  timestamp: number       // Unix ms — LWW用・削除優先度用
}
```

**RoomState変更（D3拡張）**:

```diff
 RoomState {
   url_key: string
   scroll_position: LWWRegister<{x, y}>
   strokes: LWWMap<stroke_id, Stroke>
   chat_messages: LWWMap<msg_id, ChatMessage>
   text_stickers: LWWMap<sticker_id, TextSticker>
+  primitives: LWWMap<primitive_id, Primitive>
   peers: Map<peer_id, PeerState>
   host_peer_id: string
 }
```

**同期**: reliableチャネルでPRIMITIVE_ADDメッセージを全ピアに送信する。途中参加者にはRoomStateスナップショットにプリミティブが含まれる。

**1プリミティブあたりのサイズ見積もり**:

```
id:              36 bytes (UUID v4)
author_peer_id:  36 bytes
color:            7 bytes (#RRGGBB)
shape:           ~8 bytes (最長 "cylinder")
position:        ~30 bytes ({x,y,z} 数値)
rotation:        ~30 bytes ({x,y,z} 数値)
timestamp:       13 bytes
JSON構造:        ~50 bytes (キー名・区切り文字)

合計: 約210 bytes/プリミティブ
```

63KB共有プールでは、他カテゴリが空の場合に理論上最大約300個を保持可能。

**64KBバジェット管理（D5改定の更新）**:

```
63KB共有プール（64KB - メタデータ1KB固定確保）:
  チャット履歴・テキストステッカー・ペンストローク・プリミティブが同一プールを共有する。
  カテゴリ別の個別上限は設けない。

削除アルゴリズム（enforcebudget更新）:
  function enforcebudget(state):
    meta_size = serialize(state.meta).byteLength        // ≤ 1KB
    content_size = serialize(state.chat_messages).byteLength
                 + serialize(state.text_stickers).byteLength
                 + serialize(state.strokes).byteLength
                 + serialize(state.primitives).byteLength    // D32で追加
    pool_budget = 65536 - meta_size

    while content_size > pool_budget:
      // 全カテゴリ（chat_messages, text_stickers, strokes, primitives）の中から
      // 最古のtimestampを持つアイテムを1件削除
      remove oldest item by timestamp across all categories
      content_size を再計算
```

**根拠**: プリミティブは1個あたり約210bytesと軽量であり、既存の共有プール方式にそのまま統合可能である。ペンストロークやテキストステッカーと同一のtimestampベース削除アルゴリズムを適用することで、特別な管理ロジックを追加する必要がない。

### D33: テキストステッカー文字数制限の縮小 — 140文字から32文字へ

ADR-003 D23で定義したテキストステッカーの最大文字数を140文字から32文字に縮小し、1ステッカーあたりのバジェット消費を削減する。

**変更点**:

```diff
 TextSticker {
   id: string              // UUID v4
   author_peer_id: string
   author_name: string
   color: string
-  text: string            // UTF-8、最大140文字
+  text: string            // UTF-8、最大32文字
   font_size: number       // D30
   position: {x, y, z}
   normal: {x, y, z}
   show_author: boolean
   timestamp: number
 }
```

**1ステッカーあたりのサイズ見積もり（更新）**:

```
変更前（140文字上限）: 約500 bytes/ステッカー
  text: 最大420 bytes (140文字 × 3 bytes/文字 UTF-8)
  メタデータ: ~80 bytes

変更後（32文字上限）: 約180 bytes/ステッカー
  text: 最大96 bytes (32文字 × 3 bytes/文字 UTF-8)
  メタデータ: ~80 bytes
```

63KB共有プールでは、他カテゴリが空の場合に理論上最大約358枚を保持可能（変更前の約126枚から大幅増加）。

**UIの変更**:

```diff
 ステッカーモード有効時のUI:

 ┌──────────────────────────────────────┐
-│ [テキスト入力欄（最大140文字）      ] │
+│ [テキスト入力欄（最大32文字）       ] │
 │ フォントサイズ: [===●=====] 24px    │
 │                 16       48         │
 └──────────────────────────────────────┘
```

- テキスト入力欄の`maxlength`属性を32に設定する
- 入力欄の幅も140文字想定より狭くしてよい（付箋サイズのコンパクトなUI）

**根拠**: テキストステッカーは壁面に貼る付箋的な用途であり、140文字は過大である。32文字に制限することで、1ステッカーあたりのバジェット消費が約500bytesから約180bytesに削減され、同一バジェット内でより多くのステッカーを保持可能となる。また、短いテキストは壁面上での視認性が高く、付箋としての用途に適している。

## 実装ロードマップへの影響

以下の項目をADR-001〜ADR-005のロードマップに追加する:

### Phase 2への追加（3D空間 + Webページ表示）

- D31: プリミティブ配置UI・Raycast配置・ジオメトリ描画
- D33: テキスト入力欄のmaxlength変更

### Phase 3への追加（マルチプレイ同期）

- D32: プリミティブのRoomState追加・reliableチャネルでの同期・バジェット管理

## RoomState / バジェット変更サマリ

本ADRによる変更を一覧化する。

**RoomState（D3拡張）**:

```diff
 RoomState {
   url_key: string
   scroll_position: LWWRegister<{x, y}>
   strokes: LWWMap<stroke_id, Stroke>
   chat_messages: LWWMap<msg_id, ChatMessage>
   text_stickers: LWWMap<sticker_id, TextSticker>
+  primitives: LWWMap<primitive_id, Primitive>
   peers: Map<peer_id, PeerState>
   host_peer_id: string
 }
```

**Primitive（新規）**:

```typescript
Primitive {
  id: string              // UUID v4
  author_peer_id: string
  color: string           // D15のユーザーカラー
  shape: "cone" | "cube" | "sphere" | "cylinder"
  position: {x, y, z}    // 配置座標
  rotation: {x, y, z}    // 姿勢（オイラー角、ラジアン）
  timestamp: number       // Unix ms
}
```

**TextSticker（D23/D30更新）**:

```diff
 TextSticker {
   id: string
   author_peer_id: string
   author_name: string
   color: string
-  text: string            // UTF-8、最大140文字
+  text: string            // UTF-8、最大32文字
   font_size: number       // D30
   position: {x, y, z}
   normal: {x, y, z}
   show_author: boolean
   timestamp: number
 }
```

**64KBバジェット（D5改定の更新）**:

```
64KB (65,536 bytes) 総バジェット
├── メタデータ: 1KB固定確保
└── 共有プール: 63KB
    チャット履歴・テキストステッカー・ペンストローク・プリミティブが共有
    超過時: 全カテゴリ横断で最古timestampから逐次削除

1アイテムあたりのサイズ見積もり:
  チャットメッセージ:   ~200 bytes
  テキストステッカー:   ~180 bytes（32文字上限、D33で縮小）
  ペンストローク:       可変（ポイント数依存）
  プリミティブ:         ~210 bytes（D32で追加）
```

## 参考

- [ADR-001: Slatog初期アーキテクチャ](./ADR-001-slatog.md)
- [ADR-002: ユーザー識別・ルーム空間・セッション永続化](./ADR-002-enhancements.md)
- [ADR-003: チャット機能のトグル化とテキストステッカー機能の追加](./ADR-003-text-sticker.md)
- [ADR-004: ライティング復元・テキストステッカー改善・荒らし対策](./ADR-004-sticker-fixes.md)
- [ADR-005: ペン描画距離の短縮・テキストステッカーフォントサイズ調整](./ADR-005-pen-range-and-font-size.md)
