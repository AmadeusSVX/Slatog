# ADR-007: カメラ操作改善とレスポンシブUI

## ステータス

**承認済（Accepted）**

## 日付

2026-03-23

## コンテキスト

1. **視点移動が直感的でない**: 現在のカメラ操作はThree.jsの`OrbitControls`をデフォルト設定で使用しており、ターゲット点を中心とした軌道回転が主操作となっている。3D空間内を自由に探索するユースケースでは、その場での視点回転や前後左右への併進移動のほうが直感的である。現在の操作体系ではユーザーが意図した方向に移動しづらく、空間把握が困難になっている。
2. **スマートフォンでUIが画面を覆い尽くす**: チャットパネル（幅320px固定）、参加者リスト（幅200px固定）、各種入力パネルがすべて固定サイズで配置されており、スマートフォンなどの小画面デバイスでは3D空間がほとんど見えなくなる。モバイルファーストのレスポンシブ対応が必要である。

## 決定事項

### D34: カメラ操作の刷新 — FPSスタイルの直感的な視点・移動操作

`OrbitControls`を廃止し、FPSスタイルのカスタムカメラコントローラを実装する。Euler角（YXZ順序）による視点回転と、カメラ位置の直接操作による併進移動を組み合わせる。

**操作マッピング**:

| マウス操作                   | 動作                 | 説明                                                             |
| ---------------------------- | -------------------- | ---------------------------------------------------------------- |
| 左ボタンドラッグ             | 視点回転             | カメラ位置を固定したまま視線方向を変える。周囲を見回す操作       |
| 右ボタンドラッグ             | 水平面併進移動       | カメラの向いている方向を基準に、水平面(XZ)上を前後左右に移動する |
| 中ボタン（ホイール）ドラッグ | スクリーン面併進移動 | カメラの視線に対して垂直な平面上を上下左右に移動する             |
| ホイール回転                 | 前後併進移動         | カメラを視線方向に前進・後退させる                               |

**実装方式**:

OrbitControlsはターゲット点を中心とした軌道回転を前提とする設計であり、ターゲット同期の問題（毎フレームのターゲットリセットがPAN操作と競合する）を根本的に解決できない。そのためOrbitControlsを完全に廃止し、以下のカスタムカメラコントローラを実装する。

```typescript
// Euler角（YXZ順序）による視点管理
let yaw = 0; // Y軸回転（水平）
let pitch = 0; // X軸回転（垂直）
const PITCH_LIMIT = Math.PI / 2 - 0.01;

// 視点回転: Euler角を更新してquaternionに反映
camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));

// 水平面併進移動: yawからXZ平面上の前方・右方ベクトルを算出
const fwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
const rt = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
camera.position.addScaledVector(rt, -dx * MOVE_SPEED);
camera.position.addScaledVector(fwd, dy * MOVE_SPEED);

// スクリーン面併進移動: カメラのquaternionから右方・上方ベクトルを取得
const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
camera.position.addScaledVector(rt, -dx * MOVE_SPEED);
camera.position.addScaledVector(up, dy * MOVE_SPEED);
```

**右ボタンドラッグの移動方向**:

```
右ボタンドラッグ時の移動方向（上面図）:

        前進（ドラッグ↑）
          ↑
  左移動 ← ● → 右移動
（ドラッグ←）  （ドラッグ→）
          ↓
        後退（ドラッグ↓）

※ カメラの向いている方向が「前」となる
※ Y軸（上下）方向の移動は発生しない（水平面上の移動のみ）
```

**中ボタンドラッグの移動方向**:

```
中ボタンドラッグ時の移動方向:

        上移動（ドラッグ↑）
          ↑
  左移動 ← ● → 右移動
（ドラッグ←）  （ドラッグ→）
          ↓
        下移動（ドラッグ↓）

※ カメラの視線に対して垂直な平面上の移動
```

**壁面クランプ**:

- 既存のD16壁面クランプ（`clampVec3`）はカメラ位置に適用する（OrbitControlsのターゲット概念は不要）

**タッチ操作（スマートフォン）**:

| タッチ操作         | 動作           | 説明                         |
| ------------------ | -------------- | ---------------------------- |
| 1本指ドラッグ      | 視点回転       | マウス左ボタンドラッグと同等 |
| 2本指ドラッグ      | 水平面併進移動 | マウス右ボタンドラッグと同等 |
| ピンチイン・アウト | 前後併進移動   | ホイール回転と同等           |

**ブラウザタッチジェスチャの無効化**:

スマートフォンでのタッチ操作時にブラウザのデフォルト動作（pull-to-refresh、ピンチズーム、スクロール等）が発動してページリロードやズームが走る問題を防止する。

```css
html,
body {
  overscroll-behavior: none; /* pull-to-refreshを無効化 */
}

#scene-container {
  touch-action: none; /* ブラウザのタッチジェスチャ（スクロール、ズーム等）を無効化 */
}
```

**根拠**: 現在のOrbitControlsのデフォルト設定では、左ドラッグが軌道回転、右ドラッグがパン、中ドラッグがドリーとなっており、3D空間探索には不向きである。FPSゲーム的な「その場で見回し + 併進移動」の操作モデルのほうが、3D空間内の自由探索には直感的である。OrbitControlsはターゲット点を中心とした設計のため、併進移動とターゲット同期の競合が構造的に解決不可能であり、Euler角ベースのカスタムコントローラが適切である。

### D35: レスポンシブUI — 小画面デバイスへの適応

チャットパネル・参加者リスト・各種入力パネルのレイアウトをレスポンシブ化し、スマートフォン（画面幅768px以下）でも3D空間が十分に視認できるようにする。

**ブレークポイント**:

```
デスクトップ: 769px以上 — 現在のレイアウトを維持
モバイル:     768px以下 — レスポンシブレイアウトを適用
```

**モバイル時のレイアウト変更**:

```
デスクトップ（現状維持）:        モバイル（768px以下）:

┌─────────────────────┐     ┌──────────────┐
│        [peer-list]→ │     │              │
│                     │     │   3D空間      │
│                     │     │  （全画面）    │
│                     │     │              │
│ [chat]              │     │     [peers]→ │
│ [chat]              │     ├──────────────┤
│ [chat-input]        │     │ [chat] 折畳  │
│ [status-bar]        │     │ [status-bar] │
└─────────────────────┘     └──────────────┘
```

**チャットパネル（#chat-panel）のモバイル対応**:

```css
@media (max-width: 768px) {
  #chat-panel {
    width: 100%; /* 全幅 */
    max-height: 40vh; /* 画面の40%まで */
    left: 0;
    right: 0;
    bottom: 0; /* 画面下部に配置 */
    font-size: 0.8rem;
  }

  .chat-messages {
    max-height: 25vh; /* メッセージ領域を制限 */
  }
}
```

**参加者リスト（#peer-list）のモバイル対応**:

```css
@media (max-width: 768px) {
  #peer-list {
    width: 140px; /* 幅を縮小（200px → 140px） */
    font-size: 0.7rem;
    top: 36px;
    max-height: 30vh; /* 高さを制限 */
  }
}
```

**ステータスバー（#status-bar）のモバイル対応**:

```css
@media (max-width: 768px) {
  #status-bar {
    font-size: 0.7rem;
    padding: 0.2rem 0.5rem;
  }
}
```

**入力パネル群（ステッカー・プリミティブ・設定）のモバイル対応**:

```css
@media (max-width: 768px) {
  #sticker-input-panel,
  #primitive-input-panel,
  .settings-panel {
    width: 90vw; /* 画面幅の90% */
    max-width: 320px; /* デスクトップサイズを上限 */
    left: 50%;
    transform: translateX(-50%); /* 中央配置 */
    font-size: 0.8rem;
  }
}
```

**チャットトグルボタン**:

ステータスバーにチャットパネルの表示/非表示を切り替えるトグルボタン（&#128172;）を追加する。デスクトップ・モバイル共通で動作する。

- デスクトップ: チャットパネルは初期表示。トグルボタンで非表示に切り替え可能
- モバイル（768px以下）: チャットパネルは初期非表示。トグルボタンで表示に切り替え可能

```typescript
// チャットトグルボタン
chatToggleBtn.addEventListener("click", () => {
  chatVisible = !chatVisible;
  chatPanel.style.display = chatVisible ? "flex" : "none";
  chatToggleBtn.classList.toggle("active", chatVisible);
});

// モバイル判定: 初期表示時にチャットを非表示にする
if (window.innerWidth <= 768) {
  chatPanel.style.display = "none";
  chatVisible = false;
}
```

**根拠**: Slatogはマルチプラットフォーム前提（ADR-001）であり、Meta Questブラウザやスマートフォンブラウザからのアクセスが想定される。現在の固定幅レイアウト（チャット320px + 参加者リスト200px = 520px）はスマートフォンの画面幅（360〜414px）を超過し、3D空間がほぼ不可視となる。CSSメディアクエリによるレスポンシブ対応は実装コストが低く、既存のデスクトップレイアウトに影響を与えない。

## 実装ロードマップへの影響

以下の項目をADR-001〜ADR-006のロードマップに追加する:

### Phase 2への追加（3D空間）

- D34: OrbitControls廃止 → Euler角ベースのカスタムFPSカメラコントローラ実装 + ブラウザタッチジェスチャ無効化
- D35: CSSメディアクエリによるレスポンシブUI・チャットトグルボタン追加・モバイル初期チャット非表示

D34とD35は独立しており、実装順序に依存関係はない。

## 参考

- [ADR-001: Slatog初期アーキテクチャ](./ADR-001-slatog.md)
- [ADR-002: ユーザー識別・ルーム空間・セッション永続化](./ADR-002-enhancements.md)
- [ADR-003: チャット機能のトグル化とテキストステッカー機能の追加](./ADR-003-text-sticker.md)
- [ADR-004: ライティング復元・テキストステッカー改善・荒らし対策](./ADR-004-sticker-fixes.md)
- [ADR-005: ペン描画距離の短縮・テキストステッカーフォントサイズ調整](./ADR-005-pen-range-and-font-size.md)
- [ADR-006: プリミティブ配置モードとテキストステッカー文字数制限](./ADR-006-primitives-and-sticker-limit.md)
