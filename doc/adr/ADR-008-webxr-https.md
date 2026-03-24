# ADR-008: WebXR対応とHTTPS開発環境

## ステータス

**提案中（Proposed）**

## 日付

2026-03-23

## コンテキスト

1. **VRヘッドセットでの没入体験が提供できない**: Slatogは3D空間でのコラボレーションツールであるが、現在デスクトップブラウザでの平面表示のみに対応しており、Meta Questなどのスタンドアロン型VRヘッドセットで没入的に利用する手段がない。WebXR Device APIを利用すれば、ブラウザベースのまま既存のThree.jsシーンをVR空間に投影でき、プラットフォーム固有のネイティブアプリ開発を回避しつつ没入体験を実現できる。
2. **WebXRの動作にはHTTPSが必須**: WebXR Device APIはSecure Context（HTTPS または localhost）でのみ利用可能である。現在の開発サーバはHTTPで動作しているため、LAN上のVRヘッドセットからWebXRセッションを開始できない。開発環境でもHTTPS（自己署名証明書）を提供する必要がある。

## 決定事項

### D36: WebXR VRセッション — Three.js WebXRManagerによるイマーシブVR対応

Three.jsの`WebXRManager`を利用してWebXR VRセッションに対応する。ユーザーは「Enter VR」ボタンからイマーシブVRモードに入り、既存の3D空間をVRヘッドセット内で体験できる。

**対応セッションモード**:

| モード | WebXR sessionMode | 用途                       |
| ------ | ----------------- | -------------------------- |
| VR     | `immersive-vr`    | VRヘッドセットでの没入表示 |

- AR（`immersive-ar`）は本ADRのスコープ外とする。将来のADRで検討する。

**VRセッション開始フロー**:

```
1. ページ読み込み時にnavigator.xr.isSessionSupported('immersive-vr')を確認
2. サポートされている場合のみ「Enter VR」ボタンを表示
3. ユーザーが「Enter VR」ボタンをクリック
4. renderer.xr.enabled = true を設定
5. navigator.xr.requestSession('immersive-vr')でセッション開始
6. Three.jsのWebXRManagerがレンダリングループを自動的にXR対応に切り替え
7. 「Exit VR」操作またはヘッドセット側の終了操作でセッション終了
```

**Three.js WebXR設定**:

```typescript
// WebXRの有効化
renderer.xr.enabled = true;

// VRButtonの追加（Three.js標準ヘルパー）
import { VRButton } from "three/addons/webxr/VRButton.js";
document.body.appendChild(VRButton.createButton(renderer));

// レンダリングループをsetAnimationLoopに変更（WebXR要件）
renderer.setAnimationLoop(render);
```

**VRモード時の振る舞い**:

- **カメラ**: WebXRManagerがヘッドセットのトラッキング情報をカメラに自動反映する。既存のカメラ操作（D34）はVRモード中は無効化される。
- **移動**: D38（後述）のコントローラスティック入力による移動を使用する。ヘッドセットの物理的な移動（ルームスケール）も併用可能。
- **既存オブジェクトの表示**: ペンストローク（D21）、テキストステッカー（D23）、プリミティブ（D31）はすべてThree.jsのシーングラフに存在するため、VRモードでも追加実装なしに表示される。
- **オブジェクト操作**: ペンストローク描画やオブジェクト配置はD39（後述）のコントローラ入力を介して行う。
- **UIオーバーレイ**: HTML/CSSベースの2D UIパネル（チャット、ペン設定、プリミティブ選択等）はVRモード中は非表示とする。VR内UIは本ADRのスコープ外とし、将来のADRで3D UIパネルとして検討する。

**レンダリングループの変更**:

```diff
- function animate() {
-   requestAnimationFrame(animate);
-   render();
- }
- animate();
+ renderer.setAnimationLoop(render);
```

- `setAnimationLoop`はWebXRセッション中はXRフレームコールバックとして動作し、非XR時は`requestAnimationFrame`と同等に動作する。既存の非VR環境でも互換性を維持する。

**根拠**: Three.jsのWebXRManagerはWebXR Device APIの複雑性を抽象化し、既存のThree.jsシーンを最小限の変更でVR対応にできる。VRButtonヘルパーはセッションサポート判定・セッションライフサイクル管理を内包しており、ボイラープレートコードを大幅に削減する。ADR-001のマルチプラットフォーム方針（ブラウザベース・プラットフォーム固有機能に依存しない）に合致し、WebXR対応ブラウザを搭載するすべてのVRヘッドセットで動作する。

### D37: HTTPS開発環境 — Vite自己署名証明書によるHTTPSサーバ

開発サーバをHTTPSで起動し、LAN上のVRヘッドセットからSecure Contextとしてアクセス可能にする。Viteの`@vitejs/plugin-basic-ssl`プラグインを使用して自己署名証明書を自動生成する。

**Vite設定の変更**:

```typescript
// vite.config.ts
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [
    basicSsl(), // 自己署名証明書でHTTPS有効化
  ],
  server: {
    host: true, // LAN公開（0.0.0.0）— VRヘッドセットからのアクセス用
  },
});
```

**開発フロー**:

```
1. npm run dev でHTTPS開発サーバが起動
2. コンソールに https://192.168.x.x:5173 のURLが表示される
3. VRヘッドセットのブラウザで上記URLにアクセス
4. 自己署名証明書の警告を承認（初回のみ）
5. WebXRセッションが開始可能になる
```

**依存パッケージ**:

```
@vitejs/plugin-basic-ssl — devDependencies に追加
```

**本番環境**: 本番デプロイ時は正規のTLS証明書（Let's Encrypt等）を使用する。自己署名証明書は開発環境専用である。本番環境のHTTPS設定は本ADRのスコープ外とし、デプロイ基盤のADRで別途定義する。

**根拠**: WebXR Device APIはSecure Contextを要求するため（W3C仕様）、HTTPS対応は技術的必須要件である。`@vitejs/plugin-basic-ssl`はViteエコシステムの公式プラグインであり、手動での証明書生成・管理が不要で開発体験を損なわない。`server.host: true`により、同一LAN上のVRヘッドセットから開発マシンのIPアドレスで直接アクセスできる。

### D38: VRコントローラ移動 — スティック入力による空間内移動

VRコントローラのサムスティック（thumbstick）入力を用いて、VR空間内での移動を実現する。

**操作マッピング**:

| コントローラ     | 軸          | 操作                             |
| ---------------- | ----------- | -------------------------------- |
| 左サムスティック | X軸（左右） | 左右併進移動（strafe）           |
| 左サムスティック | Y軸（前後） | 前後併進移動（forward/backward） |
| 右サムスティック | Y軸（上下） | 上下移動（elevate/descend）      |

- 右サムスティックのX軸（左右）は本ADRでは未割当とし、将来のADRでスナップターン等に利用可能とする。
- 移動方向はヘッドセットの向き（カメラのforward方向）を基準とする。ユーザーが見ている方向に対して直感的に前後左右が対応する。
- 上下移動はワールド座標のY軸に沿って行い、ヘッドセットの向きに依存しない。

**入力取得方法**:

```typescript
const session = renderer.xr.getSession();
for (const source of session.inputSources) {
  if (source.gamepad && source.handedness === "left") {
    const [, , axisX, axisY] = source.gamepad.axes;
    // axisX: 左右移動, axisY: 前後移動
  }
  if (source.gamepad && source.handedness === "right") {
    const [, , , axisY] = source.gamepad.axes;
    // axisY: 上下移動
  }
}
```

**移動の実装方針**:

- `renderer.xr.getCamera()`からヘッドセットの向きを取得し、前後左右の移動方向ベクトルを算出する。
- XRRigGroup（VRカメラを包含する親グループ）のpositionを更新することで移動を実現する。ヘッドセットカメラ自体のtransformは変更しない。
- デッドゾーン（閾値: 0.15程度）を設定し、スティックの微小な入力を無視する。
- 移動速度は一定値とし、フレームレート非依存（delta time乗算）とする。

**根拠**: サムスティックによるスムース移動は、Meta Quest等のVRコントローラにおいて最も一般的で直感的な移動方式である。左スティック=水平移動、右スティック=垂直移動の分離により、同時操作が容易になる。

### D39: VRコントローラによるペンストローク描画・オブジェクト配置

VRコントローラを用いて、ペンストロークの描画およびオブジェクト（プリミティブ・テキストステッカー）の配置を行う。

**コントローラの視覚表示**:

```typescript
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";

const controllerModelFactory = new XRControllerModelFactory();

const controllerGrip0 = renderer.xr.getControllerGrip(0);
controllerGrip0.add(controllerModelFactory.createControllerModel(controllerGrip0));
scene.add(controllerGrip0);

const controllerGrip1 = renderer.xr.getControllerGrip(1);
controllerGrip1.add(controllerModelFactory.createControllerModel(controllerGrip1));
scene.add(controllerGrip1);
```

**コントローラのレイキャスト**:

- コントローラの位置・向きからレイ（光線）を前方に投射し、シーン内のオブジェクトや仮想面との交差判定を行う。
- レイはThree.jsの`Raycaster`を使用し、コントローラの`targetRaySpace`から方向を取得する。
- レイの視覚的フィードバックとして、コントローラから伸びる細い線（レイポインタ）を表示する。

**ペンストローク描画（D21拡張）**:

| 入力                   | 動作                                               |
| ---------------------- | -------------------------------------------------- |
| トリガーボタン押下開始 | ストローク開始（`selectstart`イベント）            |
| トリガーボタン押下中   | コントローラの3D位置をストロークポイントとして追加 |
| トリガーボタンリリース | ストローク終了・確定（`selectend`イベント）        |

- VRモードではコントローラの3D空間上の実位置を直接ストロークポイントとして使用する。
- ペンの色・太さは既存の設定値を引き継ぐ（VRモード突入前の設定を保持）。

**オブジェクト配置（D31/D23拡張）**:

| 入力                   | 動作                                       |
| ---------------------- | ------------------------------------------ |
| トリガーボタンクリック | レイキャストの交差位置にオブジェクトを配置 |

- プリミティブ（D31）およびテキストステッカー（D23）の配置は、コントローラのレイが指し示す位置に対して行う。
- 配置モードの切替（ペン/プリミティブ/ステッカー）はVR内UIとして将来のADRで検討する。初期実装ではVRモード突入前に設定したモードを維持する。

**WebXRイベント**:

```typescript
const controller = renderer.xr.getController(0);
controller.addEventListener("selectstart", onSelectStart); // トリガー押下
controller.addEventListener("selectend", onSelectEnd); // トリガーリリース
controller.addEventListener("connected", (event) => {
  // event.data: XRInputSource — handedness, gamepad等の情報
});
scene.add(controller);
```

**根拠**: WebXRの`selectstart`/`selectend`イベントはコントローラのプライマリアクション（トリガーボタン）に標準的に対応しており、デバイス非依存の入力抽象化を提供する。`XRControllerModelFactory`はWebXR Input Profilesに基づいてデバイスに合ったコントローラモデルを自動表示する。

## 実装ロードマップへの影響

以下の項目をADR-001〜ADR-007のロードマップに追加する:

### Phase 2への追加（3D空間）

- D37: Vite HTTPS設定・`@vitejs/plugin-basic-ssl`導入
- D36: WebXR VRセッション対応・VRButton追加・レンダリングループ変更
- D38: VRコントローラ移動（スティック入力）
- D39: VRコントローラによるペンストローク描画・オブジェクト配置

D37 → D36 → D38 → D39 の順に実装する。D37（HTTPS）はD36（WebXR）の前提条件であり、D38（移動）・D39（操作）はD36のVRセッション上で動作する。

## スコープ外（将来のADR候補）

本ADRでは以下を明示的にスコープ外とする:

- **VR内3D UI**: VR空間内でのメニュー表示・テキスト入力・モード切替パネル
- **AR対応**: `immersive-ar`セッションモード
- **スナップターン**: 右スティックX軸による回転移動
- **テレポーテーション移動**: アーク表示による瞬間移動
- **グラブ操作**: コントローラでオブジェクトを掴んで移動・回転
- **ハンドトラッキング**: コントローラ不要のハンドジェスチャ入力
- **本番HTTPS**: Let's Encrypt等による正規TLS証明書の設定

## 参考

- [ADR-001: Slatog初期アーキテクチャ](./ADR-001-slatog.md)
- [ADR-002: ユーザー識別・ルーム空間・セッション永続化](./ADR-002-enhancements.md)
- [ADR-003: チャット機能のトグル化とテキストステッカー機能の追加](./ADR-003-text-sticker.md)
- [ADR-004: ライティング復元・テキストステッカー改善・荒らし対策](./ADR-004-sticker-fixes.md)
- [ADR-005: ペン描画距離の短縮・テキストステッカーフォントサイズ調整](./ADR-005-pen-range-and-font-size.md)
- [ADR-006: プリミティブ配置モードとテキストステッカー文字数制限](./ADR-006-primitives-and-sticker-limit.md)
- [ADR-007: カメラ操作改善とレスポンシブUI](./ADR-007-camera-responsive.md)
- [W3C WebXR Device API](https://www.w3.org/TR/webxr/)
- [W3C WebXR Gamepads Module](https://www.w3.org/TR/webxr-gamepads-module-1/)
- [Three.js WebXR Documentation](https://threejs.org/docs/#manual/en/introduction/How-to-create-VR-content)
- [@vitejs/plugin-basic-ssl](https://github.com/nicolo-ribaudo/vite-plugin-basic-ssl)
