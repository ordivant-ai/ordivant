import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeConfig, RuntimeMode } from "./types.js";

interface BootstrapFile {
  runtime_token?: unknown;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === "") return 8090;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("ORDIVANT_RUNTIME_PORT must be an integer from 1 to 65535");
  }
  return port;
}

function parseMode(value: string | undefined): RuntimeMode {
  const mode = value ?? "demo";
  if (mode !== "demo" && mode !== "live") throw new Error("ORDIVANT_RUNTIME_MODE must be demo or live");
  return mode;
}

function parseHosts(value: string | undefined, name: string): string[] {
  const hosts = (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  for (const host of hosts) {
    if (host.includes("*") || host.includes("/") || host.includes("@") || host.includes(" ") || host.includes("#")) {
      throw new Error(`${name} must contain exact hostnames only`);
    }
    try {
      const parsed = new URL(host.includes(":") ? `https://[${host}]` : `https://${host}`);
      if (parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "") !== host.replace(/^\[|\]$/g, "").replace(/\.$/, "")) {
        throw new Error("host normalization changed");
      }
    } catch {
      throw new Error(`${name} contains an invalid host`);
    }
  }
  return [...new Set(hosts.map((host) => host.replace(/^\[|\]$/g, "").replace(/\.$/, "")))];
}

function readOptionalSecretFile(path: string | undefined, name: string): string | undefined {
  if (!path) return undefined;
  let value: string;
  try {
    value = readFileSync(path, "utf8").trim();
  } catch {
    throw new Error(`${name} file is unavailable`);
  }
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const dataDir = resolve(env.ORDIVANT_DATA_DIR ?? join(runtimeRoot, ".data"));
  const runtimeDir = join(dataDir, "runtime");
  const bootstrapPath = resolve(env.ORDIVANT_BOOTSTRAP_PATH ?? join(dataDir, "bootstrap.json"));
  let bootstrap: BootstrapFile = {};
  if (existsSync(bootstrapPath)) {
    try {
      bootstrap = JSON.parse(readFileSync(bootstrapPath, "utf8")) as BootstrapFile;
    } catch {
      throw new Error("Could not read the runtime bootstrap file as JSON");
    }
  }

  const mode = parseMode(env.ORDIVANT_RUNTIME_MODE);
  const runtimeToken = env.ORDIVANT_RUNTIME_TOKEN ??
    (typeof bootstrap.runtime_token === "string" ? bootstrap.runtime_token : undefined);
  if ((env.NODE_ENV === "production" || env.ORDIVANT_MODE === "production") && !runtimeToken) {
    throw new Error("ORDIVANT_RUNTIME_TOKEN is required in production");
  }

  const sandboxUrl = env.ORDIVANT_SANDBOX_URL?.replace(/\/$/, "");
  const sandboxToken = readOptionalSecretFile(env.ORDIVANT_SANDBOX_TOKEN_FILE, "ORDIVANT_SANDBOX_TOKEN_FILE");
  if (sandboxUrl && !sandboxToken) throw new Error("ORDIVANT_SANDBOX_TOKEN_FILE is required when sandbox execution is enabled");
  if (sandboxUrl) {
    let parsed: URL;
    try {
      parsed = new URL(sandboxUrl);
    } catch {
      throw new Error("ORDIVANT_SANDBOX_URL must be a valid HTTP URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("ORDIVANT_SANDBOX_URL must use HTTP or HTTPS");
  }

  const modelProvider = mode === "demo" ? "ordivant-demo" : "runtime-selection";

  return {
    mode,
    dataDir,
    runtimeDir,
    bootstrapPath,
    apiUrl: (env.ORDIVANT_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, ""),
    runtimeToken,
    modelProvider,
    modelId: mode === "demo" ? "deterministic-v1" : "per-event-selection",
    port: parsePort(env.ORDIVANT_RUNTIME_PORT),
    host: env.ORDIVANT_RUNTIME_HOST ?? "127.0.0.1",
    workerId: env.ORDIVANT_RUNTIME_WORKER_ID ?? `runtime-${process.pid}-${randomUUID()}`,
    sandboxUrl,
    sandboxToken,
    toolAllowedHosts: parseHosts(env.ORDIVANT_TOOL_ALLOWED_HOSTS, "ORDIVANT_TOOL_ALLOWED_HOSTS"),
    toolHttpHosts: parseHosts(env.ORDIVANT_TOOL_HTTP_HOSTS, "ORDIVANT_TOOL_HTTP_HOSTS"),
    toolPrivateHosts: parseHosts(env.ORDIVANT_TOOL_PRIVATE_HOSTS, "ORDIVANT_TOOL_PRIVATE_HOSTS"),
  };
}
