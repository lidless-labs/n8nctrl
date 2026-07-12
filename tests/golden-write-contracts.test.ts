import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { N8nClient, N8nWorkflow } from "../src/client.ts";
import { createActivateTool } from "../src/tools/activate.ts";
import { createArchiveWorkflowTool } from "../src/tools/archive-workflow.ts";
import { createCreateCredentialTool } from "../src/tools/create-credential.ts";
import { createCreateTagTool } from "../src/tools/create-tag.ts";
import { createCreateWorkflowTool } from "../src/tools/create-workflow.ts";
import { createDeactivateTool } from "../src/tools/deactivate.ts";
import { createDeleteCredentialTool } from "../src/tools/delete-credential.ts";
import { createDeleteExecutionTool } from "../src/tools/delete-execution.ts";
import { createDeleteExecutionsTool } from "../src/tools/delete-executions.ts";
import { createDeleteTagTool } from "../src/tools/delete-tag.ts";
import { createDeleteWorkflowTool } from "../src/tools/delete-workflow.ts";
import { createPinNodeDataTool } from "../src/tools/pin-node-data.ts";
import { createRetryExecutionsTool } from "../src/tools/retry-executions.ts";
import { createSaveWorkflowTool } from "../src/tools/save-workflow.ts";
import { createSetWorkflowTagsTool } from "../src/tools/set-workflow-tags.ts";
import { createTriggerTool } from "../src/tools/trigger.ts";
import { createUnpinNodeDataTool } from "../src/tools/unpin-node-data.ts";
import { makeFakeClient, type FakeClient } from "./helpers.ts";

async function detailsOf(
  tool: { execute: (toolCallId: string, rawParams: Record<string, unknown>) => Promise<unknown> },
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await tool.execute("golden-call", params);
  expect(result).toHaveProperty("details");
  return (result as { details: Record<string, unknown> }).details;
}

function workflow(overrides: Partial<N8nWorkflow> = {}): N8nWorkflow {
  return {
    id: "wf-1",
    name: "Operator Contract",
    active: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    nodes: [
      {
        name: "Webhook",
        type: "n8n-nodes-base.webhook",
        parameters: {},
      },
    ],
    connections: {},
    settings: {},
    ...overrides,
  };
}

function expectNoClientApiCalls(client: N8nClient): void {
  for (const [name, maybeMock] of Object.entries(client as unknown as FakeClient)) {
    if (name === "redact" || typeof maybeMock !== "function" || !("mock" in maybeMock)) continue;
    expect(maybeMock, `${name} should not be called`).not.toHaveBeenCalled();
  }
}

describe("golden confirm-gated write refusal contracts", () => {
  it.each([
    {
      name: "trigger",
      build: (client: N8nClient) => createTriggerTool(() => client),
      params: { mode: "workflow", workflowId: "wf-1" },
      refusal: {
        ok: false,
        error: "confirm must be true to trigger a workflow",
      },
    },
    {
      name: "activate",
      build: (client: N8nClient) => createActivateTool(() => client),
      params: { id: "wf-1" },
      refusal: {
        ok: false,
        action: "activate",
        error: "confirm must be true to activate",
      },
    },
    {
      name: "deactivate",
      build: (client: N8nClient) => createDeactivateTool(() => client),
      params: { id: "wf-1" },
      refusal: {
        ok: false,
        action: "deactivate",
        error: "confirm must be true to deactivate",
      },
    },
    {
      name: "save workflow",
      build: (client: N8nClient) => createSaveWorkflowTool({ getClient: () => client, backupDir: "/tmp/no-fetch" }),
      params: { id: "wf-1", definition: { nodes: [], connections: {} } },
      refusal: {
        ok: false,
        error: "confirm must be true to save",
      },
    },
    {
      name: "delete execution",
      build: (client: N8nClient) => createDeleteExecutionTool(() => client),
      params: { id: "ex-1" },
      refusal: {
        ok: false,
        action: "delete",
        executionId: "ex-1",
        error: "confirm must be true to delete",
        hint: "Deletion is irreversible. Fetch n8n_get_execution first if you need the record.",
      },
    },
    {
      name: "delete executions",
      build: (client: N8nClient) => createDeleteExecutionsTool(() => client),
      params: { ids: ["ex-1"] },
      refusal: {
        ok: false,
        action: "delete_batch",
        error: "confirm must be true to delete",
        hint: "Batch deletion is irreversible. Fetch n8n_get_execution first for any record you may need later.",
      },
    },
    {
      name: "archive workflow",
      build: (client: N8nClient) => createArchiveWorkflowTool(() => client),
      params: { id: "wf-1" },
      refusal: {
        ok: false,
        action: "archive",
        workflowId: "wf-1",
        error: "confirm must be true to archive",
      },
    },
    {
      name: "delete workflow",
      build: (client: N8nClient) => createDeleteWorkflowTool({ getClient: () => client, backupDir: "/tmp/no-fetch" }),
      params: { id: "wf-1" },
      refusal: {
        ok: false,
        action: "delete",
        workflowId: "wf-1",
        error: "confirm must be true to delete",
        hint: "Deletion is irreversible. Prefer n8n_archive_workflow for reversible cleanup, or fetch n8n_get_workflow with includeDefinition=true and save the output before calling this with confirm=true.",
      },
    },
    {
      name: "create workflow",
      build: (client: N8nClient) => createCreateWorkflowTool({ getClient: () => client }),
      params: { definition: { name: "New workflow", nodes: [], connections: {} } },
      refusal: {
        ok: false,
        action: "create",
        error: "confirm must be true to create (or pass dryRun:true to preview)",
        hint: "Run with dryRun:true first to inspect the cleaned POST body, then repeat with confirm:true to write.",
      },
    },
    {
      name: "pin node data",
      build: (client: N8nClient) => createPinNodeDataTool(() => client),
      params: { id: "wf-1", nodeName: "Webhook", data: [{ json: { ok: true } }] },
      refusal: {
        ok: false,
        error: "confirm must be true to pin data",
      },
    },
    {
      name: "unpin node data",
      build: (client: N8nClient) => createUnpinNodeDataTool(() => client),
      params: { id: "wf-1", nodeName: "Webhook" },
      refusal: {
        ok: false,
        error: "confirm must be true to unpin data",
      },
    },
    {
      name: "create tag",
      build: (client: N8nClient) => createCreateTagTool(() => client),
      params: { name: "prod" },
      refusal: {
        ok: false,
        action: "create_tag",
        error: "confirm must be true to create a tag",
      },
    },
    {
      name: "delete tag",
      build: (client: N8nClient) => createDeleteTagTool(() => client),
      params: { id: "tag-1" },
      refusal: {
        ok: false,
        action: "delete_tag",
        error: "confirm must be true to delete",
        hint: expect.stringContaining("Use n8n_get_workflow_tags on affected workflows beforehand"),
      },
    },
    {
      name: "set workflow tags",
      build: (client: N8nClient) => createSetWorkflowTagsTool(() => client),
      params: { id: "wf-1", tagIds: ["tag-1"] },
      refusal: {
        ok: false,
        action: "set_workflow_tags",
        error: "confirm must be true to set workflow tags",
      },
    },
    {
      name: "retry executions",
      build: (client: N8nClient) => createRetryExecutionsTool(() => client),
      params: { ids: ["ex-1"] },
      refusal: {
        ok: false,
        action: "retry_batch",
        error: "confirm must be true to retry",
        hint: "Each retry spawns a new execution that may re-run side effects (HTTP calls, DB writes, etc). Verify the workflow is safe to re-run before confirming.",
      },
    },
    {
      name: "create credential",
      build: (client: N8nClient) => createCreateCredentialTool(() => client),
      params: { name: "GitHub", type: "githubApi", data: { token: "secret" } },
      refusal: {
        ok: false,
        action: "create_credential",
        error: "confirm must be true to create",
        hint: "Credential creation injects plaintext secrets that persist long-term in n8n's encrypted store. Confirm intent explicitly.",
      },
    },
    {
      name: "delete credential",
      build: (client: N8nClient) => createDeleteCredentialTool(() => client),
      params: { id: "cred-1" },
      refusal: {
        ok: false,
        action: "delete_credential",
        error: "confirm must be true to delete",
        hint: expect.stringContaining("Run n8n_find_workflows_using_credential first"),
      },
    },
  ])("$name returns the current refusal shape before any client call", async ({ build, params, refusal }) => {
    const client = makeFakeClient();
    const tool = build(client);

    await expect(detailsOf(tool, params)).resolves.toEqual(refusal);
    expectNoClientApiCalls(client);
  });
});

describe("golden workflow backup ordering contracts", () => {
  let backupDir: string;

  beforeEach(async () => {
    backupDir = await fs.mkdtemp(path.join(tmpdir(), "n8n-golden-backup-"));
  });

  afterEach(async () => {
    await fs.rm(backupDir, { recursive: true, force: true });
  });

  it("save workflow flushes the backup snapshot before the mutating save call", async () => {
    const calls: string[] = [];
    const current = workflow();
    const client = makeFakeClient({
      getWorkflow: vi.fn().mockImplementation(async () => {
        calls.push("getWorkflow");
        return current;
      }),
      saveWorkflow: vi.fn().mockImplementation(async () => {
        calls.push("saveWorkflow");
        const files = await fs.readdir(backupDir);
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/^wf-1-.+\.json$/);
        const snapshot = JSON.parse(await fs.readFile(path.join(backupDir, files[0]), "utf8"));
        expect(snapshot).toMatchObject({ id: "wf-1", name: "Operator Contract" });
        return { ...current, updatedAt: "2026-01-03T00:00:00.000Z" };
      }),
    });
    const tool = createSaveWorkflowTool({ getClient: () => client, backupDir });

    const details = await detailsOf(tool, {
      id: "wf-1",
      definition: { nodes: current.nodes, connections: current.connections },
      skipValidation: true,
      confirm: true,
    });

    expect(details.ok).toBe(true);
    expect(calls).toEqual(["getWorkflow", "saveWorkflow"]);
  });

  it("delete workflow flushes the DELETED backup snapshot before the mutating delete call", async () => {
    const calls: string[] = [];
    const current = workflow();
    const client = makeFakeClient({
      getWorkflow: vi.fn().mockImplementation(async () => {
        calls.push("getWorkflow");
        return current;
      }),
      deleteWorkflow: vi.fn().mockImplementation(async () => {
        calls.push("deleteWorkflow");
        const files = await fs.readdir(backupDir);
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/^wf-1-DELETED-.+\.json$/);
        const snapshot = JSON.parse(await fs.readFile(path.join(backupDir, files[0]), "utf8"));
        expect(snapshot).toMatchObject({ id: "wf-1", name: "Operator Contract" });
        return current;
      }),
    });
    const tool = createDeleteWorkflowTool({ getClient: () => client, backupDir });

    const details = await detailsOf(tool, { id: "wf-1", confirm: true });

    expect(details.ok).toBe(true);
    expect(calls).toEqual(["getWorkflow", "deleteWorkflow"]);
  });
});
