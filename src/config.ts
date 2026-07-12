import { N8nClient } from "./client.ts";
import { Effect } from "effect";
import {
  ConfigError,
  fromProcessEnv,
  optionalString,
  parseBooleanEnv,
  parseNumberEnv,
  requiredString,
  type EnvReader,
} from "@lidless-labs/effect-operator-kit";

export interface N8nPluginConfig {
  baseUrl: string;
  apiKeyInline: string;
  apiKeyEnv: string;
  enableEdit: boolean;
  /**
   * Second gate, on top of `enableEdit`, for the credential write tools
   * (`n8n_create_credential`, `n8n_delete_credential`). Default false.
   * Forces explicit opt-in for the only path in this package where agent
   * input contains plaintext secrets (create) or where deletion can break
   * every workflow referencing the credential (delete).
   */
  enableCredentialsWrite: boolean;
  maxExecutionLogBytes: number;
  requestTimeoutMs: number;
  backupDir?: string;
}

/**
 * Bridge kit Effect config primitives to this repo's sync throw-on-error contract.
 */
function runConfigEffect<A, E extends ConfigError>(
  effect: Effect.Effect<A, E>,
): A {
  const result = Effect.runSync(Effect.either(effect));
  if (result._tag === "Left") {
    throw new Error(result.left.message);
  }
  return result.right;
}

function runOptionalString(
  env: EnvReader,
  key: string,
  fallback?: string,
): string | undefined {
  return Effect.runSync(optionalString(env, key, fallback));
}

/**
 * Kit `requiredString` uses a generic `${key} is required` message; MCP env
 * parsing needs repo-specific copy preserved byte-for-byte.
 */
function requiredEnvString(
  env: EnvReader,
  key: string,
  message: string,
): string {
  const raw = env.get(key);
  if (raw === undefined || raw.trim() === "") {
    throw new Error(message);
  }
  return runConfigEffect(requiredString(env, key));
}

/**
 * Kit `parseBooleanEnv` throws on invalid tokens and accepts on/off. MCP env
 * parsing silently coerces invalid values to false and only accepts
 * 1/true/yes and 0/false/no.
 */
function parseBoolEnvSilent(env: EnvReader, key: string): boolean {
  const raw = env.get(key);
  if (raw === undefined) {
    return false;
  }
  const token = raw.trim().toLowerCase();
  if (token === "") {
    return false;
  }
  if (token === "1" || token === "true" || token === "yes") {
    return runConfigEffect(parseBooleanEnv(env, key, false));
  }
  if (token === "0" || token === "false" || token === "no") {
    return runConfigEffect(parseBooleanEnv(env, key, true));
  }
  return false;
}

/**
 * Kit `parseNumberEnv` allows non-integers and uses different error text. MCP
 * env parsing requires integer >= min with `${key} must be an integer >= ${min}
 * (got ${JSON.stringify(raw)}).`
 */
function parsePosIntEnv(
  env: EnvReader,
  key: string,
  fallback: number,
  min: number,
): number {
  const raw = env.get(key);
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  let n: number;
  try {
    n = runConfigEffect(parseNumberEnv(env, key, {}));
  } catch {
    throw new Error(
      `${key} must be an integer >= ${min} (got ${JSON.stringify(raw)}).`,
    );
  }
  if (!Number.isInteger(n) || n < min) {
    throw new Error(
      `${key} must be an integer >= ${min} (got ${JSON.stringify(raw)}).`,
    );
  }
  return n;
}

/**
 * MCP server env config. Uses kit `fromProcessEnv` / `optionalString` where
 * semantics match; repo-local wrappers preserve MCP-specific messages and
 * silent-invalid boolean coercion. `normalizeBaseUrl` and `parseTimeoutEnv`
 * are intentionally not used — baseUrl is trim-only (N8nClient strips `/`).
 */
export function readConfigFromEnv(
  processEnv: NodeJS.ProcessEnv = process.env,
): N8nPluginConfig {
  const env = fromProcessEnv(processEnv);

  const baseUrl = requiredEnvString(
    env,
    "N8N_BASE_URL",
    "N8N_BASE_URL is required (e.g. http://localhost:5678). Set it in your MCP client env config.",
  );

  const apiKeyEnv =
    runOptionalString(env, "N8N_API_KEY_ENV", "N8N_API_KEY") || "N8N_API_KEY";

  const apiKey = requiredEnvString(
    env,
    apiKeyEnv,
    `${apiKeyEnv} is required. Set it in your MCP client env config (generate an API key in n8n under Settings -> API).`,
  );

  const backupDir = runOptionalString(env, "N8N_BACKUP_DIR");

  return {
    baseUrl,
    apiKeyInline: apiKey,
    apiKeyEnv,
    enableEdit: parseBoolEnvSilent(env, "N8N_ENABLE_EDIT"),
    enableCredentialsWrite: parseBoolEnvSilent(env, "N8N_ENABLE_CREDENTIALS_WRITE"),
    maxExecutionLogBytes: parsePosIntEnv(env, "N8N_MAX_EXECUTION_LOG_BYTES", 65_536, 1024),
    requestTimeoutMs: parsePosIntEnv(env, "N8N_REQUEST_TIMEOUT_MS", 15_000, 1000),
    backupDir: backupDir || undefined,
  };
}

export function resolveConfig(raw: unknown): N8nPluginConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("openclaw-n8n: plugin config missing");
  }
  const c = raw as Record<string, unknown>;
  const baseUrl = typeof c.baseUrl === "string" ? c.baseUrl.trim() : "";
  if (!baseUrl) throw new Error("openclaw-n8n: baseUrl is required");
  const apiKeyEnv =
    typeof c.apiKeyEnv === "string" && c.apiKeyEnv.trim() ? c.apiKeyEnv.trim() : "N8N_API_KEY";
  const apiKeyInline = typeof c.apiKey === "string" ? c.apiKey.trim() : "";
  return {
    baseUrl,
    apiKeyInline,
    apiKeyEnv,
    enableEdit: c.enableEdit === true,
    enableCredentialsWrite: c.enableCredentialsWrite === true,
    maxExecutionLogBytes:
      typeof c.maxExecutionLogBytes === "number" ? c.maxExecutionLogBytes : 65_536,
    requestTimeoutMs:
      typeof c.requestTimeoutMs === "number" ? c.requestTimeoutMs : 15_000,
    backupDir:
      typeof c.backupDir === "string" && c.backupDir ? c.backupDir : undefined,
  };
}

export function resolveApiKey(config: N8nPluginConfig): string {
  if (config.apiKeyInline) return config.apiKeyInline;
  const fromEnv = (process.env[config.apiKeyEnv] ?? "").trim();
  if (!fromEnv) {
    throw new Error(
      `openclaw-n8n: apiKey is empty and env var ${config.apiKeyEnv} is not set`,
    );
  }
  return fromEnv;
}

export function makeClient(config: N8nPluginConfig): N8nClient {
  return new N8nClient({
    baseUrl: config.baseUrl,
    apiKey: resolveApiKey(config),
    timeoutMs: config.requestTimeoutMs,
  });
}
