# ADR-004: ライティング復元・テキストステッカー改善・荒らし対策

## ステータス

**提案中（Proposed）**

## 日付

2026-03-22

## コンテキスト

ADR-003でテキストステッカー機能を定義したが、実装・運用上の課題がいくつか残っている。

1. **部屋の暗さ**: D16（物理ルーム形状）導入時に壁が黒くなる問題への対処としてディレクショナルライトの強度を0.6から0.3に下げたが、壁の黒さの原因は別途解決済みである。ライト強度をADR-002の仕様値に戻す必要がある。
2. **ステッカーの視認性**: 半透明白背景と枠線はステッカーの主張が強く、壁面に馴染まない。
3. **荒らし対策**: テキストボックスに入力済みテキストが残る場合、連打による大量貼付が容易である。また、短時間での連投を制限する仕組みがない。

## 決定事項

### D25: ディレクショナルライト強度の復元

壁面が黒くなる問題はライト強度とは無関係であったため、ADR-002 D16で定義されたライティング仕様に戻す。

**変更内容**:

```
DirectionalLight の intensity:
  現状: 0.3（暫定的に下げた値）
  復元: 0.6（ADR-002 D16の仕様値）
```

AmbientLight（0.7）は変更しない。

### D26: テキストステッカーの見た目変更 — 背景透過・枠線なし

ADR-003 D23で定義したステッカーの見た目を変更する。

**変更前（D23）**:

```
- 背景: 半透明白（rgba(255,255,255,0.85)）
- ボーダー: ユーザーカラーで1pxの枠線
- 角丸: 4px
```

**変更後（D26）**:

```
- 背景: 完全透過（transparent）
- ボーダー: なし
- 角丸: 廃止（背景・ボーダーがないため不要）
```

テキスト色（ユーザーカラー）とユーザー名表示（D24）はそのまま維持する。テキストの視認性確保のため、Canvas2D描画時にテキストにドロップシャドウまたはアウトライン（strokeText）を付与する。

```
テキスト描画:
  ctx.strokeStyle = "rgba(0, 0, 0, 0.5)"
  ctx.lineWidth = 3
  ctx.strokeText(text, x, y)   // アウトライン（先に描画）
  ctx.fillStyle = userColor
  ctx.fillText(text, x, y)     // 本文
```

**根拠**: 背景・枠線を除去することで、ステッカーが壁面に直接書かれたような自然な外観になる。ドロップシャドウ/アウトラインにより、壁面色に関わらずテキストの可読性を確保する。

### D27: ステッカー貼付後のテキストボックスクリア

テキストステッカーを1つ貼り付けた後、テキスト入力欄を空にする。

**動作**:

```
1. ユーザーがテキストを入力
2. 壁面をクリックしてステッカーを貼付
3. 貼付完了後、テキスト入力欄を即座にクリアする
4. 次のステッカーを貼るには再度テキストを入力する必要がある
```

- テキスト入力欄が空の状態で壁面をクリックしてもステッカーは貼付されない（空文字チェック）
- 同一テキストを連投するには毎回入力し直す必要があり、荒らしの連打を抑制する

**根拠**: テキストが残ったままだとクリック連打で同一テキストのステッカーを大量に貼付できてしまう。毎回テキスト入力を要求することで、意図的なスパム行為のコストを引き上げる。

### D28: ステッカー連投規制とBANシステム

短時間でのテキストステッカー連続投稿を規制し、悪質な場合は自動的にルームから排除する仕組みを導入する。

**連投規制（レートリミット）**:

```
パラメータ（サーバ側環境変数で設定可能）:
  SLATOG_STICKER_RATE_WINDOW   = 30      // 秒（監視ウィンドウ）
  SLATOG_STICKER_RATE_LIMIT    = 5       // ウィンドウ内の最大投稿数

動作:
  1. サーバはピアごとにステッカー投稿のタイムスタンプを記録する
  2. RATE_WINDOW秒以内にRATE_LIMIT回以上の投稿があった場合、規制を発動する
  3. 規制発動中はそのピアからのSTICKER_ADDメッセージを無視する（サーバ側で破棄）
  4. 規制中であることをクライアントに通知する（STICKER_RATE_LIMITED メッセージ）
  5. クライアントは規制通知を受けたらUI上にクールダウン中である旨を表示する
  6. 規制はウィンドウ内の最古の投稿からRATE_WINDOW秒経過後に自動解除される
```

**規制違反によるBANの自動発動**:

```
パラメータ（サーバ側環境変数で設定可能）:
  SLATOG_STICKER_BAN_ENABLED    = 1       // 0: 無効, 1: 有効
  SLATOG_STICKER_BAN_THRESHOLD  = 2       // 規制発動回数の閾値
  SLATOG_STICKER_BAN_MODE       = "ban"   // "kick" または "ban"
  SLATOG_STICKER_BAN_DURATION   = 3600    // BAN持続時間（秒）、0で永久BAN

動作:
  1. 規制が SLATOG_STICKER_BAN_THRESHOLD 回発動した場合:

  BAN_MODE = "kick" の場合:
    - Vote kickを自動発動する（他ユーザーの投票なしで即時実行）
    - キックされたユーザーは再接続可能

  BAN_MODE = "ban" の場合:
    - ユーザーのIPアドレスをBANリストに追加する
    - WebSocket接続を切断する
    - BANリストに含まれるIPからの接続を拒否する
    - BAN_DURATION秒後にBANリストから自動削除（0の場合はサーバ再起動まで永続）

  2. BAN発動時、対象ユーザーに理由を通知する（STICKER_BANNED メッセージ）
```

**BANリストの管理**:

```
BANリスト:
  サーバのメモリ上で管理する（Map<ip_address, ban_expiry_timestamp>）
  サーバ再起動時にクリアされる（永続化しない）

BANリストのRoomStateへの組み込み:
  64KBバジェットの共有プール内にBANリストを含める

  BannedIP {
    ip: string          // IPv4またはIPv6アドレス
    banned_at: number   // Unix ms
    expires_at: number  // Unix ms（0 = サーバ再起動まで）
    reason: string      // "sticker_spam" 等
  }
```

```diff
 RoomState {
   url_key: string
   scroll_position: LWWRegister<{x, y}>
   strokes: LWWMap<stroke_id, Stroke>
   chat_messages: LWWMap<msg_id, ChatMessage>
   text_stickers: LWWMap<sticker_id, TextSticker>
+  banned_ips: LWWMap<ip_address, BannedIP>
   peers: Map<peer_id, PeerState>
   host_peer_id: string
 }
```

- `banned_ips`は共有プール（D23改定の63KB）に含まれ、enforcebudgetの対象となる
- ただし`banned_ips`はenforcebudgetの削除優先度が最も低い（最後に削除される）
- 1エントリあたり約100byte（IP文字列 + メタデータ）であり、100件でも約10KB

**環境変数一覧**:

| 環境変数                       | デフォルト | 説明                      |
| ------------------------------ | ---------- | ------------------------- |
| `SLATOG_STICKER_RATE_WINDOW`   | `30`       | 連投監視ウィンドウ（秒）  |
| `SLATOG_STICKER_RATE_LIMIT`    | `5`        | ウィンドウ内最大投稿数    |
| `SLATOG_STICKER_BAN_ENABLED`   | `1`        | 自動BAN有効/無効          |
| `SLATOG_STICKER_BAN_THRESHOLD` | `2`        | BAN発動までの規制回数     |
| `SLATOG_STICKER_BAN_MODE`      | `"ban"`    | `"kick"` or `"ban"`       |
| `SLATOG_STICKER_BAN_DURATION`  | `3600`     | BAN持続時間（秒、0=永久） |

**根拠**: テキスト入力クリア（D27）だけでは、短いテキストの連投を完全には防げない。サーバ側でのレートリミットにより物理的に連投を制限し、繰り返し違反するユーザーを自動排除することで、他のユーザーの体験を保護する。設定を環境変数で制御可能にすることで、ルームの性質に応じた柔軟な運用を可能にする。

## enforcebudget 改定（D5/D23拡張）

D28のBANリスト追加に伴い、enforcebudgetの削除アルゴリズムを更新する。

```
function enforcebudget(state):
  meta_size = serialize(state.meta).byteLength
  content_size = serialize(state.chat_messages).byteLength
                + serialize(state.text_stickers).byteLength
                + serialize(state.strokes).byteLength
                + serialize(state.banned_ips).byteLength
  pool_budget = 65536 - meta_size

  while content_size > pool_budget:
    // 削除優先度（高い方から先に削除）:
    //   1. chat_messages  — 最古のtimestamp
    //   2. text_stickers  — 最古のtimestamp
    //   3. strokes        — 最古のtimestamp
    //   4. banned_ips     — 最古のbanned_at（最後に削除）
    //
    // 同一優先度内ではtimestampが最古のものから削除する
    // 上位カテゴリが空になった場合のみ下位カテゴリの削除に進む
    remove item by priority and timestamp
    content_size を再計算
```

**変更点**: D23では全カテゴリ横断で最古timestampから削除していたが、`banned_ips`はセキュリティ上の重要性から削除優先度を最低にする。通常の運用ではBANリストが圧迫するほど大きくなることは想定しないが、万一バジェットが逼迫した場合でもBAN情報が最後まで保持される。

## RoomState 変更サマリ

```diff
 RoomState {
   url_key: string
   scroll_position: LWWRegister<{x, y}>
   strokes: LWWMap<stroke_id, Stroke>
   chat_messages: LWWMap<msg_id, ChatMessage>
   text_stickers: LWWMap<sticker_id, TextSticker>
+  banned_ips: LWWMap<ip_address, BannedIP>
   peers: Map<peer_id, PeerState>
   host_peer_id: string
 }
```

```typescript
BannedIP {
  ip: string          // IPv4またはIPv6アドレス
  banned_at: number   // Unix ms
  expires_at: number  // Unix ms（0 = サーバ再起動まで）
  reason: string      // "sticker_spam" 等
}
```

## 参考

- [ADR-001: Slatog初期アーキテクチャ](./ADR-001-slatog.md)
- [ADR-002: ユーザー識別・ルーム空間・セッション永続化](./ADR-002-enhancements.md)
- [ADR-003: チャット機能のトグル化とテキストステッカー機能の追加](./ADR-003-text-sticker.md)
