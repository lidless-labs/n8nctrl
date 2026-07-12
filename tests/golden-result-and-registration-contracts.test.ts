import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildServer } from "../mcp-server.ts";
import n8nPlugin from "../index.ts";
import type { N8nPluginConfig } from "../src/config.ts";
import { createExecutionStatsTool } from "../src/tools/execution-stats.ts";
import { createGetWorkflowTool } from "../src/tools/get-workflow.ts";
import { createListCredentialsTool } from "../src/tools/list-credentials.ts";
import { createListTagsTool } from "../src/tools/list-tags.ts";
import { createListWorkflowsTool } from "../src/tools/list-workflows.ts";
import { makeFakeClient } from "./helpers.ts";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

async function execute(
  tool: { execute: (toolCallId: string, rawParams: Record<string, unknown>) => Promise<unknown> },
  params: Record<string, unknown>,
): Promise<ToolResult> {
  return (await tool.execute("golden-call", params)) as ToolResult;
}

function baseConfig(overrides: Partial<N8nPluginConfig> = {}): N8nPluginConfig {
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

function registeredToolNames(server: McpServer): string[] {
  const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
  return Object.keys(tools).sort();
}

function pluginRegisteredToolNames(config: N8nPluginConfig): string[] {
  const names: string[] = [];
  n8nPlugin.register?.({
    registrationMode: "full",
    pluginConfig: {
      baseUrl: config.baseUrl,
      apiKey: config.apiKeyInline,
      apiKeyEnv: config.apiKeyEnv,
      enableEdit: config.enableEdit,
      enableCredentialsWrite: config.enableCredentialsWrite,
      maxExecutionLogBytes: config.maxExecutionLogBytes,
      requestTimeoutMs: config.requestTimeoutMs,
      backupDir: config.backupDir,
    },
    registerTool: (tool: { name: string }) => {
      names.push(tool.name);
    },
  } as never);
  return names.sort();
}

function expectDetailsField(result: ToolResult, expected: Record<string, unknown>): void {
  expect(result).toHaveProperty("details");
  expect(result.details).toMatchObject(expected);
  expect(result.content).toEqual([
    { type: "text", text: JSON.stringify(result.details, null, 2) },
  ]);
}

describe("golden result details contracts", () => {
  it("keeps details on representative tool results that currently expose details", async () => {
    const client = makeFakeClient({
      listWorkflows: vi.fn().mockResolvedValue({
        data: [
          {
            id: "wf-1",
            name: "Nightly sync",
            active: true,
            tags: [{ id: "tag-1", name: "prod" }],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        ],
        nextCursor: "wf-next",
      }),
      getWorkflow: vi.fn().mockResolvedValue({
        id: "wf-1",
        name: "Nightly sync",
        active: true,
        tags: [{ id: "tag-1", name: "prod" }],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        nodes: [{ name: "Webhook", type: "n8n-nodes-base.webhook" }],
        connections: {},
        settings: {},
      }),
      listTags: vi.fn().mockResolvedValue({
        data: [{ id: "tag-1", name: "prod" }],
        nextCursor: "tag-next",
      }),
      listCredentials: vi.fn().mockResolvedValue({
        data: [{ id: "cred-1", name: "GitHub", type: "githubApi" }],
        nextCursor: "cred-next",
      }),
      listExecutions: vi.fn().mockResolvedValue({
        data: [
          {
            id: "ex-1",
            workflowId: "wf-1",
            status: "success",
            finished: true,
            mode: "trigger",
            startedAt: new Date(Date.now() - 60_000).toISOString(),
            stoppedAt: new Date().toISOString(),
          },
        ],
      }),
    });

    const listWorkflows = await execute(createListWorkflowsTool(() => client), {});
    expectDetailsField(listWorkflows, {
      count: 1,
      nextCursor: "wf-next",
      workflows: [{ id: "wf-1", name: "Nightly sync" }],
    });

    const getWorkflow = await execute(createGetWorkflowTool(() => client), { id: "wf-1" });
    expectDetailsField(getWorkflow, {
      id: "wf-1",
      name: "Nightly sync",
      nodeCount: 1,
    });

    const listTags = await execute(createListTagsTool(() => client), {});
    expectDetailsField(listTags, {
      count: 1,
      nextCursor: "tag-next",
      data: [{ id: "tag-1", name: "prod" }],
    });

    const listCredentials = await execute(createListCredentialsTool(() => client), {});
    expectDetailsField(listCredentials, {
      count: 1,
      nextCursor: "cred-next",
      data: [{ id: "cred-1", name: "GitHub", type: "githubApi" }],
    });

    const executionStats = await execute(createExecutionStatsTool(() => client), {
      sinceHours: 24,
      maxExecutions: 50,
      pageSize: 50,
    });
    expectDetailsField(executionStats, {
      scannedExecutions: 1,
      workflowCount: 1,
      totals: { total: 1, success: 1 },
    });
  });
});

describe("golden credential write registration gates", () => {
  it("hides credential write tools when edit is disabled", () => {
    const names = registeredToolNames(buildServer(baseConfig({ enableEdit: false })));

    expect(names).not.toContain("n8n_create_credential");
    expect(names).not.toContain("n8n_delete_credential");
    expect(names).not.toContain("n8n_save_workflow");
  });

  it("hides all write tools when edit is disabled even if the credential write gate is enabled", () => {
    const names = registeredToolNames(
      buildServer(
        baseConfig({ enableEdit: false, enableCredentialsWrite: true }),
      ),
    );

    expect(names).not.toContain("n8n_save_workflow");
    expect(names).not.toContain("n8n_delete_workflow");
    expect(names).not.toContain("n8n_create_credential");
    expect(names).not.toContain("n8n_delete_credential");
  });

  it("still hides credential write tools when edit is enabled without the credential write gate", () => {
    const names = registeredToolNames(
      buildServer(baseConfig({ enableEdit: true, enableCredentialsWrite: false })),
    );

    expect(names).toContain("n8n_save_workflow");
    expect(names).toContain("n8n_delete_workflow");
    expect(names).not.toContain("n8n_create_credential");
    expect(names).not.toContain("n8n_delete_credential");
  });

  it("exposes credential write tools only when both edit and credential-write gates are enabled", () => {
    const names = registeredToolNames(
      buildServer(baseConfig({ enableEdit: true, enableCredentialsWrite: true })),
    );

    expect(names).toContain("n8n_create_credential");
    expect(names).toContain("n8n_delete_credential");
  });

  it("uses the same credential write gates on the OpenClaw plugin surface", () => {
    const disabled = pluginRegisteredToolNames(
      baseConfig({ enableEdit: false, enableCredentialsWrite: true }),
    );
    expect(disabled).not.toContain("n8n_save_workflow");
    expect(disabled).not.toContain("n8n_delete_workflow");
    expect(disabled).not.toContain("n8n_create_credential");
    expect(disabled).not.toContain("n8n_delete_credential");

    const editOnly = pluginRegisteredToolNames(
      baseConfig({ enableEdit: true, enableCredentialsWrite: false }),
    );
    expect(editOnly).toContain("n8n_save_workflow");
    expect(editOnly).toContain("n8n_delete_workflow");
    expect(editOnly).not.toContain("n8n_create_credential");
    expect(editOnly).not.toContain("n8n_delete_credential");

    const full = pluginRegisteredToolNames(
      baseConfig({ enableEdit: true, enableCredentialsWrite: true }),
    );
    expect(full).toContain("n8n_create_credential");
    expect(full).toContain("n8n_delete_credential");
  });
});
