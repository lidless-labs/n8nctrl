import { describe, expect, it } from "vitest";
import { readConfigFromEnv, resolveConfig } from "../src/config.ts";

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    N8N_BASE_URL: "https://n8n.example.com",
    N8N_API_KEY: "test-key",
    ...overrides,
  };
}

describe("readConfigFromEnv", () => {
  it.each([
    ["true", true],
    ["TRUE", true],
    [" true ", true],
    ["false", false],
    ["FALSE", false],
    [" false ", false],
    ["invalid", false],
    ["", false],
    [undefined, false],
  ] as const)("parses N8N_ENABLE_EDIT=%s as %s", (raw, expected) => {
    const processEnv = env(
      raw === undefined ? {} : { N8N_ENABLE_EDIT: raw },
    );

    expect(readConfigFromEnv(processEnv).enableEdit).toBe(expected);
  });

  it.each([
    ["true", true],
    ["TRUE", true],
    [" true ", true],
    ["false", false],
    ["FALSE", false],
    [" false ", false],
    ["invalid", false],
    ["", false],
    [undefined, false],
  ] as const)(
    "parses N8N_ENABLE_CREDENTIALS_WRITE=%s as %s",
    (raw, expected) => {
      const processEnv = env(
        raw === undefined ? {} : { N8N_ENABLE_CREDENTIALS_WRITE: raw },
      );

      expect(readConfigFromEnv(processEnv).enableCredentialsWrite).toBe(expected);
    },
  );

  it("uses default integer config when timeout and log byte envs are unset or blank", () => {
    expect(readConfigFromEnv(env()).requestTimeoutMs).toBe(15_000);
    expect(readConfigFromEnv(env()).maxExecutionLogBytes).toBe(65_536);

    const blank = readConfigFromEnv(
      env({
        N8N_REQUEST_TIMEOUT_MS: " ",
        N8N_MAX_EXECUTION_LOG_BYTES: "",
      }),
    );
    expect(blank.requestTimeoutMs).toBe(15_000);
    expect(blank.maxExecutionLogBytes).toBe(65_536);
  });

  it("parses integer config with trim behavior and rejects invalid values", () => {
    const parsed = readConfigFromEnv(
      env({
        N8N_REQUEST_TIMEOUT_MS: " 2000 ",
        N8N_MAX_EXECUTION_LOG_BYTES: " 2048 ",
      }),
    );

    expect(parsed.requestTimeoutMs).toBe(2000);
    expect(parsed.maxExecutionLogBytes).toBe(2048);

    expect(() =>
      readConfigFromEnv(env({ N8N_REQUEST_TIMEOUT_MS: "999" })),
    ).toThrow('N8N_REQUEST_TIMEOUT_MS must be an integer >= 1000 (got "999").');
    expect(() =>
      readConfigFromEnv(env({ N8N_MAX_EXECUTION_LOG_BYTES: "1023" })),
    ).toThrow(
      'N8N_MAX_EXECUTION_LOG_BYTES must be an integer >= 1024 (got "1023").',
    );
    expect(() =>
      readConfigFromEnv(env({ N8N_REQUEST_TIMEOUT_MS: "1.5" })),
    ).toThrow('N8N_REQUEST_TIMEOUT_MS must be an integer >= 1000 (got "1.5").');
    expect(() =>
      readConfigFromEnv(env({ N8N_MAX_EXECUTION_LOG_BYTES: "bogus" })),
    ).toThrow(
      'N8N_MAX_EXECUTION_LOG_BYTES must be an integer >= 1024 (got "bogus").',
    );
  });

  it("trims string config values before returning them", () => {
    const parsed = readConfigFromEnv(
      env({
        N8N_BASE_URL: " https://n8n.example.com/ ",
        N8N_API_KEY_ENV: " CUSTOM_N8N_KEY ",
        CUSTOM_N8N_KEY: " inline-secret ",
        N8N_BACKUP_DIR: " /tmp/n8n-backups ",
      }),
    );

    expect(parsed.baseUrl).toBe("https://n8n.example.com/");
    expect(parsed.apiKeyEnv).toBe("CUSTOM_N8N_KEY");
    expect(parsed.apiKeyInline).toBe("inline-secret");
    expect(parsed.backupDir).toBe("/tmp/n8n-backups");
  });
});

describe("resolveConfig", () => {
  it("keeps plugin write gates strict booleans", () => {
    expect(
      resolveConfig({
        baseUrl: " https://n8n.example.com ",
        apiKey: " test-key ",
        enableEdit: "true",
        enableCredentialsWrite: "true",
      }),
    ).toMatchObject({
      baseUrl: "https://n8n.example.com",
      apiKeyInline: "test-key",
      enableEdit: false,
      enableCredentialsWrite: false,
    });

    expect(
      resolveConfig({
        baseUrl: "https://n8n.example.com",
        apiKey: "test-key",
        enableEdit: true,
        enableCredentialsWrite: true,
      }),
    ).toMatchObject({
      enableEdit: true,
      enableCredentialsWrite: true,
    });
  });
});
