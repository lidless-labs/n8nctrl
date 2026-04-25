import { describe, it, expect, vi } from "vitest";
import { createAuditBrowserBridgeUsageTool } from "../src/tools/audit-browser-bridge-usage.ts";
import { makeFakeClient } from "./helpers.ts";
import type { N8nClient, N8nWorkflow, N8nWorkflowSummary } from "../src/client.ts";

function summary(overrides: Partial<N8nWorkflowSummary> = {}): N8nWorkflowSummary {
  return {
    id: "wf-1",
    name: "browser-bridge ops",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function workflow(overrides: Partial<N8nWorkflow> = {}): N8nWorkflow {
  return {
    id: "wf-1",
    name: "browser-bridge ops",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    nodes: [],
    connections: {},
    ...overrides,
  };
}

async function run(
  tool: ReturnType<typeof createAuditBrowserBridgeUsageTool>,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = (await tool.execute("call-1", params)) as {
    details: Record<string, unknown>;
  };
  return res.details;
}

function buildTool(client: N8nClient) {
  return createAuditBrowserBridgeUsageTool(() => client);
}

describe("n8n_audit_browser_bridge_usage", () => {
  it("detects an Execute Command node calling browser-bridge via heredoc", async () => {
    const wf = workflow({
      nodes: [
        {
          id: "node-1",
          name: "BB: scan comments",
          type: "n8n-nodes-base.executeCommand",
          parameters: {
            command:
              "cd /opt/browser-bridge\nnode bin/browser-bridge.js coderlegion scan-comments <<'JSON'\n{\"limit\":5}\nJSON\n",
          },
        },
      ],
    });
    const client = makeFakeClient({
      listWorkflows: vi.fn().mockResolvedValue({ data: [summary()] }),
      getWorkflow: vi.fn().mockResolvedValue(wf),
    });
    const tool = buildTool(client);

    const details = await run(tool, {});

    expect(details.scannedWorkflows).toBe(1);
    expect(details.findingCount).toBe(1);
    const findings = details.findings as Array<Record<string, unknown>>;
    expect(findings[0]).toMatchObject({
      workflowId: "wf-1",
      nodeName: "BB: scan comments",
      nodeType: "n8n-nodes-base.executeCommand",
      source: "command",
      platform: "coderlegion",
      action: "scan-comments",
    });
  });

  it("detects a Code node spawnSync call (array arg form)", async () => {
    const wf = workflow({
      nodes: [
        {
          id: "code-1",
          name: "BB call",
          type: "n8n-nodes-base.code",
          parameters: {
            language: "javaScript",
            jsCode:
              "const { spawnSync } = require('node:child_process');\n" +
              "const proc = spawnSync('node', ['bin/browser-bridge.js', 'substack', 'draft-post'], { input: '{}' });\n" +
              "return [{ json: JSON.parse(proc.stdout) }];\n",
          },
        },
      ],
    });
    const client = makeFakeClient({
      listWorkflows: vi.fn().mockResolvedValue({ data: [summary()] }),
      getWorkflow: vi.fn().mockResolvedValue(wf),
    });
    const tool = buildTool(client);

    const details = await run(tool, {});

    const findings = details.findings as Array<Record<string, unknown>>;
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      source: "jsCode",
      platform: "substack",
      action: "draft-post",
      nodeType: "n8n-nodes-base.code",
    });
  });

  it("de-dupes identical (platform, action) pairs within one node", async () => {
    const wf = workflow({
      nodes: [
        {
          id: "code-2",
          name: "double call",
          type: "n8n-nodes-base.code",
          parameters: {
            jsCode:
              "spawnSync('node', ['browser-bridge.js', 'linktree', 'status']);\n" +
              "spawnSync('node', ['browser-bridge.js', 'linktree', 'status']);\n",
          },
        },
      ],
    });
    const client = makeFakeClient({
      listWorkflows: vi.fn().mockResolvedValue({ data: [summary()] }),
      getWorkflow: vi.fn().mockResolvedValue(wf),
    });
    const tool = buildTool(client);

    const details = await run(tool, {});
    const findings = details.findings as Array<Record<string, unknown>>;
    expect(findings).toHaveLength(1);
    expect(findings[0].action).toBe("status");
  });

  it("emits separate findings for distinct actions in the same node", async () => {
    const wf = workflow({
      nodes: [
        {
          id: "code-3",
          name: "two-step",
          type: "n8n-nodes-base.code",
          parameters: {
            jsCode:
              "spawnSync('node', ['bin/browser-bridge.js', 'coderlegion', 'scan-comments']);\n" +
              "spawnSync('node', ['bin/browser-bridge.js', 'coderlegion', 'reply']);\n",
          },
        },
      ],
    });
    const client = makeFakeClient({
      listWorkflows: vi.fn().mockResolvedValue({ data: [summary()] }),
      getWorkflow: vi.fn().mockResolvedValue(wf),
    });
    const tool = buildTool(client);

    const details = await run(tool, {});
    const findings = details.findings as Array<Record<string, unknown>>;
    expect(findings.map((f) => f.action).sort()).toEqual([
      "reply",
      "scan-comments",
    ]);
  });

  it("ignores nodes whose type is not in the scanned set", async () => {
    const wf = workflow({
      nodes: [
        {
          id: "set-1",
          name: "Set",
          type: "n8n-nodes-base.set",
          // The Set node has no command/jsCode field, but a string param that
          // mentions browser-bridge MUST NOT trip the audit (avoids false
          // positives from documentation-style param values).
          parameters: { value: "node bin/browser-bridge.js coderlegion status" },
        },
      ],
    });
    const client = makeFakeClient({
      listWorkflows: vi.fn().mockResolvedValue({ data: [summary()] }),
      getWorkflow: vi.fn().mockResolvedValue(wf),
    });
    const tool = buildTool(client);

    const details = await run(tool, {});
    expect(details.findingCount).toBe(0);
  });

  it("filters by platform and action when supplied", async () => {
    const wf = workflow({
      nodes: [
        {
          id: "code-4",
          name: "mixed",
          type: "n8n-nodes-base.code",
          parameters: {
            jsCode:
              "spawnSync('node', ['bin/browser-bridge.js', 'coderlegion', 'scan-comments']);\n" +
              "spawnSync('node', ['bin/browser-bridge.js', 'substack', 'draft-post']);\n",
          },
        },
      ],
    });
    const client = makeFakeClient({
      listWorkflows: vi.fn().mockResolvedValue({ data: [summary()] }),
      getWorkflow: vi.fn().mockResolvedValue(wf),
    });
    const tool = buildTool(client);

    const onlyCL = await run(tool, { platform: "coderlegion" });
    expect((onlyCL.findings as unknown[]).length).toBe(1);
    expect((onlyCL.findings as Array<{ platform: string }>)[0].platform).toBe(
      "coderlegion",
    );

    const onlyDraft = await run(tool, { action: "draft-post" });
    expect((onlyDraft.findings as Array<{ action: string }>)[0].action).toBe(
      "draft-post",
    );
  });

  it("aggregates a per-platform action summary", async () => {
    const wf = workflow({
      nodes: [
        {
          id: "n1",
          name: "a",
          type: "n8n-nodes-base.executeCommand",
          parameters: {
            command: "node bin/browser-bridge.js coderlegion scan-comments",
          },
        },
        {
          id: "n2",
          name: "b",
          type: "n8n-nodes-base.executeCommand",
          parameters: {
            command: "node bin/browser-bridge.js coderlegion reply",
          },
        },
        {
          id: "n3",
          name: "c",
          type: "n8n-nodes-base.executeCommand",
          parameters: {
            command: "node bin/browser-bridge.js substack draft-post",
          },
        },
      ],
    });
    const client = makeFakeClient({
      listWorkflows: vi.fn().mockResolvedValue({ data: [summary()] }),
      getWorkflow: vi.fn().mockResolvedValue(wf),
    });
    const tool = buildTool(client);

    const details = await run(tool, {});
    const summary_ = details.summary as Array<{
      platform: string;
      actions: Array<{ action: string; count: number }>;
    }>;
    expect(summary_.map((s) => s.platform)).toEqual(["coderlegion", "substack"]);
    const cl = summary_.find((s) => s.platform === "coderlegion")!;
    expect(cl.actions.map((a) => a.action).sort()).toEqual([
      "reply",
      "scan-comments",
    ]);
  });

  it("records fetchErrors instead of failing the whole audit when one workflow can't be fetched", async () => {
    const summaries = [
      summary({ id: "ok-1", name: "ok" }),
      summary({ id: "boom-1", name: "boom" }),
    ];
    const okWf = workflow({
      id: "ok-1",
      name: "ok",
      nodes: [
        {
          id: "n1",
          name: "exec",
          type: "n8n-nodes-base.executeCommand",
          parameters: { command: "node bin/browser-bridge.js coderlegion status" },
        },
      ],
    });
    const client = makeFakeClient({
      listWorkflows: vi.fn().mockResolvedValue({ data: summaries }),
      getWorkflow: vi.fn().mockImplementation(async (id: string) => {
        if (id === "boom-1") throw new Error("n8n 500: kapow");
        return okWf;
      }),
    });
    const tool = buildTool(client);

    const details = await run(tool, {});
    expect(details.scannedWorkflows).toBe(1);
    const fetchErrors = details.fetchErrors as Array<{ workflowId: string }>;
    expect(fetchErrors).toHaveLength(1);
    expect(fetchErrors[0].workflowId).toBe("boom-1");
    expect(details.findingCount).toBe(1);
  });

  it("paginates via cursor and stops at maxWorkflows", async () => {
    // Page 1: 100 workflows, cursor present. Page 2: only need 50 more.
    const page1Summaries = Array.from({ length: 100 }, (_, i) =>
      summary({ id: `wf-${i + 1}` }),
    );
    const page2Summaries = Array.from({ length: 100 }, (_, i) =>
      summary({ id: `wf-${i + 101}` }),
    );
    const listWorkflows = vi
      .fn()
      .mockResolvedValueOnce({ data: page1Summaries, nextCursor: "cursor-A" })
      .mockResolvedValueOnce({ data: page2Summaries, nextCursor: "cursor-B" });
    // getWorkflow returns an empty workflow (no nodes) — we only care about
    // pagination shape here, not findings.
    const getWorkflow = vi.fn().mockImplementation(async (id: string) =>
      workflow({ id, nodes: [] }),
    );
    const client = makeFakeClient({ listWorkflows, getWorkflow });
    const tool = buildTool(client);

    const details = await run(tool, { maxWorkflows: 150, concurrency: 5 });
    expect(details.scannedWorkflows).toBe(150);
    // Two listWorkflows calls — page 1 limit=100, page 2 limit=50.
    expect(listWorkflows).toHaveBeenCalledTimes(2);
    const secondCallArgs = listWorkflows.mock.calls[1][0];
    expect(secondCallArgs.limit).toBe(50);
    expect(secondCallArgs.cursor).toBe("cursor-A");
    // Cursor still set after we stopped — should be reported as truncated.
    expect(details.truncated).toBe(true);
  });

  it("excludes archived workflows by default but includes them when asked", async () => {
    const archived = summary({ id: "wf-arc", name: "archived" });
    (archived as N8nWorkflowSummary).isArchived = true;
    const live = summary({ id: "wf-live", name: "live" });

    const wfArc = workflow({
      id: "wf-arc",
      name: "archived",
      isArchived: true,
      nodes: [
        {
          id: "n",
          name: "old",
          type: "n8n-nodes-base.executeCommand",
          parameters: { command: "node bin/browser-bridge.js linktree status" },
        },
      ],
    });
    const wfLive = workflow({
      id: "wf-live",
      name: "live",
      nodes: [
        {
          id: "n",
          name: "new",
          type: "n8n-nodes-base.executeCommand",
          parameters: {
            command: "node bin/browser-bridge.js coderlegion status",
          },
        },
      ],
    });

    const client = makeFakeClient({
      listWorkflows: vi.fn().mockResolvedValue({ data: [archived, live] }),
      getWorkflow: vi.fn().mockImplementation(async (id: string) =>
        id === "wf-arc" ? wfArc : wfLive,
      ),
    });
    const tool = buildTool(client);

    const defaultRun = await run(tool, {});
    expect((defaultRun.findings as Array<{ platform: string }>).map((f) => f.platform)).toEqual([
      "coderlegion",
    ]);

    const withArchived = await run(tool, { includeArchived: true });
    expect(
      (withArchived.findings as Array<{ platform: string }>).map((f) => f.platform).sort(),
    ).toEqual(["coderlegion", "linktree"]);
  });
});
