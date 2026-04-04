# ADR-011: アプリケーション設定と環境変数の分離

## ステータス

**提案中（Proposed）**

## 日付

2026-03-24

## コンテキスト

1. **全設定が環境変数に混在している**: Slatogサーバは12個の`process.env`参照で動作を制御しているが、その大半はアプリケーションの振る舞いを定義する設定（機能フラグ、レートリミット、セッションTTL等）であり、デプロイ環境ごとに異なるシークレットや接続情報ではない。これらを環境変数で管理するのは性質の混同である。

2. **設定の性質は2種類に分かれる**:
   - **アプリケーション設定**: アプリの振る舞いを定義する値。チーム全員が同じ値を共有すべきであり、バージョン管理される設定ファイルに置くべきもの。例: プロキシ有効/無効、チャット有効/無効、レートリミット閾値、セッションTTL。
   - **環境パラメータ**: デプロイ先やマシンごとに異なる値。秘密情報を含む可能性があり、バージョン管理すべきでないもの。例: リッスンポート、データベースURL、外部APIキー。

3. **Node.jsエコシステムでの標準パターン**: `config/`ディレクトリにJSONファイルを配置するパターンは、[node-config](https://github.com/node-config/node-config)、NestJS、[Twelve-Factor App](https://12factor.net/config)等で広く採用されている。`config/default.json`にデフォルト値を定義し、環境別ファイル（`production.json`等）でオーバーライドする構成が一般的である。

4. **現在のSlatogの設定一覧**:

   | 変数                           | 性質                           | 現在のデフォルト |
   | ------------------------------ | ------------------------------ | ---------------- |
   | `PORT`                         | **環境パラメータ**             | `3000`           |
   | `SLATOG_PROXY`                 | アプリケーション設定           | 無効             |
   | `SLATOG_CHAT`                  | アプリケーション設定           | 有効             |
   | `SLATOG_SESSION_TTL`           | アプリケーション設定           | `-1`（無効）     |
   | `SLATOG_STICKER_RATE_WINDOW`   | アプリケーション設定           | `30`             |
   | `SLATOG_STICKER_RATE_LIMIT`    | アプリケーション設定           | `5`              |
   | `SLATOG_STICKER_BAN_ENABLED`   | アプリケーション設定           | 有効             |
   | `SLATOG_STICKER_BAN_THRESHOLD` | アプリケーション設定           | `2`              |
   | `SLATOG_STICKER_BAN_MODE`      | アプリケーション設定           | `ban`            |
   | `SLATOG_STICKER_BAN_DURATION`  | アプリケーション設定           | `3600`           |
   | `VITE_API_BASE`                | 環境パラメータ（クライアント） | `""`             |
   | `VITE_WS_SIGNALING`            | 環境パラメータ（クライアント） | 自動検出         |

   12個中10個がアプリケーション設定であり、環境パラメータは`PORT`とVite用変数のみである。

## 決定事項

### D46: アプリケーション設定ファイルの導入

#### ファイル構成

```
config/
  default.json          # 全デフォルト値（Git管理）
  production.json       # 本番オーバーライド（Git管理）
  local.json            # 開発者個人のオーバーライド（Git管理しない）
server/
  config.ts             # 設定ローダー + 型定義
.env                    # 環境パラメータのみ（Git管理しない）
.env.example            # 環境パラメータのテンプレート（Git管理）
```

| ファイル                 | 用途                                           | Git管理  |
| ------------------------ | ---------------------------------------------- | -------- |
| `config/default.json`    | アプリケーション設定のデフォルト値             | **する** |
| `config/production.json` | 本番環境向けオーバーライド                     | **する** |
| `config/local.json`      | 開発者個人の設定オーバーライド                 | しない   |
| `.env.example`           | 環境パラメータのテンプレート                   | **する** |
| `.env`                   | 環境パラメータ（PORT等）                       | しない   |
| `server/config.ts`       | 設定ローダー（型定義 + JSON読み込み + マージ） | **する** |

#### `config/default.json`

チーム全員が共有するアプリケーション設定のデフォルト値。開発時に必要な全設定がここに記載される。

```json
{
  "proxy": {
    "enabled": true
  },
  "chat": {
    "enabled": true
  },
  "session": {
    "ttlSeconds": -1
  },
  "sticker": {
    "rateWindow": 30,
    "rateLimit": 5,
    "ban": {
      "enabled": true,
      "threshold": 2,
      "mode": "ban",
      "durationSeconds": 3600
    }
  }
}
```

構造化JSONにより、フラットな環境変数名（`SLATOG_STICKER_BAN_THRESHOLD`）より意図が明確になる。

#### `config/production.json`

本番環境で異なる値のみを記載。`default.json`の値をディープマージでオーバーライドする。

```json
{
  "session": {
    "ttlSeconds": 86400
  },
  "sticker": {
    "rateLimit": 3,
    "ban": {
      "durationSeconds": 7200
    }
  }
}
```

#### `config/local.json`

開発者が個人的にオーバーライドしたい場合に使用する。`.gitignore`で除外される。

#### `.env.example`

環境パラメータのみを記載するテンプレート。

```bash
# 環境パラメータ（デプロイ先ごとに異なる値）
# このファイルを .env にコピーして使用: cp .env.example .env
PORT=3000
```

Slatogは現時点でデータベースや外部APIを使用しないため、`PORT`のみが環境パラメータとなる。将来DB接続先やAPIキー等が追加される場合はここに記載する。

#### `server/config.ts` — 設定ローダー

サードパーティ依存なしで実装する。`config/default.json`を読み込み、`NODE_ENV`に対応するファイルと`local.json`でオーバーライドし、型付きオブジェクトとしてエクスポートする。

```typescript
import { readFileSync } from "fs";
import { resolve } from "path";

export interface AppConfig {
  proxy: { enabled: boolean };
  chat: { enabled: boolean };
  session: { ttlSeconds: number };
  sticker: {
    rateWindow: number;
    rateLimit: number;
    ban: {
      enabled: boolean;
      threshold: number;
      mode: "kick" | "ban";
      durationSeconds: number;
    };
  };
}

function loadJson(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

const configDir = resolve(import.meta.dirname, "..", "config");
const env = process.env.NODE_ENV ?? "development";

let merged = loadJson(resolve(configDir, "default.json"));
merged = deepMerge(merged, loadJson(resolve(configDir, `${env}.json`)));
merged = deepMerge(merged, loadJson(resolve(configDir, "local.json")));

export const appConfig = merged as unknown as AppConfig;
```

#### 利用側の変更

各モジュールは`process.env.SLATOG_*`の代わりに`appConfig`をインポートする。

**変更前**（`server/signaling.ts`）:

```typescript
const RATE_WINDOW = parseInt(process.env.SLATOG_STICKER_RATE_WINDOW ?? "30", 10) * 1000;
const RATE_LIMIT = parseInt(process.env.SLATOG_STICKER_RATE_LIMIT ?? "5", 10);
const BAN_ENABLED = process.env.SLATOG_STICKER_BAN_ENABLED !== "0";
```

**変更後**:

```typescript
import { appConfig } from "./config.js";

const RATE_WINDOW = appConfig.sticker.rateWindow * 1000;
const RATE_LIMIT = appConfig.sticker.rateLimit;
const BAN_ENABLED = appConfig.sticker.ban.enabled;
```

#### サーバ起動方法の変更

**package.json**:

```json
{
  "scripts": {
    "dev": "tsx --env-file=.env server/index.ts"
  }
}
```

Node.jsの`--env-file`フラグで`.env`の`PORT`を読み込む。アプリケーション設定は`config/`ディレクトリから自動読み込みされるため、コマンドラインでの指定は不要。

**Makefile**:

```makefile
install:
	npm install
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env from .env.example"; fi

dev:
	npm run dev
```

#### `.gitignore`への追加

```gitignore
config/local.json
```

**根拠**: アプリケーション設定をバージョン管理されたJSONファイルに分離することで、チーム全員が同じ設定で開発でき、設定の一覧性と変更履歴の追跡が可能になる。環境パラメータのみを`.env`に残すことで、Twelve-Factor Appの原則に沿った適切な関心の分離が実現できる。サードパーティ依存なしの薄いローダーにより、`node-config`等のパッケージ追加を回避しつつ、`config/default.json` + 環境別オーバーライドの標準パターンに準拠する。

### 制約事項

- `config/default.json`にはシークレットを含めない。シークレットが必要になった場合は`.env`に配置する。
- クライアント用の設定（`VITE_*`）は引き続きViteの`.env`自動読み込みに従う。`server/config.ts`の管轄外とする。
- `import.meta.dirname`はNode.js v21.2.0+で利用可能。それ以前のバージョンでは`fileURLToPath`による代替が必要。

## 実装ロードマップへの影響

D46は既存の全フェーズに影響する横断的変更であり、独立して実装する。

## 参考

- [Twelve-Factor App: III. Config](https://12factor.net/config)
- [node-config パターン](https://github.com/node-config/node-config)
- [Node.js `--env-file` ドキュメント](https://nodejs.org/docs/latest-v22.x/api/cli.html#--env-fileconfig)
