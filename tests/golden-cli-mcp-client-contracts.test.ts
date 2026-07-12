import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { N8nClient } from "../src/client.ts";
import { run, type CliDeps } from "../src/cli.ts";
import { makeFakeFetch, type FakeFetch } from "./helpers-fetch.ts";

function deps(overrides: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const base: CliDeps = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    makeClient: () =>
      ({
        redact: (s: string) => s,
        listWorkflows: vi.fn().mockResolvedValue({ data: [] }),
      }) as unknown as N8nClient,
    getBaseUrl: () => "https://n8n.example.com",
    serve: vi.fn().mockResolvedValue(undefined),
  };
  return { out, err, deps: { ...base, ...overrides } };
}

describe("golden CLI exit and stderr contracts", () => {
  it("returns exit 2 and prints the current stderr for an unknown command", async () => {
    const captured = deps();

    await expect(run(["nope"], captured.deps)).resolves.toBe(2);

    expect(captured.err[0]).toBe("Unknown command group: nope");
    expect(captured.err[1]).toBe("");
    expect(captured.err.join("\n")).toContain("Usage:");
  });

  it("returns exit 1 and prints the current stderr for a failed API call", async () => {
    const client = {
      redact: (s: string) => s,
      listWorkflows: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5678")),
    } as unknown as N8nClient;
    const captured = deps({ makeClient: () => client });

    await expect(run(["workflows", "list"], captured.deps)).resolves.toBe(1);

    expect(captured.err).toEqual(["connect ECONNREFUSED 127.0.0.1:5678"]);
  });

  it("rejects with the original error when client construction fails (current contract: caller handles it)", async () => {
    // Unlike jellyctrl post-migration, n8nctrl's run() calls makeClient() outside
    // any catch (src/cli.ts:661): the throw propagates to the caller and nothing
    // is written through deps.err. Changing this to resolve-1 would be a behavior
    // change and needs its own decision, not a silent migration side effect.
    const constructionError = new Error(
      "N8N_BASE_URL is required (e.g. http://localhost:5678). Set it in your shell or .env.",
    );
    const captured = deps({
      makeClient: () => {
        throw constructionError;
      },
    });

    await expect(run(["workflows", "list"], captured.deps)).rejects.toBe(constructionError);
    expect(captured.err).toEqual([]);
  });
});

describe("golden programmatic MCP startup contract", () => {
  it("preserves the startup rejection object identity on the mcp path", async () => {
    const startupError = new Error("N8N_BASE_URL is required");
    const captured = deps({
      serve: vi.fn().mockRejectedValue(startupError),
    });

    await expect(run(["mcp"], captured.deps)).rejects.toBe(startupError);
  });
});

describe("golden n8n client auth header contract", () => {
  let fake: FakeFetch;

  beforeEach(() => {
    fake = makeFakeFetch();
  });

  afterEach(() => {
    fake.restore();
  });

  it("sends X-N8N-API-KEY exactly and never sends Authorization", async () => {
    fake.queue({ body: { data: [] } });
    const client = new N8nClient({
      baseUrl: "https://n8n.example.com",
      apiKey: "secret-api-key",
      timeoutMs: 1_000,
    });

    await client.listWorkflows({ limit: 10 });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].headers["x-n8n-api-key"]).toBe("secret-api-key");
    expect(fake.calls[0].headers.authorization).toBeUndefined();
    expect(Object.keys(fake.calls[0].headers)).not.toContain("authorization");
  });
});
