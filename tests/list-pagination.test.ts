import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { N8nClient } from "../src/client.ts";
import { createListExecutionsTool } from "../src/tools/list-executions.ts";
import { createListWorkflowsTool } from "../src/tools/list-workflows.ts";
import { makeFakeFetch, type FakeFetch } from "./helpers-fetch.ts";

const BASE = "https://n8n.example.com";
const API_KEY = "super-secret-api-key-abc123";

describe("list tool pagination cursors", () => {
  let fake: FakeFetch;
  let client: N8nClient;

  beforeEach(() => {
    fake = makeFakeFetch();
    client = new N8nClient({ baseUrl: BASE, apiKey: API_KEY });
  });

  afterEach(() => {
    fake.restore();
  });

  it("n8n_list_executions advertises a cursor parameter", () => {
    const tool = createListExecutionsTool(() => client);
    expect(Object.keys((tool.parameters as { properties: object }).properties)).toContain("cursor");
  });

  it("n8n_list_workflows advertises a cursor parameter", () => {
    const tool = createListWorkflowsTool(() => client);
    expect(Object.keys((tool.parameters as { properties: object }).properties)).toContain("cursor");
  });

  it("n8n_list_executions sends the cursor as a query parameter", async () => {
    fake.queue({ status: 200, body: { data: [], nextCursor: "page3" } }, { status: 200, body: { data: [] } });
    const tool = createListExecutionsTool(() => client);

    const res = (await tool.execute("call-1", { cursor: "abc" })) as {
      details: { nextCursor: string | null };
    };

    const exec = fake.calls.find((c) => c.url.includes("/api/v1/executions"));
    expect(exec?.url).toBe(`${BASE}/api/v1/executions?limit=50&cursor=abc`);
    expect(res.details.nextCursor).toBe("page3");
  });

  it("n8n_list_executions keeps the request URL unchanged without a cursor", async () => {
    fake.queue({ status: 200, body: { data: [] } }, { status: 200, body: { data: [] } });
    const tool = createListExecutionsTool(() => client);

    await tool.execute("call-1", {});

    const exec = fake.calls.find((c) => c.url.includes("/api/v1/executions"));
    expect(exec?.url).toBe(`${BASE}/api/v1/executions?limit=50`);
  });

  it("n8n_list_workflows sends the cursor as a query parameter", async () => {
    fake.queue({ status: 200, body: { data: [], nextCursor: "next" } });
    const tool = createListWorkflowsTool(() => client);

    const res = (await tool.execute("call-1", { cursor: "abc" })) as {
      details: { nextCursor: string | null };
    };

    expect(fake.calls[0].url).toBe(`${BASE}/api/v1/workflows?limit=100&cursor=abc`);
    expect(res.details.nextCursor).toBe("next");
  });

  it("n8n_list_workflows keeps the request URL unchanged without a cursor", async () => {
    fake.queue({ status: 200, body: { data: [] } });
    const tool = createListWorkflowsTool(() => client);

    await tool.execute("call-1", {});

    expect(fake.calls[0].url).toBe(`${BASE}/api/v1/workflows?limit=100`);
  });
});
