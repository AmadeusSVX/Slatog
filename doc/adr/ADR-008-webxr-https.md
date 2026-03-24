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
- **移動**: VRコントローラのスティック入力によるテレポーテーションまたはスムース移動は本ADRのスコープ外とし、ヘッドセットの物理的な移動（ルームスケール）のみで空間内を移動する。
- **既存オブジェクトの表示**: ペンストローク（D21）、テキストステッカー（D23）、プリミティブ（D31）はすべてThree.jsのシーングラフに存在するため、VRモードでも追加実装なしに表示される。
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

## 実装ロードマップへの影響

以下の項目をADR-001〜ADR-007のロードマップに追加する:

### Phase 2への追加（3D空間）

- D37: Vite HTTPS設定・`@vitejs/plugin-basic-ssl`導入
- D36: WebXR VRセッション対応・VRButton追加・レンダリングループ変更

D37（HTTPS）はD36（WebXR）の前提条件であるため、先に実装する。

## スコープ外（将来のADR候補）

本ADRでは以下を明示的にスコープ外とする:

- **VRコントローラ入力**: スティック移動、テレポーテーション、ポインタによるオブジェクト操作
- **VR内3D UI**: VR空間内でのメニュー表示・テキスト入力
- **AR対応**: `immersive-ar`セッションモード
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
- [Three.js WebXR Documentation](https://threejs.org/docs/#manual/en/introduction/How-to-create-VR-content)
- [@vitejs/plugin-basic-ssl](https://github.com/nicolo-ribaudo/vite-plugin-basic-ssl)
