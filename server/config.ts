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
