import { randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer, type HttpServerHandle } from "../src/http.ts";


import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { N8nWorkflow } from "../src/client.ts";

const TOKEN = randomUUID();
const env = {
  N8N_BASE_URL: "https://n8n.example.com",
  N8N_API_KEY: "test-upstream-secret",
  N8N_API_KEY_ENV: undefined,
  N8N_MCP_HTTP_TOKEN: TOKEN,
  N8N_MCP_HTTP_PORT: "0",
  N8N_MCP_HTTP_HOST: undefined,
  N8N_ENABLE_EDIT: undefined,
  N8N_ENABLE_CREDENTIALS_WRITE: undefined,
  N8N_BACKUP_DIR: undefined,
};
let http: HttpServerHandle | undefined;
const cleanup: (() => Promise<void>)[] = [];

const connections: { client: Client; transport: StreamableHTTPClientTransport }[] = [];
afterEach(async () => {
  for (const { client, transport } of connections.splice(0)) {
    await transport.terminateSession().catch(() => undefined);
    await client.close();
  }
  await http?.close();

  http = undefined;
  for (const close of cleanup.splice(0)) await close();

  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function configure(extra = {}) {
  for (const [name, value] of Object.entries({ ...env, ...extra })) vi.stubEnv(name, value);
}
async function start(extra = {}) {
  configure(extra);
  http = await createHttpServer();
  return `http://localhost:${http.port}`;
}
async function connect(url: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "http-test", version: "1" });
  connections.push({ client, transport });
  await client.connect(transport);
  return { client, transport };
}

describe("authenticated Streamable HTTP", () => {
  it.each([undefined, "Bearer wrong-token"])("rejects invalid authentication: %s", async (authorization) => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, { method: "POST", headers: authorization ? { authorization } : {} });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.text()).toBe("Unauthorized");
  });

  it("exposes only liveness without authentication", async () => {
    const response = await fetch(`${await start()}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("lists tools using the SDK client and terminates its session", async () => {
    const url = await start();
    const { client, transport } = await connect(url);
    const result = await client.listTools();
    expect(result.tools.length).toBeGreaterThan(0);
    expect(result.tools.some((t) => t.name === "n8n_list_workflows")).toBe(true);
    const id = transport.sessionId;
    expect(id).toBeTruthy();
    await transport.terminateSession();
    const stale = await fetch(`${url}/mcp`, {
      headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": id!, accept: "text/event-stream" },
    });
    expect(stale.status).toBe(404);
  });

  it.each([
    { origin: "https://evil.example.com" },
    { origin: "null" },
    { origin: "http://localhost.evil.example.com" },
    { host: "evil.example.com" },
    { host: "localhost@evil.example.com" },
  ])("rejects rebinding headers %j", async (headers) => {
    const url = await start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${url}/mcp`, { method: "POST", headers: { ...headers, authorization: `Bearer ${TOKEN}` } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("accepts a loopback Origin", async () => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, { method: "POST", headers: { origin: url } });
    expect(response.status).toBe(401);
  });

  it.each([undefined, "", "   ", env.N8N_API_KEY,
  ])("refuses missing, blank, or reused credentials", async (token) => {
    configure({ N8N_MCP_HTTP_TOKEN: token });
    await expect(createHttpServer()).rejects.toThrow(/N8N_MCP_HTTP_TOKEN/);
  });

  it.each(["-1", "65536", "abc", "3000suffix", "1.5"])("refuses invalid port %s", async (port) => {
    configure({ N8N_MCP_HTTP_PORT: port });
    await expect(createHttpServer()).rejects.toThrow(/N8N_MCP_HTTP_PORT/);
  });

  it("limits request bytes before JSON parsing", async () => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, {
      method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "x".repeat(1_048_577),
    });
    expect(response.status).toBe(413);
  });

  it("limits chunked bodies without a Content-Length", async () => {
    const url = await start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${url}/mcp`, {
        method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.write("x".repeat(600_000));
      req.end("x".repeat(600_000));
    });
    expect(status).toBe(413);
  });

  it("expires idle sessions even with an SSE channel open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const url = await start();
    const { transport } = await connect(url);
    const id = transport.sessionId!;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    const response = await fetch(`${url}/mcp`, {
      headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": id, accept: "text/event-stream" },
    });
    expect(response.status).toBe(404);
  });

  it("freezes capabilities at startup for every independent session", async () => {
    const url = await start({ N8N_ENABLE_EDIT: "true", N8N_ENABLE_CREDENTIALS_WRITE: "false" });
    const a = await connect(url);
    vi.stubEnv("N8N_ENABLE_EDIT", "false");
    vi.stubEnv("N8N_ENABLE_CREDENTIALS_WRITE", "true");
    const b = await connect(url);
    expect(a.transport.sessionId).not.toBe(b.transport.sessionId);
    const [first, second] = await Promise.all([a.client.listTools(), b.client.listTools()]);
    expect(first.tools.map(t => t.name)).toEqual(second.tools.map(t => t.name));
    expect(first.tools.some(t => t.name === "n8n_save_workflow")).toBe(true);
    expect(first.tools.some(t => t.name === "n8n_create_credential")).toBe(false);
    for (const connection of [a, b, a]) {
      const result = await connection.client.callTool({ name: "n8n_pin_node_data", arguments: {
        id: "test", nodeName: "Node", data: [{ value: 1 }], confirm: false,
      } });
      expect(JSON.parse((result.content as { text: string }[])[0].text)).toMatchObject({ ok: false });
    }
    await a.transport.terminateSession();
    expect((await b.client.listTools()).tools).toHaveLength(second.tools.length);
  });

  it("serializes cross-session pin updates and keeps same-timestamp backups distinct", async () => {
    let workflow: N8nWorkflow = {
      id: "test", name: "test", active: false, createdAt: "now", updatedAt: "now",
      nodes: [{ name: "A" }, { name: "B" }], connections: {}, settings: {}, pinData: {},
    };
    let requests = 0;
    const upstream = createServer((req, res) => {
      requests++;
      void (async () => {
        if (req.method === "GET") {
          // Snapshot before yielding exposes overlapping read/modify/write operations.
          const snapshot = JSON.stringify(workflow);
          await new Promise(resolve => setTimeout(resolve, 20));
          res.writeHead(200, { "content-type": "application/json" }).end(snapshot);
        } else if (req.method === "PUT") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          workflow = { ...workflow, ...JSON.parse(Buffer.concat(chunks).toString()) };
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(workflow));
        } else {
          res.writeHead(500).end();
        }
      })().catch(() => res.writeHead(500).end());
    });
    await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => new Promise<void>((resolve, reject) => {
      upstream.close(error => error ? reject(error) : resolve());
      upstream.closeAllConnections();
    }));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("No test upstream");
    const backupDir = await fs.mkdtemp(path.join(tmpdir(), "n8n-http-test-"));
    cleanup.push(() => fs.rm(backupDir, { recursive: true, force: true }));
    const url = await start({ N8N_BASE_URL: `http://localhost:${address.port}`,
      N8N_ENABLE_EDIT: "true", N8N_BACKUP_DIR: backupDir });
    const [a, b] = await Promise.all([connect(url), connect(url)]);
    const pin = (client: Client, nodeName: string, confirm = true) => client.callTool({
      name: "n8n_pin_node_data", arguments: { id: "test", nodeName, data: [{ nodeName }], confirm },
    });
    const results = await Promise.all([pin(a.client, "A"), pin(b.client, "B")]);
    for (const result of results) {
      expect(JSON.parse((result.content as { text: string }[])[0].text)).toMatchObject({ ok: true });
    }
    expect(Object.keys(workflow.pinData!).sort()).toEqual(["A", "B"]);
    const beforeUnconfirmed = requests;
    const unconfirmed = await pin(b.client, "A", false);
    expect(JSON.parse((unconfirmed.content as { text: string }[])[0].text)).toMatchObject({ ok: false });
    expect(requests).toBe(beforeUnconfirmed);
    expect(workflow.pinData!.A).toEqual([{ json: { nodeName: "A" } }]);
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2026-01-01T00:00:00.000Z");
    const save = (client: Client) => client.callTool({ name: "n8n_save_workflow", arguments: {
      id: "test", definition: { nodes: [], connections: {} }, skipValidation: true, confirm: true,
    } });
    const backups = await Promise.all([save(a.client), save(b.client), save(a.client)]);
    const names = backups.map(result => JSON.parse((result.content as { text: string }[])[0].text).backupPath);
    expect(new Set(names).size).toBe(3);
    expect(await fs.readdir(backupDir)).toHaveLength(3);
    for (const name of names) {
      expect(JSON.parse(await fs.readFile(name, "utf8")).id).toBe("test");
      expect((await fs.stat(name)).mode & 0o777).toBe(0o600);
    }
  });

  it("closes active sessions and the listener idempotently", async () => {
    const url = await start();
    await connect(url);
    await Promise.all([http!.close(), http!.close()]);
    await expect(fetch(`${url}/healthz`)).rejects.toThrow();
  });
});
