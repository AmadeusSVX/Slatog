# ADR-005: ペン描画距離の短縮・テキストステッカーフォントサイズ調整

## ステータス

**提案中（Proposed）**

## 日付

2026-03-22

## コンテキスト

1. **ペン描画距離が長すぎる**: 現在のペン描画（D21）はRaycastで壁面との交差点を求め、その位置にストロークを配置する。カメラから壁面までの距離が描画距離となるため、部屋の奥壁に向かって描くと非常に遠い位置にストロークが生成され、空中で手元に近い位置に描画することができない。部屋内で空中に描画可能にするには、Raycastの最大距離を短くする必要がある。
2. **テキストステッカーのフォントサイズが固定**: ADR-003 D23で定義したテキストステッカーはフォントサイズが固定されており、ユーザーが文字の大きさを調整する手段がない。大きな文字で目立たせたい場合や、小さな文字で控えめに配置したい場合に対応できない。

## 決定事項

### D29: ペン描画距離の短縮 — 近距離Raycast + 壁面クランプ

Raycastの最大距離（`far`）を短く設定し、ペンストロークをカメラの近くに描画可能にする。壁面がRaycastの最大距離より手前にある場合は、これまで通り壁面上にストロークが配置される。

**Raycasterの設定**:

```typescript
const PEN_MAX_DRAW_DISTANCE = 100; // ユニット（カメラからの最大描画距離）

this.raycaster.near = this.camera.near;
this.raycaster.far = PEN_MAX_DRAW_DISTANCE;
```

**描画位置の決定ロジック**:

```
1. マウス/ポインター位置からカメラを起点にRaycastを発射（far = PEN_MAX_DRAW_DISTANCE）
2a. 壁面と交差した場合:
    → 交差点にストロークを配置（従来通り、D21のオフセット付き）
    → 壁面がPEN_MAX_DRAW_DISTANCE以内にあれば壁面に描画される
2b. 壁面と交差しなかった場合（壁面がPEN_MAX_DRAW_DISTANCEより遠い、または空中方向）:
    → カメラ位置からRay方向にPEN_MAX_DRAW_DISTANCE進んだ地点にストロークを配置
    → この場合は空中描画となる
```

**壁面クランプとの関係（D21）**:

- D21の壁面クランプ処理はそのまま維持する
- 空中描画された点も、最終的な描画座標に対してD21のクランプが適用される
- つまり、空中描画で壁面を超えるポイントが生成された場合は、壁面上にクランプされる

**パラメータ**:

```
PEN_MAX_DRAW_DISTANCE = 100
  部屋のサイズ（D16: 幅800×高さ600×奥行600）に対して十分短い値。
  手元の空中に描画する感覚を実現しつつ、壁が近い場合は壁面描画となる。
```

**根拠**: Raycastの`far`プロパティを設定するだけで実現可能であり、既存のD21壁面クランプとも整合する。壁面がRaycastの範囲内にある場合は従来通り壁面に描画されるため、壁面への描画体験を損なわない。空中描画時は一定距離に描画されるため、ユーザーの手元で直感的に描ける。

### D30: テキストステッカーのフォントサイズ変更 — スライダーUI

テキストステッカー（D23）のフォントサイズをユーザーがスライダーで変更できるようにする。

**UIフロー**:

```
ステッカーモード有効時のUI:

┌──────────────────────────────────────┐
│ [テキスト入力欄                    ] │
│ フォントサイズ: [===●=====] 24px    │
│                 16       48         │
└──────────────────────────────────────┘
```

**パラメータ**:

```
STICKER_FONT_SIZE_MIN     = 16    // px（最小フォントサイズ）
STICKER_FONT_SIZE_MAX     = 48    // px（最大フォントサイズ）
STICKER_FONT_SIZE_DEFAULT = 24    // px（デフォルトフォントサイズ）
STICKER_FONT_SIZE_STEP    = 2     // px（スライダーのステップ幅）
```

**スライダーの仕様**:

- HTML `<input type="range">` を使用する
- ステッカーモード有効時にテキスト入力欄の下に表示する
- スライダー横に現在のフォントサイズ値を数値で表示する（例: `24px`）
- ユーザーが選択したフォントサイズはステッカー貼付時にそのステッカーに適用される
- フォントサイズの設定値は`localStorage`に保存し、次回訪問時に復元する

**TextSticker データ構造の拡張（D23更新）**:

```diff
 TextSticker {
   id: string
   author_peer_id: string
   author_name: string
   color: string
   text: string
+  font_size: number         // D30で追加。デフォルト24
   position: {x, y, z}
   normal: {x, y, z}
   show_author: boolean
   timestamp: number
 }
```

- `font_size`フィールドをTextStickerデータに追加し、ステッカーごとにフォントサイズを保持する
- 既存ステッカーとの後方互換: `font_size`が未定義の場合は`STICKER_FONT_SIZE_DEFAULT`（24px）にフォールバックする

**CanvasTexture描画への反映**:

```
Canvas2D描画時:
  ctx.font = `${sticker.font_size ?? STICKER_FONT_SIZE_DEFAULT}px sans-serif`
  ユーザー名フォントサイズ = font_size * 0.6（D23の比率を維持）

  テクスチャサイズはテキスト量とフォントサイズに応じて動的に計算する
```

**根拠**: フォントサイズの調整はステッカーの表現力を大幅に向上させる。大きな文字で見出しのように使ったり、小さな文字で注釈的に配置したりと、ユーザーの意図に応じた多様な使い方が可能になる。スライダーUIは直感的かつモバイル/VR環境でも操作しやすい入力方式である。

## RoomState 変更サマリ

```diff
 TextSticker {
   id: string
   author_peer_id: string
   author_name: string
   color: string
   text: string
+  font_size: number         // D30: フォントサイズ（デフォルト24px）
   position: {x, y, z}
   normal: {x, y, z}
   show_author: boolean
   timestamp: number
 }
```

## 参考

- [ADR-001: Slatog初期アーキテクチャ](./ADR-001-slatog.md)
- [ADR-002: ユーザー識別・ルーム空間・セッション永続化](./ADR-002-enhancements.md)
- [ADR-003: チャット機能のトグル化とテキストステッカー機能の追加](./ADR-003-text-sticker.md)
- [ADR-004: ライティング復元・テキストステッカー改善・荒らし対策](./ADR-004-sticker-fixes.md)
