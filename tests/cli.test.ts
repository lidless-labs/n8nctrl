import { describe, expect, it, vi } from "vitest";
import { UsageError, VERSION, parseArgs, run, type CliDeps } from "../src/cli.ts";
import type { N8nClient } from "../src/client.ts";

function capture(
  client: Partial<N8nClient>,
  serve = vi.fn().mockResolvedValue(undefined),
) {
  const out: string[] = [];
  const err: string[] = [];
  const base = { redact: (t: string) => t, ...client } as unknown as N8nClient;
  const deps: CliDeps = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    makeClient: () => base,
    getBaseUrl: () => "http://localhost:5678",
    serve,
  };
  return { out, err, deps, serve };
}

describe("parseArgs", () => {
  it("routes workflows list with filters", () => {
    expect(parseArgs(["workflows", "list", "--active", "--limit", "5", "--name", "sync"])).toEqual({
      kind: "workflows-list",
      json: false,
      active: true,
      tags: undefined,
      name: "sync",
      limit: 5,
    });
  });

  it("parses workflows get with --full and --json", () => {
    expect(parseArgs(["workflows", "get", "42", "--full", "--json"])).toEqual({
      kind: "workflows-get",
      json: true,
      id: "42",
      full: true,
    });
  });

  it("parses workflows diff with id + snapshot path", () => {
    expect(parseArgs(["workflows", "diff", "7", "/tmp/snap.json"])).toEqual({
      kind: "workflows-diff",
      json: false,
      id: "7",
      snapshotPath: "/tmp/snap.json",
    });
  });

  it("parses executions list with --status and --since", () => {
    expect(parseArgs(["executions", "list", "--status", "error", "--since", "12"])).toEqual({
      kind: "executions-list",
      json: false,
      status: "error",
      since: 12,
      workflowId: undefined,
      limit: undefined,
    });
  });

  it("parses executions search query after flags", () => {
    expect(parseArgs(["executions", "search", "ECONNREFUSED", "--scope", "all"])).toEqual({
      kind: "executions-search",
      json: false,
      query: "ECONNREFUSED",
      status: undefined,
      scope: "all",
      limit: undefined,
    });
  });

  it("parses nodes find with --contains", () => {
    expect(parseArgs(["nodes", "find", "n8n-nodes-base.slack", "--contains"])).toEqual({
      kind: "nodes-find",
      json: false,
      nodeType: "n8n-nodes-base.slack",
      match: "contains",
    });
  });

  it("routes simple commands and global flags", () => {
    expect(parseArgs(["tags", "list"])).toEqual({ kind: "tags-list", json: false, limit: undefined });
    expect(parseArgs(["credentials", "schema", "githubApi"])).toEqual({ kind: "credentials-schema", json: false, type: "githubApi" });
    expect(parseArgs(["audit", "run"])).toEqual({ kind: "audit-run", json: false });
    expect(parseArgs(["webhooks", "list", "--all"])).toEqual({ kind: "webhooks-list", json: false, activeOnly: false, limit: undefined });
    expect(parseArgs(["mcp"])).toEqual({ kind: "mcp" });
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseArgs([])).toEqual({ kind: "help" });
  });

  it("rejects bad input with UsageError", () => {
    expect(() => parseArgs(["bogus"])).toThrow(UsageError);
    expect(() => parseArgs(["workflows", "bogus"])).toThrow(UsageError);
    expect(() => parseArgs(["workflows", "get"])).toThrow(UsageError);
    expect(() => parseArgs(["executions", "search"])).toThrow(UsageError);
    expect(() => parseArgs(["executions", "list", "--since", "999"])).toThrow(UsageError);
    expect(() => parseArgs(["workflows", "list", "--limit", "0"])).toThrow(UsageError);
    expect(() => parseArgs(["tags", "list", "extra"])).toThrow(UsageError);
  });
});

describe("run", () => {
  it("prints human workflows-list output and exits 0", async () => {
    const client = {
      listWorkflows: vi.fn().mockResolvedValue({
        data: [{ id: "1", name: "Daily sync", active: true, tags: [{ name: "prod" }] }],
      }),
    };
    const { out, deps } = capture(client);
    const code = await run(["workflows", "list", "--active"], deps);
    expect(code).toBe(0);
    expect(client.listWorkflows).toHaveBeenCalledWith({
      active: true,
      tags: undefined,
      name: undefined,
      limit: undefined,
    });
    const text = out.join("\n");
    expect(text).toContain("Daily sync");
    expect(text).toContain("prod");
  });

  it("emits raw JSON with --json", async () => {
    const res = { data: [{ id: "9", name: "x", active: false }] };
    const client = { listWorkflows: vi.fn().mockResolvedValue(res) };
    const { out, deps } = capture(client);
    const code = await run(["workflows", "list", "--json"], deps);
    expect(code).toBe(0);
    expect(JSON.parse(out.join("\n"))).toEqual(res);
  });

  it("calls getWorkflow directly for workflows get", async () => {
    const client = {
      getWorkflow: vi.fn().mockResolvedValue({ id: "42", name: "wf", active: true, nodes: [], connections: {} }),
    };
    const { out, deps } = capture(client);
    expect(await run(["workflows", "get", "42"], deps)).toBe(0);
    expect(client.getWorkflow).toHaveBeenCalledWith("42");
    expect(out.join("\n")).toContain("id:        42");
  });

  it("validates a workflow via the client + pure validator", async () => {
    const client = {
      getWorkflow: vi.fn().mockResolvedValue({
        id: "5",
        name: "no-trigger",
        active: false,
        nodes: [{ name: "Set", type: "n8n-nodes-base.set" }],
        connections: {},
      }),
    };
    const { out, deps } = capture(client);
    expect(await run(["workflows", "validate", "5"], deps)).toBe(0);
    expect(out.join("\n")).toContain("missing-trigger");
  });

  it("audit run prints a report and exits 0 on a healthy audit", async () => {
    const client = {
      runAudit: vi.fn().mockResolvedValue({
        "Credentials Risk Report": { risk: "credentials", sections: [{ title: "x", location: [{}, {}] }] },
      }),
    };
    const { out, deps } = capture(client);
    expect(await run(["audit", "run"], deps)).toBe(0);
    expect(out.join("\n")).toContain("audit:");
  });

  it("audit run exits 1 when the backend is unreachable", async () => {
    const client = { runAudit: vi.fn().mockRejectedValue(new Error("403 Forbidden")) };
    const { err, deps } = capture(client);
    expect(await run(["audit", "run"], deps)).toBe(1);
    expect(err.join("\n")).toContain("403");
  });

  it("returns exit 1 and prints the error on client failure", async () => {
    const client = { listWorkflows: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")) };
    const { err, deps } = capture(client);
    expect(await run(["workflows", "list"], deps)).toBe(1);
    expect(err.join("\n")).toContain("ECONNREFUSED");
  });

  it("returns exit 2 and prints help on usage error", async () => {
    const { err, deps } = capture({});
    expect(await run(["bogus"], deps)).toBe(2);
    expect(err.join("\n")).toContain("Usage:");
  });

  it("prints the version", async () => {
    const { out, deps } = capture({});
    expect(await run(["--version"], deps)).toBe(0);
    expect(out.join("\n")).toBe(VERSION);
  });

  it("delegates `mcp` to serve()", async () => {
    const { deps, serve } = capture({});
    expect(await run(["mcp"], deps)).toBe(0);
    expect(serve).toHaveBeenCalledOnce();
  });

  it("redacts the API key from runtime error messages", async () => {
    const client = {
      redact: (t: string) => t.split("SECRET").join("***"),
      listTags: vi.fn().mockRejectedValue(new Error("boom SECRET leaked")),
    };
    const { err, deps } = capture(client);
    expect(await run(["tags", "list"], deps)).toBe(1);
    const text = err.join("\n");
    expect(text).toContain("***");
    expect(text).not.toContain("SECRET");
  });
});

describe("credentials list", () => {
  it("strips any credential data field before printing", async () => {
    const { out, deps } = capture({
      listCredentials: vi.fn().mockResolvedValue({
        data: [{ id: "c1", name: "Example", type: "githubApi", data: { token: "plaintext-secret" } }],
      }),
    });
    expect(await run(["credentials", "list", "--json"], deps)).toBe(0);
    const text = out.join("\n");
    expect(text).not.toContain("plaintext-secret");
    expect(text).toContain("githubApi");
  });
});


describe("sensitive CLI inspection", () => {
  const apiKey = 'configured-key"quoted';
  const secrets = ["inline-header-secret", "inline-password-secret", "inline-credential-secret", "encoded-secret", "separate-api-secret", apiKey];
  const message = 'Authorization: Basic inline-header-secret\npassword=inline-password-secret\npassword="encoded-secret"\napiKey=separate-api-secret\n' + apiKey;
  const fixture = () => ({
    id: "42", name: message, active: true, benign: "keep-me",
    nodes: [{ name: "node", type: "n8n-nodes-base.httpRequest", parameters: {
      headers: [{ name: "Authorization", value: "inline-header-secret" }],
      password: "inline-password-secret", credentialData: { value: "inline-credential-secret" },
      encoded: JSON.stringify({ note: "token=ordinary", "X-API-Key": "separate-api-secret", password: "encoded-secret", benign: "encoded-benign" }),
      known: apiKey,
    } }],
    data: { resultData: { error: { message, credentialData: { value: "inline-credential-secret" } }, runData: { benign: "run-benign", password: "inline-password-secret" } } },
  });

  it.each([
    ["workflows", "get", "42", "--full"],
    ["workflows", "get", "42", "--json"],
    ["executions", "get", "42"],
    ["executions", "get", "42", "--json"],
    ["executions", "get", "42", "--no-run-data", "--json"],
  ])("redacts sensitive structures before human or JSON output: %j", async (...argv) => {
    const source = fixture();
    const before = JSON.stringify(source);
    const { out, deps } = capture({
      getWorkflow: vi.fn().mockResolvedValue(source), getExecution: vi.fn().mockResolvedValue(source),
      redact: (text) => text.split(apiKey).join("***REDACTED***"),
    });
    expect(await run(argv, deps)).toBe(0);
    const text = out.join("\n");
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(text).not.toContain(JSON.stringify(apiKey).slice(1, -1));
    expect(text).toContain("REDACTED");
    if (argv.includes("--json")) {
      const result = JSON.parse(text);
      expect(result.id).toBe("42");
      expect(result.benign).toBe("keep-me");
      expect(JSON.parse(result.nodes[0].parameters.encoded).benign).toBe("encoded-benign");
      expect(result.data.resultData.runData.benign).toBe("run-benign");
    }
    expect(JSON.stringify(source)).toBe(before);
  });

  it.each(["workflows", "executions"])("suppresses raw %s definition fragments in upstream and parse errors", async (group) => {
    for (const error of [new Error(message), new SyntaxError(`Unexpected token in ${message}`)]) {
      const { err, deps } = capture({ getWorkflow: vi.fn().mockRejectedValue(error), getExecution: vi.fn().mockRejectedValue(error) });
      expect(await run([group, "get", "42", "--json"], deps)).toBe(1);
      expect(err.join("\n")).toContain("details suppressed");
      for (const secret of secrets) expect(err.join("\n")).not.toContain(secret);
    }
  });

  it("preserves credential schema properties and metadata JSON shape", async () => {
    const schema = { type: "object", properties: { password: { type: "string" }, apiKey: { type: "string" } } };
    const { out, deps } = capture({ getCredentialSchema: vi.fn().mockResolvedValue(schema) });
    expect(await run(["credentials", "schema", "example", "--json"], deps)).toBe(0);
    expect(JSON.parse(out.join("\n"))).toEqual(schema);
  });
});
