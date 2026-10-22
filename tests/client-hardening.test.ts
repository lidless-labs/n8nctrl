import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { N8nClient } from "../src/client.ts";
import { makeFakeFetch, type FakeFetch } from "./helpers-fetch.ts";

const BASE = "https://n8n.example.com";
const API_KEY = "super-secret-api-key-abc123";

describe("N8nClient base URL validation", () => {
  it.each([
    ["ftp://n8n.example.com", /only http and https/],
    ["file:///etc/passwd", /only http and https/],
    ["not a url", /expected an http\(s\) URL/],
    ["https://user:pass@n8n.example.com", /credentials must not be embedded/],
    ["https://user@n8n.example.com", /credentials must not be embedded/],
  ])("rejects %s", (baseUrl, message) => {
    expect(() => new N8nClient({ baseUrl, apiKey: API_KEY })).toThrow(message);
  });

  it("accepts http and https and strips trailing slashes", async () => {
    const fake = makeFakeFetch();
    try {
      fake.queue({ status: 200, body: { data: [] } });
      const client = new N8nClient({ baseUrl: "http://n8n.example.com:5678//", apiKey: API_KEY });
      await client.listTags();
      expect(fake.calls[0].url).toBe("http://n8n.example.com:5678/api/v1/tags");
    } finally {
      fake.restore();
    }
  });
});

describe("N8nClient redirect handling", () => {
  let fake: FakeFetch;

  beforeEach(() => {
    fake = makeFakeFetch();
  });

  afterEach(() => {
    fake.restore();
  });

  it("asks fetch to reject redirects on API calls", async () => {
    fake.queue({ status: 200, body: { id: "1", name: "c", type: "t" } });
    const client = new N8nClient({ baseUrl: BASE, apiKey: API_KEY });
    await client.createCredential({ name: "c", type: "t", data: { token: "x" } });
    expect(fake.calls[0].redirect).toBe("error");
  });

  it("asks fetch to reject redirects when a caller signal is present", async () => {
    fake.queue({ status: 200, body: {} });
    const client = new N8nClient({ baseUrl: BASE, apiKey: API_KEY });
    await client.deleteExecution("1", { signal: new AbortController().signal });
    expect(fake.calls[0].redirect).toBe("error");
  });

  it("asks fetch to reject redirects on webhook calls", async () => {
    fake.queue({ status: 200, body: { ok: true } });
    const client = new N8nClient({ baseUrl: BASE, apiKey: API_KEY });
    await client.postWebhook("/webhook/demo", { a: 1 });
    expect(fake.calls[0].redirect).toBe("error");
  });
});

describe("N8nClient cross-origin redirects (real sockets)", () => {
  let origin: Server;
  let other: Server;
  let otherHits: Array<{ body: string; apiKey: string | undefined }>;
  let originUrl: string;
  let otherUrl: string;

  beforeEach(async () => {
    otherHits = [];
    other = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        otherHits.push({
          body: Buffer.concat(chunks).toString("utf8"),
          apiKey: req.headers["x-n8n-api-key"] as string | undefined,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
    otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;

    origin = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(307, { location: `${otherUrl}/collect` });
        res.end();
      });
    });
    await new Promise<void>((r) => origin.listen(0, "127.0.0.1", r));
    originUrl = `http://127.0.0.1:${(origin.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((r) => origin.close(r));
    await new Promise((r) => other.close(r));
  });

  it("does not replay an API POST body to another origin", async () => {
    const client = new N8nClient({ baseUrl: originUrl, apiKey: API_KEY });
    await expect(
      client.createCredential({ name: "c", type: "t", data: { token: "plaintext-secret" } }),
    ).rejects.toThrow();
    expect(otherHits).toEqual([]);
  });

  it("does not follow a redirect on a webhook call", async () => {
    const client = new N8nClient({ baseUrl: originUrl, apiKey: API_KEY });
    await expect(client.postWebhook("/webhook/demo", { a: 1 })).rejects.toThrow(/redirect refused/);
    expect(otherHits).toEqual([]);
  });
});

describe("N8nClient response size budget", () => {
  let fake: FakeFetch;

  beforeEach(() => {
    fake = makeFakeFetch();
  });

  afterEach(() => {
    fake.restore();
  });

  it("rejects an API response whose Content-Length is over the budget", async () => {
    fake.queue({ status: 200, text: "{}", headers: { "content-length": "5000" } });
    const client = new N8nClient({ baseUrl: BASE, apiKey: API_KEY, maxResponseBytes: 1000 });
    await expect(client.listTags()).rejects.toThrow(/exceeded the 1000 byte limit/);
  });

  it("aborts a streamed API response that grows past the budget", async () => {
    fake.queue({ status: 200, text: JSON.stringify({ data: "x".repeat(4000) }) });
    const client = new N8nClient({ baseUrl: BASE, apiKey: API_KEY, maxResponseBytes: 1000 });
    await expect(client.listTags()).rejects.toThrow(/exceeded the 1000 byte limit/);
  });

  it("accepts a response inside the budget", async () => {
    fake.queue({ status: 200, body: { data: [{ id: "1", name: "a" }] } });
    const client = new N8nClient({ baseUrl: BASE, apiKey: API_KEY, maxResponseBytes: 1000 });
    const res = await client.listTags();
    expect(res.data).toHaveLength(1);
  });

  it("bounds webhook responses too", async () => {
    fake.queue({ status: 200, text: "y".repeat(4000) });
    const client = new N8nClient({ baseUrl: BASE, apiKey: API_KEY, maxResponseBytes: 1000 });
    await expect(client.postWebhook("/webhook/demo", {})).rejects.toThrow(/exceeded the 1000 byte limit/);
  });
});
