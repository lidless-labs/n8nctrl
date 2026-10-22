import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { assertNoDrift, assertToolAnnotations, type ToolAnnotations } from "@lidless-labs/effect-operator-kit";
import { buildServer } from "../mcp-server.ts";
import type { N8nPluginConfig } from "../src/config.ts";
import { TOOL_TIERS } from "../src/tools/annotations.ts";
import { jsonToolResult } from "../src/tools/result.ts";

function config(overrides: Partial<N8nPluginConfig> = {}): N8nPluginConfig {
  return {
    baseUrl: "https://n8n.example.com",
    apiKeyInline: "test-key",
    apiKeyEnv: "N8N_API_KEY",
    enableEdit: false,
    enableCredentialsWrite: false,
    maxExecutionLogBytes: 65_536,
    requestTimeoutMs: 15_000,
    ...overrides,
  };
}

function registered(overrides: Partial<N8nPluginConfig>): Map<string, ToolAnnotations | undefined> {
  const tools = (buildServer(config(overrides)) as unknown as {
    _registeredTools: Record<string, { annotations?: ToolAnnotations }>;
  })._registeredTools;
  return new Map(Object.entries(tools).map(([name, tool]) => [name, tool.annotations]));
}

describe("tool annotations", () => {
  const full = registered({ enableEdit: true, enableCredentialsWrite: true });

  it("classifies exactly the registered tools", () => {
    assertNoDrift(full.keys(), TOOL_TIERS);
    expect(full.size).toBe(40);
  });

  it("declares explicit hints on every tool and passes the kit audit", () => {
    assertToolAnnotations(full);
  });

  it("marks the 20 reads read-only and the 20 writes destructive", () => {
    for (const [name, annotations] of full) {
      const isRead = TOOL_TIERS[name] === "read";
      expect(annotations?.readOnlyHint, name).toBe(isRead);
      expect(annotations?.destructiveHint, name).toBe(!isRead);
    }
    expect([...full.values()].filter((a) => a?.readOnlyHint)).toHaveLength(20);
  });

  it("registers only read-only tools when edit is disabled", () => {
    const readOnly = registered({ enableEdit: false });
    expect(readOnly.size).toBe(20);
    for (const [name, annotations] of readOnly) expect(annotations?.readOnlyHint, name).toBe(true);
  });
});

describe("jsonToolResult byte cap", () => {
  it("returns a small payload with content and details only", () => {
    expect(jsonToolResult({ a: 1 })).toEqual({
      content: [{ type: "text", text: JSON.stringify({ a: 1 }, null, 2) }],
      details: { a: 1 },
    });
  });

  it("truncates an oversize payload with the kit marker and reports the flag as details", () => {
    const result = jsonToolResult({ rows: "é".repeat(80_000) });
    expect(Buffer.byteLength(JSON.stringify(result.content), "utf8")).toBeLessThanOrEqual(90_000);
    expect(result.content[0]!.text).toContain("[truncated: output was");
    expect(result.structuredContent).toMatchObject({ truncated: true, maxBytes: 90_000 });
    expect(result.details).toEqual(result.structuredContent);
  });

  it("keeps a payload that fits as text even when its details copy would not double", () => {
    const result = jsonToolResult({ rows: "x".repeat(60_000) });
    expect(result.content[0]!.text).not.toContain("[truncated");
    expect(result).not.toHaveProperty("structuredContent");
  });
});

describe("MCP boundary byte cap", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function call(name: string, args: Record<string, unknown>) {
    const server = buildServer(config());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "cap-test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      return await client.callTool({ name, arguments: args });
    } finally {
      await client.close();
      await server.close();
    }
  }

  it("forwards the truncation flag for an oversize success result", async () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ id: String(i), name: "é".repeat(400), active: false }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: rows }), { status: 200, headers: { "content-type": "application/json" } })));
    const result = await call("n8n_list_workflows", { limit: 250 });
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(90_000);
    expect(JSON.stringify(result.content)).toContain("[truncated: output was");
    expect(result.structuredContent).toMatchObject({ truncated: true, maxBytes: 90_000 });
  });

  it("forwards the truncation flag for an oversize error and leaves a short error flag-free", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("x".repeat(200_000)); }));
    const big = await call("n8n_list_workflows", {});
    expect(big.isError).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(big), "utf8")).toBeLessThanOrEqual(90_000);
    expect(big.structuredContent).toMatchObject({ truncated: true });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    const small = await call("n8n_list_workflows", {});
    expect(small.isError).toBe(true);
    expect(small).not.toHaveProperty("structuredContent");
  });
});
