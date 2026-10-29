import { afterEach, describe, expect, it, vi } from "vitest";
import { N8nClient } from "../src/client.ts";

const client = (maxResponseBytes?: number) => new N8nClient({
  baseUrl: "https://n8n.example.com", apiKey: "fixture-only-value", timeoutMs: 1000, maxResponseBytes,
});
afterEach(() => vi.unstubAllGlobals());
describe("shared kit safety integration", () => {
  it("honors an explicit response budget above the kit default", async () => {
    const name = "a".repeat(10 * 1024 * 1024 + 1);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name }))));
    expect((await client(12 * 1024 * 1024).getWorkflow("wf-1")).name.length).toBe(name.length);
  });
  it.each([0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe byte budget %s before HTTP", (maxBytes) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(() => client(maxBytes)).toThrow(/positive safe integer/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("maps a deterministic redirect refusal without replaying a write", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://other.example.com" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(client().saveWorkflow("wf-1", {})).rejects.toThrow(/redirects are disabled/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
