# ADR-010: VRモードにおけるCSS3D相当の表示と操作

## ステータス

**提案中（Proposed）**

## 日付

2026-03-23

## コンテキスト

1. **VRモード時にCSS3Dコンテンツが非表示になる**: Slatogではiframe埋め込み（D12/D13）にCSS3DRendererを使用しているが、CSS3DRendererはDOMベースのレンダラーであり、WebXRセッション中は動作しない。現在の実装（ADR-008/009）ではVRモード突入時にCSS3Dレイヤーを`display: none`で非表示にしており、VRユーザーは埋め込みWebページを一切閲覧・操作できない。

2. **CSS3DRendererのWebXR非対応は仕様上の制約である**: Three.js公式でもCSS3DRendererのXRサポートは提供されていない（[three.js#22786](https://github.com/mrdoob/three.js/issues/22786)）。DOM要素はWebXR DOM Overlays Moduleが有効な場合のみXRで使用可能だが、これは2Dオーバーレイ専用であり、3D空間内への配置には対応しない。

3. **HTMLMeshの仕組みと制約**: Three.jsの[HTMLMesh](https://github.com/mrdoob/three.js/blob/master/examples/jsm/interactive/HTMLMesh.js)は、DOM要素を内部の`html2canvas`関数でCanvasに描画し、WebGLテクスチャとして表示する。`html2canvas`はDOMツリーを再帰的に走査（`drawElement` → 子要素再帰）し、各要素のcomputedStyleを取得してCanvas 2D APIで再描画する。MutationObserverでDOMの変更を監視し、16ms間隔でテクスチャを自動更新する。イベント処理は`dispatchDOMEvent`メソッドで3D座標→DOM座標変換を行い、元のDOM要素にmousedown/mousemove/mouseup/clickイベントを再ディスパッチする。

4. **HTMLMeshはiframe内部を描画できない**: `html2canvas`のDOM走査は通常のDOM要素（div、span、canvas等）を対象としており、**iframe要素の`contentDocument`への走査は行わない**。これはクロスオリジン・同一オリジンを問わず、HTMLMeshの実装上の制約である。iframe要素を含むDOM要素をHTMLMeshに渡した場合、iframe領域は空白となる。

5. **同一オリジンiframeのcontentDocumentは取得可能**: D12のプロキシ経由で読み込まれたiframeは同一オリジンとなるため、`iframe.contentDocument`を通じてiframe内のDOMツリーにJavaScriptからアクセスできる。このDOMを通常のdiv要素内に複製すれば、HTMLMeshで描画可能な形にできる。

## 決定事項

### D43: VR空間内iframe表示 — iframe contentDocumentの複製 + HTMLMesh

VRモード時にCSS3DObjectで表示していたiframeコンテンツを、HTMLMeshを用いてWebGLテクスチャとしてVR空間内に表示する。HTMLMeshはiframe内部を直接描画できないため、同一オリジンiframeについてはcontentDocumentのDOMを通常のdiv要素に複製してHTMLMeshに渡す。

**同一オリジンiframe（D12プロキシ経由）の処理**:

```typescript
import { HTMLMesh } from "three/examples/jsm/interactive/HTMLMesh.js";

function createVRIframeMesh(
  iframe: HTMLIFrameElement,
  position: THREE.Vector3,
  width: number,
  height: number,
): HTMLMesh | null {
  // 同一オリジンiframeのcontentDocumentからDOMを複製
  const doc = iframe.contentDocument;
  if (!doc) return null; // クロスオリジンの場合はnull

  const mirror = document.createElement("div");
  mirror.style.width = `${width}px`;
  mirror.style.height = `${height}px`;
  mirror.style.overflow = "hidden";
  mirror.style.position = "absolute";
  mirror.style.left = "-9999px"; // 画面外に配置（DOMに存在する必要あり）

  // contentDocumentのbodyを複製
  const clonedBody = doc.body.cloneNode(true) as HTMLElement;
  mirror.appendChild(clonedBody);

  // computedStyleの取得にはDOMツリーに存在する必要がある
  document.body.appendChild(mirror);

  const mesh = new HTMLMesh(mirror);
  mesh.position.copy(position);
  return mesh;
}
```

- `iframe.contentDocument.body.cloneNode(true)`でiframe内DOMのスナップショットを取得し、通常のdivに配置する。
- HTMLMeshの`html2canvas`はこの複製divを走査してCanvasに描画できる。
- 複製divはDOMツリー上に存在する必要がある（computedStyleの計算に必要）が、`left: -9999px`で画面外に配置する。
- MutationObserverによる自動更新は複製div上のDOM変更のみを検出する。iframe内の動的変更を反映するには定期的にDOMを再複製する必要がある（後述）。

**定期的なDOM再複製**:

```typescript
// VRセッション中、一定間隔でiframe contentDocumentを再複製
const MIRROR_REFRESH_INTERVAL = 3000; // 3秒

function startMirrorRefresh(iframe: HTMLIFrameElement, mirror: HTMLDivElement): number {
  return window.setInterval(() => {
    const doc = iframe.contentDocument;
    if (!doc) return;
    mirror.innerHTML = "";
    const clonedBody = doc.body.cloneNode(true) as HTMLElement;
    mirror.appendChild(clonedBody);
    // MutationObserverが変更を検出し、HTMLMeshのテクスチャが更新される
  }, MIRROR_REFRESH_INTERVAL);
}
```

**クロスオリジンiframe（D13 embed URL書き換え）のフォールバック**:

YouTube等のサードパーティ埋め込みは`contentDocument`にアクセスできないため、プレースホルダー表示とする。

```typescript
function createFallbackMesh(
  url: string,
  position: THREE.Vector3,
  width: number,
  height: number,
): HTMLMesh {
  const placeholder = document.createElement("div");
  placeholder.style.width = `${width}px`;
  placeholder.style.height = `${height}px`;
  placeholder.style.background = "#1a1a2e";
  placeholder.style.color = "#fff";
  placeholder.style.display = "flex";
  placeholder.style.alignItems = "center";
  placeholder.style.justifyContent = "center";
  placeholder.style.fontSize = "24px";
  placeholder.style.padding = "20px";
  placeholder.style.boxSizing = "border-box";
  placeholder.style.wordBreak = "break-all";
  placeholder.textContent = url;

  document.body.appendChild(placeholder);
  placeholder.style.position = "absolute";
  placeholder.style.left = "-9999px";

  const mesh = new HTMLMesh(placeholder);
  mesh.position.copy(position);
  return mesh;
}
```

**制約事項**:

- DOM複製はスナップショットであり、JavaScriptの実行状態・イベントリスナー・動的バインディングは引き継がれない。定期再複製で見た目の変化は反映されるが、リアルタイム性には限界がある。
- `html2canvas`はCSSの全機能を完全に再現するものではなく、複雑なレイアウト・カスタムフォント・CSS Grid等が正確に描画されない場合がある。
- クロスオリジンiframe（D13経由）はプレースホルダー表示のみとなる。

**根拠**: HTMLMeshはThree.js公式が提供するクライアントサイド完結の仕組みであり、サーバーサイドの追加なしでDOM→WebGLテクスチャ変換を実現できる。HTMLMeshがiframe内部を直接走査しない制約は、同一オリジンiframeについてはcontentDocumentの複製で回避可能である。

### D44: VRモード時の表示切替 — CSS3DObject ↔ HTMLMesh

VRセッションの開始・終了に応じて、iframe表示をCSS3DObject（デスクトップ）とHTMLMesh（VR）の間で切り替える。

```typescript
// sessionstart 時
webglRenderer.xr.addEventListener("sessionstart", () => {
  cssRenderer.domElement.style.display = "none";

  for (const embed of activeEmbeds) {
    // 同一オリジンならcontentDocument複製、クロスオリジンならフォールバック
    const vrMesh = embed.iframe.contentDocument
      ? createVRIframeMesh(
          embed.iframe,
          embed.cssObject.position.clone(),
          IFRAME_WIDTH,
          IFRAME_HEIGHT,
        )
      : createFallbackMesh(
          embed.url,
          embed.cssObject.position.clone(),
          IFRAME_WIDTH,
          IFRAME_HEIGHT,
        );

    if (vrMesh) {
      embed.vrMesh = vrMesh;
      scene.add(vrMesh);
    }

    // 同一オリジンの場合は定期再複製を開始
    if (embed.iframe.contentDocument && embed.vrMesh) {
      embed.mirrorInterval = startMirrorRefresh(embed.iframe, embed.vrMesh.userData.mirror);
    }
  }
});

// sessionend 時
webglRenderer.xr.addEventListener("sessionend", () => {
  for (const embed of activeEmbeds) {
    if (embed.mirrorInterval) {
      clearInterval(embed.mirrorInterval);
      embed.mirrorInterval = undefined;
    }
    if (embed.vrMesh) {
      scene.remove(embed.vrMesh);
      embed.vrMesh.dispose();
      // 複製divをDOMから除去
      const mirror = embed.vrMesh.userData.mirror;
      if (mirror?.parentNode) mirror.parentNode.removeChild(mirror);
      embed.vrMesh = undefined;
    }
  }
  cssRenderer.domElement.style.display = "";
});
```

**根拠**: デスクトップモードでは従来通りCSS3DRendererによるネイティブDOM表示を維持し、VRモード時のみHTMLMeshによるテクスチャベースの代替表示に切り替える。

### D45: VR空間内iframeのインタラクション — InteractiveGroupによるコントローラ操作

VRコントローラからHTMLMeshへのインタラクションをThree.jsの`InteractiveGroup`で実現する。

**InteractiveGroupの仕組み**:

InteractiveGroupはVRコントローラのレイキャストとHTMLMeshの交差判定を行い、交差座標をHTMLMeshの`dispatchDOMEvent`に渡す。HTMLMeshは内部で3D座標をDOM座標に変換し、元のDOM要素にmousedown/mousemove/mouseup/clickイベントを再ディスパッチする。

```typescript
import { InteractiveGroup } from "three/examples/jsm/interactive/InteractiveGroup.js";

const interactiveGroup = new InteractiveGroup(webglRenderer, camera);
scene.add(interactiveGroup);

// VRモード突入時にHTMLMeshをInteractiveGroupに追加
interactiveGroup.add(vrMesh);
```

**操作マッピング（VRコントローラ → DOM操作）**:

| VRコントローラ入力                               | DOM操作                              |
| ------------------------------------------------ | ------------------------------------ |
| トリガーボタンクリック（レイがHTMLMeshに交差時） | mousedown → mouseup → click イベント |
| コントローラ移動（レイがHTMLMesh上を移動）       | mousemove イベント                   |
| サムスティックY軸（レイがHTMLMeshに交差時）      | wheelイベント（スクロール）          |

- InteractiveGroupが交差判定とイベント変換を担うため、HTMLMesh側の修正は不要。
- スクロール操作はInteractiveGroupの標準機能に含まれないため、サムスティック入力からwheelイベントを生成して複製divにディスパッチするカスタム処理を追加する。
- テキスト入力等の複雑な操作はスコープ外とし、将来のADRで検討する。

**制約事項**:

- 操作イベントは複製div上のDOM要素に対してディスパッチされるが、複製divにはJavaScriptの実行状態が引き継がれていないため、動的なUIインタラクション（SPA遷移、AJAX更新等）は機能しない。リンクのクリックによるページ遷移等の基本操作は、iframe側のsrcを更新する追加処理で対応可能。
- クロスオリジンiframe（フォールバック表示）に対してはインタラクション不可。

**根拠**: HTMLMeshとInteractiveGroupの組み合わせはThree.js公式の`webxr_vr_sandbox`サンプルで採用されている実証済みのパターンであり、クライアントサイドで完結する。

## 実装ロードマップへの影響

以下の項目をロードマップに追加する:

### Phase 2への追加（3D空間）

- D43: iframe contentDocument複製 + HTMLMeshによるVR用表示
- D44: VRモード時のCSS3DObject ↔ HTMLMesh切替
- D45: InteractiveGroupによるVRコントローラ→iframeインタラクション

D43 → D44 → D45 の順に実装する。

## 既知の問題（2026-03-24時点）

**VRモードでのWebページ表示は現時点では正常に動作しない。VRボタンは無効化されている。**

### 問題1: HTMLMeshのhtml2canvasがWebページを正確に描画できない

HTMLMeshが内部で使用する`html2canvas`関数は、Three.js公式の`lil-gui`等の単純なUIを対象に設計された簡易的なDOMレンダラーである。以下のCSSレイアウト機能に対応していない:

- **CSS Flexbox / Grid**: `display: flex`や`display: grid`によるレイアウトが無視される
- **CSS Custom Properties**: `:root`や`html`に定義された`--var()`が解決されない（ミラーdivにはdocument rootのコンテキストがない）
- **疑似要素**: `::before`、`::after`が描画されない
- **背景画像**: `background-image: url(...)`が描画されない
- **SVG**: インラインSVGが描画されない
- **CSS Transform / Animation**: アニメーションやトランスフォームが反映されない

これにより、一般的なWebページをHTMLMeshで表示すると、元のページとは大きく異なるレイアウトになる。

### 問題2: htmleventによるリンクナビゲーション

HTMLMeshの`htmlevent`関数は、VRコントローラのインタラクションをDOM要素に`dispatchEvent`で直接ディスパッチする。このイベントは`bubbles: false`で発火されるため、親要素でのキャプチャリスナーでは傍受できない。`<a href="...">`要素にclickイベントがディスパッチされると、ブラウザのデフォルト動作（ページ遷移）が実行される。

`href`属性の除去で対処可能だが、問題1が解決しない限り実用的なVR内Web閲覧は実現できない。

### 将来の解決方針

以下のアプローチを将来のADRで検討する:

1. **Tab Capture API / `getViewportMedia()`によるスクリーンキャプチャ**: iframeの描画結果をブラウザのレンダリングエンジンで直接キャプチャし、テクスチャとして使用する。DOM複製が不要になりレイアウトの完全な再現が可能だが、ブラウザの対応状況と権限要求が課題。
2. **サーバサイドレンダリング（Puppeteer / Playwright）**: サーバ上でヘッドレスブラウザを用いてWebページをスクリーンショット化し、定期的にテクスチャとしてクライアントに配信する。レイアウトの完全な再現が可能だがサーバリソースが必要。
3. **WebCodecs + Canvas描画**: iframeのcontentWindowをVideoFrameとしてキャプチャし、Canvas経由でテクスチャ化する。ブラウザAPI依存。

## スコープ外（将来のADR候補）

- **VR内テキスト入力**: iframe内のフォームへのテキスト入力（VRキーボード連携）
- **クロスオリジンiframeの完全描画**: クロスオリジンコンテンツのVR内表示手法
- **動画ストリーミング最適化**: YouTube等の動画コンテンツに対する専用表示方式
- **マルチユーザー同期**: VRユーザーのiframe操作を他ユーザーと同期する仕組み

## 参考

- [ADR-008: WebXR対応とHTTPS開発環境](./ADR-008-webxr-https.md)
- [ADR-009: VRコントローラ操作マッピング改訂](./ADR-009-vr-controls-revised.md)
- [three.js#22786: CSS3DRenderer XR support](https://github.com/mrdoob/three.js/issues/22786)
- [Three.js HTMLMesh](https://github.com/mrdoob/three.js/blob/master/examples/jsm/interactive/HTMLMesh.js)
- [Three.js InteractiveGroup](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/interactive/InteractiveGroup.js)
- [Three.js webxr_vr_sandbox example](https://threejs.org/examples/#webxr_vr_sandbox)
