# ADR-002: ユーザー識別・ルーム空間・セッション永続化の追加実装

## ステータス

**提案中（Proposed）**

## 日付

2026-03-22

## コンテキスト

ADR-001で定義したプロトタイプ実装を経て、以下の課題が明らかになった:

1. ユーザーを識別する手段がなく、表示名の設定・記憶ができない
2. 複数ユーザー間でアバター・チャット・ドローイングの色が区別しづらい
3. 3D空間が無限平面であり、ルームとしての空間的まとまりがない
4. ペンストロークの線が細く視認性が低い
5. セッションデータがP2Pのみで保持され、全員退出時に消失する
6. 過去のセッションに再参加して状態を復元する手段がない

本ADRはこれらを解決する追加決定事項を定義する。

## 決定事項

### D14: ユーザー名の設定と記憶 — localStorage + 将来の認証拡張性

LPにユーザー名入力欄を追加し、入力されたユーザー名を`localStorage`に保存して次回訪問時に自動復元する。

**LP UIの変更**:

```
┌─────────────────────────────────────────────┐
│  Slatog                                     │
│  ─────────────────────────────────           │
│  ユーザー名:                                  │
│  [ Anonymous_xxxx       ] [保存]             │
│                                              │
│  URLを入力して新しいルームを開始:               │
│  [ https://example.com/article    ] [開始]    │
│  ...                                         │
└─────────────────────────────────────────────┘
```

**ユーザー識別の設計**:

```typescript
interface UserIdentity {
  user_id: string; // UUID v4、初回アクセス時に生成しlocalStorageに永続化
  display_name: string; // ユーザー入力名、デフォルト "Anonymous_" + user_id先頭4文字
}
```

- `user_id`は初回アクセス時に生成し、`localStorage`に永続化する。ブラウザ/デバイス単位で一意となる
- `display_name`は空文字を許可せず、未入力時はデフォルト名を使用する
- ルーム参加時のJOIN_ROOMメッセージに`user_id`と`display_name`を含める
- チャットメッセージの`author_name`（ADR-001 D9）は`display_name`から設定される

**将来の認証拡張への設計方針**:

```typescript
// 現在（プロトタイプ）: localStorage認証
interface AuthProvider {
  getUserIdentity(): Promise<UserIdentity>;
  isAuthenticated(): boolean;
}

class LocalStorageAuthProvider implements AuthProvider {
  getUserIdentity(): Promise<UserIdentity> {
    // localStorageからuser_id, display_nameを取得/生成
  }
  isAuthenticated(): boolean {
    return true; // 常にtrue（匿名ユーザーも「認証済み」扱い）
  }
}

// 将来: サーバサイド認証
class ServerAuthProvider implements AuthProvider {
  getUserIdentity(): Promise<UserIdentity> {
    // POST /api/auth/login → JWT → user_id, display_name取得
  }
  isAuthenticated(): boolean {
    // JWTの有効性を確認
  }
}
```

`AuthProvider`インターフェースにより、localStorageベースからサーバサイド認証（JWT、OAuth等）への移行時に、認証ロジックの差し替えのみで完了する。ルーム参加フローやP2P通信プロトコルは`UserIdentity`を受け取る形で実装し、認証方式に依存しない。

**根拠**: localStorageによるクライアント側永続化は、サーバコスト不要かつ即座に実装可能である。`AuthProvider`抽象化により、将来のユーザー登録/ログイン形式への拡張パスを確保しつつ、プロトタイプの簡潔さを維持する。

### D15: ユーザーカラー自動割り当て — アバター・チャット・ドローイング統一色

1ルーム内の各ユーザーに対し、アバター表示色・チャット表示色・ペンストローク色を同一の色として自動割り当てする。ユーザー間で色が重複しないことを保証する。

**カラーパレット**:

D2のフルメッシュ上限（10人）に対応する10色のパレットを定義する。色は白背景およびシェーディングされた壁面（D16）上での視認性を確保するため、彩度・明度を調整した中間トーンとする。

```typescript
const USER_COLORS = [
  "#E63946", // 赤
  "#2A9D8F", // ティール
  "#E9A820", // アンバー
  "#6A4C93", // パープル
  "#1D7CF2", // ブルー
  "#F77F00", // オレンジ
  "#2DC653", // グリーン
  "#D62AD0", // マゼンタ
  "#5C4033", // ブラウン
  "#457B9D", // スチールブルー
] as const;
```

**割り当てアルゴリズム**:

```
1. ピアがルームに参加（JOIN_ROOM）
2. 現在ルーム内で使用中のカラーインデックスを収集
3. USER_COLORSから未使用の最小インデックスを割り当て
4. 割り当て結果をPeerStateに含めて全ピアに通知
```

- カラーインデックスは`PeerState`に追加し、CRDTの既存同期メカニズム（ADR-001 D3）で全ピアに伝播する
- ピア離脱時にそのカラーインデックスは解放され、次の参加者に再利用可能となる
- 同一`user_id`が再参加した場合でも、新たに空きインデックスを割り当てる（色の固定化は将来の認証拡張時に検討）

**RoomState変更（D3更新）**:

```
PeerState {
  peer_id: string
  user_id: string          // D14で追加
  display_name: string     // D14で追加
  color_index: number      // D15で追加（0-9）
  position: {x, y, z}
  rotation: {x, y, z}
}
```

**適用箇所**:

| 要素               | 色の適用方法                                                   |
| ------------------ | -------------------------------------------------------------- |
| アバター           | MeshのmaterialのcolorにUSER_COLORS[color_index]を設定          |
| チャット吹き出し   | 吹き出し背景色またはボーダー色にUSER_COLORS[color_index]を設定 |
| チャットウィンドウ | author名のテキスト色にUSER_COLORS[color_index]を設定           |
| ペンストローク     | LineMaterialのcolorにUSER_COLORS[color_index]を設定            |

**根拠**: 統一色により「誰のアクションか」が空間的・視覚的に即座に判別可能となる。10色パレットはD2の上限10人と一致し、色の枯渇が発生しない。割り当てアルゴリズムのシンプルさ（最小空きインデックス）により、実装複雑性を最小化する。

### D16: 物理ルーム空間 — 壁・床・天井による閉じた部屋

3D空間をオープンな無限平面から、壁・床・天井で囲まれた物理的な部屋に変更する。Webページ（iframe）は壁面に貼り付ける形で配置する。

**部屋の構成**:

```
部屋サイズ（プロトタイプ固定値）:
  幅:   20ユニット (X軸)
  高さ:  8ユニット (Y軸)
  奥行: 16ユニット (Z軸)

        天井 (Y=8)
       ┌────────────────────┐
      /│                   /│
     / │                  / │
    ┌──┼─────────────────┐  │
    │  │  [iframe壁面]    │  │ 右壁
左壁│  │                 │  │
    │  └─────────────────┼──┘
    │ /                  │ /
    │/                   │/
    └────────────────────┘
     床 (Y=0)       奥壁 (Z=-16)
    正面 (Z=0, カメラ初期位置側)
```

**壁面のマテリアル**:

```typescript
const WALL_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xf0ede8, // 白過ぎない白（ウォームグレー寄り）
  roughness: 0.85,
  metalness: 0.0,
});
```

- `MeshStandardMaterial`を使用し、シーン内のライティングによる自然なシェーディングを実現する
- 各壁面は`PlaneGeometry`で構成する
- 床は壁面よりわずかに暗めの色（`0xE0DDD8`）を設定し、空間の上下方向を直感的に把握可能にする

**ライティング**:

```typescript
// 環境光: 全体を柔らかく照らす
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);

// ディレクショナルライト: 壁面のシェーディング用
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
directionalLight.position.set(5, 10, 5);
```

**iframe配置（D6/D12/D13更新）**:

- iframeは奥壁（Z=-16面）の中央に配置する
- iframe（CSS3DObject）のサイズは壁面に収まる範囲（例: 幅16ユニット × 高さ7ユニット）とする
- depth mask（ADR-001 D13のFS-2結果）は壁面上のiframe位置に合わせて配置する

**カメラ・移動制限**:

```
カメラ制限:
  X: [-9.5, 9.5]   （壁から0.5ユニットのマージン）
  Y: [0.5, 7.5]    （床・天井から0.5ユニットのマージン）
  Z: [-15.5, -0.5]  （壁から0.5ユニットのマージン）
```

- OrbitControlsのターゲット位置にクランプを適用し、カメラが部屋の外に出ないようにする
- アバターの移動にも同一のクランプを適用する

**将来の拡張**:

- 部屋サイズの動的変更（参加人数に応じたスケーリング）
- 複数壁面へのiframe配置（複数URL同時閲覧）
- 家具・装飾オブジェクトの配置

**根拠**: 閉じた空間はユーザーに「場所」としての感覚を与え、共同作業の一体感を高める。壁面へのiframe配置はホワイトボードやプロジェクタスクリーンに相当する自然なメタファーであり、3D空間の用途を直感的に伝える。白過ぎない白と自然なシェーディングにより、長時間の利用でも目の疲れを軽減する。

### D21: ペンストロークの壁面クランプ — 部屋外への描画回り込み防止

ペンストロークの各ポイントが部屋の壁面を超える場合、そのポイントを壁面上にクランプして描画する。部屋の外側にストロークがはみ出すことを防ぐ。

**クランプ処理**:

```
ストローク描画時の各ポイント (x, y, z) に対して:
  x = clamp(x, -ROOM_W/2 + OFFSET, ROOM_W/2 - OFFSET)
  y = clamp(y, -ROOM_H/2 + OFFSET, ROOM_H/2 - OFFSET)
  z = clamp(z, BACK_Z + OFFSET, FRONT_Z - OFFSET)

OFFSET: 壁面からのZファイティング防止マージン（例: 5ユニット）
```

- クランプは描画座標にのみ適用し、RoomStateに保存されるストロークデータは元のポイント座標を保持する（カメラ位置や部屋サイズが将来変わった場合の互換性のため）
- Zファイティング防止のため、壁面ちょうどではなく壁面から`OFFSET`分だけ手前（部屋内側）にクランプする
- クランプにより、ペンモードで部屋の端に向かって描画しても、ストロークが壁面に沿って自然にフィットする

**根拠**: 閉じた部屋空間（D16）においてストロークが壁面を突き抜けると、部屋の外側（描画されない空間）にストロークが消失し、ユーザー体験を損なう。壁面クランプにより、描画は常に可視範囲内に収まる。Zファイティング防止マージンにより、壁面と同一平面上のストローク描画で発生するちらつきを回避する。

### D17: ペンストロークの線幅 — デフォルト太め + 将来の可変線幅

ペンストロークのデフォルト線幅を現在より太く設定する。将来的には線幅をユーザーが変更可能にする。

**線幅の変更**:

```typescript
// 変更前（暫定値）
const DEFAULT_LINE_WIDTH = 2; // px

// 変更後
const DEFAULT_LINE_WIDTH = 5; // px
```

Three.jsの`Line2`（`three/examples/jsm/lines/Line2`）+ `LineMaterial`を使用する。`LineMaterial`は`linewidth`プロパティでスクリーンスペースピクセル単位の線幅指定が可能であり、標準の`LineBasicMaterial`（多くのWebGL実装で1px固定）の制約を回避する。

**将来の可変線幅への設計方針**:

```typescript
// Strokeデータ構造の拡張（D3更新）
Stroke {
  id: string
  author_peer_id: string
  color: string            // D15のユーザーカラー
  line_width: number       // D17で追加。デフォルト5
  points: {x, y, z}[]
  timestamp: number
}
```

- `line_width`フィールドをStrokeデータに追加し、ストロークごとに線幅を保持する
- 現段階では全ストロークに`DEFAULT_LINE_WIDTH`を設定する
- UIにスライダーまたはプリセットボタン（細/中/太）を追加する際には、このフィールドを介して即座に対応可能
- 既存ストロークとの後方互換: `line_width`が未定義の場合は`DEFAULT_LINE_WIDTH`にフォールバックする

**根拠**: 3D空間ではカメラ距離によってストロークの見かけ上のサイズが変化するため、2Dキャンバスより太い線幅がデフォルトとして適切である。`Line2`+`LineMaterial`の採用により、線幅のスクリーンスペース制御が可能となる。Strokeデータへの`line_width`フィールド追加は、将来の可変線幅UIの実装コストを最小化する。

### D18: サーバサイドステートキャッシュ — 定期送信によるセッション状態保存

現在P2Pのみで共有されているセッションデータを、低頻度でサーバ側にも送信し、サーバがセッションごとのステートキャッシュを保持する。

**送信フロー**:

```
1. ホストが一定間隔でRoomStateをシリアライズ
2. POST /api/rooms/:room_id/state （JSON、64KB以下）
3. サーバはKVストアにステートキャッシュを保存
4. サーバはタイムスタンプを記録（最終更新日時）
```

- **送信者はホストのみ**: 全ピアが送信すると重複が発生するため、ホスト（ADR-001 D7）がステートキャッシュの送信責務を持つ
- **送信間隔**: デフォルト30秒。環境変数`SLATOG_STATE_SYNC_INTERVAL`で設定可能（下限10秒、上限60秒）
- **送信データ**: ADR-001 D3のRoomState全体をJSONシリアライズしたもの（64KBバジェット内）
- **ホストマイグレーション時**: 新ホストが送信責務を自動的に引き継ぐ

**KVスキーマの拡張（D8更新）**:

```
KVスキーマ（セッション単位）:
  key: room_id (string, UUID)
  value: {
    url_key: string
    peers: string[]
    host_peer_id: string
    peer_count: number
    created_at: number
    state_cache: string | null     // D18で追加: RoomStateのJSONシリアライズ
    state_updated_at: number | null // D18で追加: 最終キャッシュ更新日時 (Unix ms)
  }
```

**RoomStoreインターフェースの拡張（D11更新）**:

```typescript
interface RoomStore {
  // 既存メソッド（省略）

  // D18で追加
  setStateCache(roomId: string, stateJson: string): void;
  getStateCache(roomId: string): string | null;
}
```

**REST APIの追加（D11更新）**:

```
[B] REST API
  既存:
    GET  /api/rooms         → ランキング
    GET  /api/rooms/:url_key → セッション一覧
    POST /api/rooms         → 新規ルーム作成
  D18追加:
    POST /api/rooms/:room_id/state  → ステートキャッシュ送信（ホストのみ）
    GET  /api/rooms/:room_id/state  → ステートキャッシュ取得（D19で使用）
```

**将来の拡張性**:

- `GET /api/rooms/:room_id/state`により、他セッションのステートキャッシュを読み出すAPIが既に定義される。将来的にセッション間の状態共有（例: 別セッションのストロークを閲覧）を実装する際のエンドポイントとなる
- ステートキャッシュはプロトタイプではインメモリに保持するが、RoomStoreインターフェースを通じてRedis等への移行が可能

**根拠**: P2Pのみの状態保持では、全員退出時にデータが消失する。低頻度（30秒間隔）のサーバ送信により、帯域・サーバ負荷への影響を最小限に抑えつつ、状態の永続性を確保する。ホストのみが送信することで重複を防止し、64KBバジェット内のJSONであるためペイロードサイズも小さい。

### D19: セッション復元 — 参加人数0のセッション表示とステートリストア

参加人数が0になったセッションをランキングから削除せず下位に表示し続け、再参加時にD18のステートキャッシュからセッション状態を復元する。

**ランキング表示の変更（D10更新）**:

```
ランキング生成（擬似コード、D10更新）:
  entries = kv.getAll()
  grouped = groupBy(entries, e => e.url_key)
  ranking = grouped.map(g => {
    url_key: g.key,
    total_peers: sum(g.sessions.map(s => s.peer_count)),
    session_count: g.sessions.length,
    has_active_peers: total_peers > 0      // D19で追加
  })
  // アクティブ（参加者あり）を先、非アクティブ（参加者0）を後に配置
  ranking.sort(by has_active_peers DESC, then by total_peers DESC)
```

**LP UIでの非アクティブセッションの表示**:

```
┌─────────────────────────────────────────────┐
│  ─── アクティブなルーム ───                   │
│                                              │
│  1. https://en.wikipedia.org/wiki/...        │
│     👥 8人 · セッション 2個                    │
│     [参加する]                                │
│                                              │
│  ─── 最近のルーム（参加者なし）───             │
│                                              │
│  3. https://example.com/blog/post-1          │
│     👥 0人 · 最終更新: 10分前                  │
│     [復元して参加する]                        │
│                                              │
└─────────────────────────────────────────────┘
```

- 参加者0のセッションは「最近のルーム」セクションに分離表示する
- 最終更新日時（`state_updated_at`）を表示し、キャッシュの鮮度を示す
- ボタンラベルを「復元して参加する」に変更し、過去の状態が復元されることを明示する

**復元フロー**:

```
1. ユーザーが「復元して参加する」を押下
2. クライアント → GET /api/rooms/:room_id/state
3a. state_cache存在:
    → ステートキャッシュをデシリアライズしてRoomStateに適用
    → ルーム画面に遷移、復元されたストローク・チャット履歴が表示される
    → ユーザーは自動的にホストとなる
3b. state_cache不在（キャッシュなし or 削除済み）:
    → 空のRoomStateで新規開始（通常の新規ルーム作成と同等）
    → ユーザーは自動的にホストとなる
```

**セッションのライフサイクル（D8更新）**:

```
セッション状態遷移:
  ACTIVE   (peer_count > 0)  → ランキング上位表示
  INACTIVE (peer_count == 0) → ランキング下位表示（「最近のルーム」）
  DELETED  (TTL超過 or 手動) → KVから削除、ランキング非表示
```

- 最後のピアが離脱した時点でセッションは`INACTIVE`に遷移する
- `INACTIVE`セッションはKVから削除せず保持する（削除はD20で管理）
- 再参加時に`INACTIVE` → `ACTIVE`に遷移する

**根拠**: セッション状態の復元により、一時的な全員退出（休憩、ネットワーク障害等）からの回復が可能になる。ランキングへの継続表示により、過去のセッションの「発見可能性」を維持し、再参加の動線を確保する。

### D20: セッション自動削除 — TTLベースの非アクティブセッション削除

参加人数0のセッションを、設定可能な時間経過後に自動削除する。

**設定**:

```
環境変数: SLATOG_SESSION_TTL
値:       秒数（整数）
デフォルト: -1（削除しない）

例:
  SLATOG_SESSION_TTL=-1     → 非アクティブセッションを永久に保持
  SLATOG_SESSION_TTL=3600   → 1時間後に削除
  SLATOG_SESSION_TTL=86400  → 24時間後に削除
```

**削除判定**:

```
定期チェック（60秒間隔）:
  if SLATOG_SESSION_TTL == -1:
    return  // 削除機能無効

  for session in kv.getAll():
    if session.peer_count == 0:
      inactive_duration = now() - session.state_updated_at
      if inactive_duration > SLATOG_SESSION_TTL * 1000:
        kv.deleteSession(session.room_id)
```

- 削除対象は`peer_count == 0`のセッションのみ。アクティブなセッションは削除されない
- 削除時にはステートキャッシュ（`state_cache`）も同時に削除される
- 削除タイミングの基準は`state_updated_at`（最後にステートキャッシュが更新された時刻）とする。ステートキャッシュが一度も保存されていない場合は`created_at`を基準とする

**RoomStoreインターフェースの拡張（D11更新）**:

```typescript
interface RoomStore {
  // 既存メソッド（省略）

  // D20で追加
  deleteExpiredSessions(ttlMs: number): number; // 削除件数を返す
}
```

**サーバ起動時の処理**:

```typescript
if (SLATOG_SESSION_TTL !== -1) {
  setInterval(() => {
    const deleted = roomStore.deleteExpiredSessions(SLATOG_SESSION_TTL * 1000);
    if (deleted > 0) {
      console.log(`Cleaned up ${deleted} expired sessions`);
    }
  }, 60_000);
}
```

**根拠**: デフォルト`-1`（削除しない）により、プロトタイプ段階ではセッションが蓄積され続けても運用上の問題はない（インメモリMapのため再起動でリセット）。本番運用時にはTTLを設定してストレージの肥大化を防止する。60秒間隔のチェックは十分に低コストであり、セッション数が増加した場合でもMap走査のコストは許容範囲内である。

## 実装ロードマップへの影響

以下の項目をADR-001のロードマップに追加する:

### Phase 4への追加（ルーム管理 + LP完成）

- D14: ユーザー名入力UI + localStorage永続化 + AuthProviderインターフェース
- D15: カラーパレット定義 + JOIN_ROOM時の色割り当て + アバター/チャット/ストロークへの色適用
- D19: ランキングの非アクティブセッション表示 + 復元フロー

### Phase 2への追加（3D空間 + Webページ表示）

- D16: 壁・床・天井のジオメトリ + ライティング + カメラ制限 + iframe壁面配置
- D17: Line2 + LineMaterialによる線幅変更

### Phase 3への追加（マルチプレイ同期）

- D18: ホストからのステートキャッシュ定期送信 + REST APIエンドポイント追加

### Phase 4への追加（ルーム管理 + LP完成）

- D20: TTLベースの自動削除タイマー

## RoomState / KVスキーマ変更サマリ

本ADRによる変更を一覧化する。

**PeerState（D3拡張）**:

```diff
 PeerState {
   peer_id: string
+  user_id: string          // D14
+  display_name: string     // D14
+  color_index: number      // D15
   position: {x, y, z}
   rotation: {x, y, z}
 }
```

**Stroke（D3拡張）**:

```diff
 Stroke {
   id: string
   author_peer_id: string
+  color: string            // D15
+  line_width: number       // D17
   points: {x, y, z}[]
   timestamp: number
 }
```

**KVスキーマ（D8拡張）**:

```diff
 KVスキーマ（セッション単位）:
   key: room_id (string, UUID)
   value: {
     url_key: string
     peers: string[]
     host_peer_id: string
     peer_count: number
     created_at: number
+    state_cache: string | null       // D18
+    state_updated_at: number | null  // D18
   }
```

## 参考

- [ADR-001: Slatog初期アーキテクチャ](./ADR-001-slatog.md)
- [Three.js Line2](https://threejs.org/docs/#examples/en/lines/Line2)
- [Three.js LineMaterial](https://threejs.org/docs/#examples/en/lines/LineMaterial)
- [Web Storage API (localStorage)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
