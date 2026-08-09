import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { N8nClient, N8nExecution, N8nTag, N8nWorkflow } from "../src/client.ts";
import { createActivateTool } from "../src/tools/activate.ts";
import { createArchiveWorkflowTool, createUnarchiveWorkflowTool } from "../src/tools/archive-workflow.ts";
import { createCancelExecutionTool } from "../src/tools/cancel-execution.ts";
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
import { createRetryExecutionTool } from "../src/tools/retry-execution.ts";
import { createRetryExecutionsTool } from "../src/tools/retry-executions.ts";
import { createSaveWorkflowTool } from "../src/tools/save-workflow.ts";
import { createSetWorkflowTagsTool } from "../src/tools/set-workflow-tags.ts";
import { createTriggerTool } from "../src/tools/trigger.ts";
import { createUnpinNodeDataTool } from "../src/tools/unpin-node-data.ts";
import { makeFakeClient, type FakeClient } from "./helpers.ts";

type ConfirmTool = {
  execute: (toolCallId: string, rawParams: Record<string, unknown>) => Promise<unknown>;
};

type GateContext = {
  client: N8nClient;
  backupDir: string;
};

type GateCase = {
  name: string;
  build: (ctx: GateContext) => ConfirmTool;
  params: Record<string, unknown>;
  refusal: Record<string, unknown>;
  seedConfirmed: (client: FakeClient) => void;
  assertConfirmed: (client: FakeClient) => void;
  success: Record<string, unknown>;
};

function workflow(overrides: Partial<N8nWorkflow> = {}): N8nWorkflow {
  return {
    id: "wf-1",
    name: "Gate Coverage",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    nodes: [
      {
        name: "Webhook",
        type: "n8n-nodes-base.webhook",
        parameters: {},
      },
      {
        name: "HTTP",
        type: "n8n-nodes-base.httpRequest",
        parameters: {},
      },
    ],
    connections: {},
    settings: {},
    ...overrides,
  };
}

async function detailsOf(
  tool: ConfirmTool,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await tool.execute("confirm-gate-call", params);
  expect(result).toHaveProperty("details");
  return (result as { details: Record<string, unknown> }).details;
}

function expectNoClientApiCalls(client: N8nClient): void {
  for (const [name, maybeMock] of Object.entries(client as unknown as FakeClient)) {
    if (name === "redact" || typeof maybeMock !== "function" || !("mock" in maybeMock)) continue;
    expect(maybeMock, `${name} should not be called`).not.toHaveBeenCalled();
  }
}

const GATE_CASES: GateCase[] = [
  {
    name: "n8n_trigger",
    build: ({ client }) => createTriggerTool(() => client),
    params: { mode: "workflow", workflowId: "wf-1" },
    refusal: {
      ok: false,
      error: "confirm must be true to trigger a workflow",
    },
    seedConfirmed: (client) => {
      client.getWorkflow = vi.fn().mockResolvedValue(workflow());
      client.executeWorkflow = vi.fn().mockResolvedValue({ executionId: "ex-new" });
    },
    assertConfirmed: (client) => {
      expect(client.getWorkflow).toHaveBeenCalledWith("wf-1");
      expect(client.executeWorkflow).toHaveBeenCalledWith("wf-1", undefined);
    },
    success: { ok: true, mode: "workflow", workflowId: "wf-1" },
  },
  {
    name: "n8n_activate",
    build: ({ client }) => createActivateTool(() => client),
    params: { id: "wf-1" },
    refusal: {
      ok: false,
      action: "activate",
      error: "confirm must be true to activate",
    },
    seedConfirmed: (client) => {
      client.activateWorkflow = vi.fn().mockResolvedValue(workflow({ active: true }));
    },
    assertConfirmed: (client) => {
      expect(client.activateWorkflow).toHaveBeenCalledWith("wf-1");
    },
    success: { ok: true, action: "activate", workflowId: "wf-1", active: true },
  },
  {
    name: "n8n_deactivate",
    build: ({ client }) => createDeactivateTool(() => client),
    params: { id: "wf-1" },
    refusal: {
      ok: false,
      action: "deactivate",
      error: "confirm must be true to deactivate",
    },
    seedConfirmed: (client) => {
      client.deactivateWorkflow = vi.fn().mockResolvedValue(workflow({ active: false }));
    },
    assertConfirmed: (client) => {
      expect(client.deactivateWorkflow).toHaveBeenCalledWith("wf-1");
    },
    success: { ok: true, action: "deactivate", workflowId: "wf-1", active: false },
  },
  {
    name: "n8n_save_workflow",
    build: ({ client, backupDir }) =>
      createSaveWorkflowTool({ getClient: () => client, backupDir }),
    params: {
      id: "wf-1",
      definition: { nodes: workflow().nodes, connections: workflow().connections },
      skipValidation: true,
    },
    refusal: {
      ok: false,
      error: "confirm must be true to save",
    },
    seedConfirmed: (client) => {
      const current = workflow();
      client.getWorkflow = vi.fn().mockResolvedValue(current);
      client.saveWorkflow = vi.fn().mockResolvedValue(current);
    },
    assertConfirmed: (client) => {
      expect(client.getWorkflow).toHaveBeenCalledWith("wf-1");
      expect(client.saveWorkflow).toHaveBeenCalled();
    },
    success: { ok: true },
  },
  {
    name: "n8n_delete_execution",
    build: ({ client }) => createDeleteExecutionTool(() => client),
    params: { id: "ex-1" },
    refusal: {
      ok: false,
      action: "delete",
      executionId: "ex-1",
      error: "confirm must be true to delete",
    },
    seedConfirmed: (client) => {
      const deleted: N8nExecution = {
        id: "ex-1",
        finished: true,
        mode: "trigger",
        workflowId: "wf-1",
        status: "success",
        startedAt: "2026-04-23T00:00:00.000Z",
        stoppedAt: "2026-04-23T00:00:05.000Z",
        workflowData: { id: "wf-1", name: "Gate Coverage" },
      };
      client.deleteExecution = vi.fn().mockResolvedValue(deleted);
    },
    assertConfirmed: (client) => {
      expect(client.deleteExecution).toHaveBeenCalledWith("ex-1");
    },
    success: { ok: true, action: "delete", executionId: "ex-1" },
  },
  {
    name: "n8n_delete_executions",
    build: ({ client }) => createDeleteExecutionsTool(() => client),
    params: { ids: ["ex-1", "ex-2"] },
    refusal: {
      ok: false,
      action: "delete_batch",
      error: "confirm must be true to delete",
    },
    seedConfirmed: (client) => {
      client.deleteExecutions = vi.fn().mockResolvedValue([
        { id: "ex-1", ok: true },
        { id: "ex-2", ok: true },
      ]);
    },
    assertConfirmed: (client) => {
      expect(client.deleteExecutions).toHaveBeenCalledWith(["ex-1", "ex-2"], { concurrency: 3 });
    },
    success: { ok: true, action: "delete_batch", requested: 2 },
  },
  {
    name: "n8n_archive_workflow",
    build: ({ client }) => createArchiveWorkflowTool(() => client),
    params: { id: "wf-1" },
    refusal: {
      ok: false,
      action: "archive",
      workflowId: "wf-1",
      error: "confirm must be true to archive",
    },
    seedConfirmed: (client) => {
      client.archiveWorkflow = vi.fn().mockResolvedValue(workflow({ active: false, isArchived: true }));
    },
    assertConfirmed: (client) => {
      expect(client.archiveWorkflow).toHaveBeenCalledWith("wf-1");
    },
    success: { ok: true, action: "archive", workflowId: "wf-1", isArchived: true },
  },
  {
    name: "n8n_unarchive_workflow",
    build: ({ client }) => createUnarchiveWorkflowTool(() => client),
    params: { id: "wf-1" },
    refusal: {
      ok: false,
      action: "unarchive",
      workflowId: "wf-1",
      error: "confirm must be true to unarchive",
    },
    seedConfirmed: (client) => {
      client.unarchiveWorkflow = vi.fn().mockResolvedValue(workflow({ active: false, isArchived: false }));
    },
    assertConfirmed: (client) => {
      expect(client.unarchiveWorkflow).toHaveBeenCalledWith("wf-1");
    },
    success: { ok: true, action: "unarchive", workflowId: "wf-1", isArchived: false },
  },
  {
    name: "n8n_delete_workflow",
    build: ({ client, backupDir }) =>
      createDeleteWorkflowTool({ getClient: () => client, backupDir }),
    params: { id: "wf-1" },
    refusal: {
      ok: false,
      action: "delete",
      workflowId: "wf-1",
      error: "confirm must be true to delete",
    },
    seedConfirmed: (client) => {
      const current = workflow();
      client.getWorkflow = vi.fn().mockResolvedValue(current);
      client.deleteWorkflow = vi.fn().mockResolvedValue(current);
    },
    assertConfirmed: (client) => {
      expect(client.getWorkflow).toHaveBeenCalledWith("wf-1");
      expect(client.deleteWorkflow).toHaveBeenCalledWith("wf-1");
    },
    success: { ok: true, action: "delete", workflowId: "wf-1" },
  },
  {
    name: "n8n_create_workflow",
    build: ({ client }) => createCreateWorkflowTool({ getClient: () => client }),
    params: {
      definition: {
        name: "New workflow",
        nodes: workflow().nodes,
        connections: workflow().connections,
      },
      skipValidation: true,
    },
    refusal: {
      ok: false,
      action: "create",
      error: "confirm must be true to create (or pass dryRun:true to preview)",
    },
    seedConfirmed: (client) => {
      client.createWorkflow = vi.fn().mockResolvedValue(workflow({ id: "wf-new", active: false }));
    },
    assertConfirmed: (client) => {
      expect(client.createWorkflow).toHaveBeenCalled();
    },
    success: { ok: true, action: "create", workflowId: "wf-new" },
  },
  {
    name: "n8n_pin_node_data",
    build: ({ client }) => createPinNodeDataTool(() => client),
    params: {
      id: "wf-1",
      nodeName: "HTTP",
      data: [{ json: { pinned: true } }],
    },
    refusal: {
      ok: false,
      error: "confirm must be true to pin data",
    },
    seedConfirmed: (client) => {
      const current = workflow();
      client.getWorkflow = vi.fn().mockResolvedValue(current);
      client.saveWorkflow = vi.fn().mockResolvedValue(current);
    },
    assertConfirmed: (client) => {
      expect(client.getWorkflow).toHaveBeenCalledWith("wf-1");
      expect(client.saveWorkflow).toHaveBeenCalled();
    },
    success: { ok: true, workflowId: "wf-1", nodeName: "HTTP" },
  },
  {
    name: "n8n_unpin_node_data",
    build: ({ client }) => createUnpinNodeDataTool(() => client),
    params: { id: "wf-1", nodeName: "HTTP" },
    refusal: {
      ok: false,
      error: "confirm must be true to unpin data",
    },
    seedConfirmed: (client) => {
      const current = workflow({
        pinData: {
          HTTP: [{ json: { drop: true } }],
        },
      });
      client.getWorkflow = vi.fn().mockResolvedValue(current);
      client.saveWorkflow = vi.fn().mockResolvedValue(current);
    },
    assertConfirmed: (client) => {
      expect(client.getWorkflow).toHaveBeenCalledWith("wf-1");
      expect(client.saveWorkflow).toHaveBeenCalled();
    },
    success: { ok: true, workflowId: "wf-1", nodeName: "HTTP" },
  },
  {
    name: "n8n_create_tag",
    build: ({ client }) => createCreateTagTool(() => client),
    params: { name: "prod" },
    refusal: {
      ok: false,
      action: "create_tag",
      error: "confirm must be true to create a tag",
    },
    seedConfirmed: (client) => {
      client.createTag = vi.fn().mockResolvedValue({ id: "tag-1", name: "prod" } satisfies N8nTag);
    },
    assertConfirmed: (client) => {
      expect(client.createTag).toHaveBeenCalledWith("prod");
    },
    success: { ok: true, action: "create_tag", tag: { id: "tag-1", name: "prod" } },
  },
  {
    name: "n8n_delete_tag",
    build: ({ client }) => createDeleteTagTool(() => client),
    params: { id: "tag-1" },
    refusal: {
      ok: false,
      action: "delete_tag",
      error: "confirm must be true to delete",
    },
    seedConfirmed: (client) => {
      client.deleteTag = vi.fn().mockResolvedValue({ id: "tag-1", name: "prod" } satisfies N8nTag);
    },
    assertConfirmed: (client) => {
      expect(client.deleteTag).toHaveBeenCalledWith("tag-1");
    },
    success: { ok: true, action: "delete_tag", deleted: { id: "tag-1", name: "prod" } },
  },
  {
    name: "n8n_set_workflow_tags",
    build: ({ client }) => createSetWorkflowTagsTool(() => client),
    params: { id: "wf-1", tagIds: ["tag-1"] },
    refusal: {
      ok: false,
      action: "set_workflow_tags",
      error: "confirm must be true to set workflow tags",
    },
    seedConfirmed: (client) => {
      client.setWorkflowTags = vi
        .fn()
        .mockResolvedValue([{ id: "tag-1", name: "prod" } satisfies N8nTag]);
    },
    assertConfirmed: (client) => {
      expect(client.setWorkflowTags).toHaveBeenCalledWith("wf-1", ["tag-1"]);
    },
    success: { ok: true, action: "set_workflow_tags", workflowId: "wf-1", attached: 1 },
  },
  {
    name: "n8n_retry_execution",
    build: ({ client }) => createRetryExecutionTool(() => client),
    params: { id: "ex-1" },
    refusal: {
      ok: false,
      action: "retry",
      originalExecutionId: "ex-1",
      error: "confirm must be true to retry",
    },
    seedConfirmed: (client) => {
      const retried: N8nExecution = {
        id: "ex-2",
        finished: false,
        mode: "trigger",
        workflowId: "wf-1",
        status: "running",
        startedAt: "2026-04-23T00:01:00.000Z",
      };
      client.retryExecution = vi.fn().mockResolvedValue(retried);
    },
    assertConfirmed: (client) => {
      expect(client.retryExecution).toHaveBeenCalledWith("ex-1", { loadWorkflow: undefined });
    },
    success: { ok: true, action: "retry", originalExecutionId: "ex-1", newExecutionId: "ex-2" },
  },
  {
    name: "n8n_retry_executions",
    build: ({ client }) => createRetryExecutionsTool(() => client),
    params: { ids: ["ex-1", "ex-2"] },
    refusal: {
      ok: false,
      action: "retry_batch",
      error: "confirm must be true to retry",
    },
    seedConfirmed: (client) => {
      client.retryExecutions = vi.fn().mockResolvedValue([
        { id: "ex-1", ok: true, newExecutionId: "ex-3" },
        { id: "ex-2", ok: true, newExecutionId: "ex-4" },
      ]);
    },
    assertConfirmed: (client) => {
      expect(client.retryExecutions).toHaveBeenCalledWith(["ex-1", "ex-2"], {
        loadWorkflow: undefined,
        concurrency: 3,
      });
    },
    success: { ok: true, action: "retry_batch", requested: 2 },
  },
  {
    name: "n8n_cancel_execution",
    build: ({ client }) => createCancelExecutionTool(() => client),
    params: { id: "ex-1" },
    refusal: {
      ok: false,
      action: "cancel",
      executionId: "ex-1",
      error: "confirm must be true to cancel",
    },
    seedConfirmed: (client) => {
      const stopped: N8nExecution = {
        id: "ex-1",
        finished: true,
        mode: "trigger",
        workflowId: "wf-1",
        status: "canceled",
        startedAt: "2026-04-23T00:00:00.000Z",
        stoppedAt: "2026-04-23T00:00:05.000Z",
        workflowData: { id: "wf-1", name: "Gate Coverage" },
      };
      client.stopExecution = vi.fn().mockResolvedValue(stopped);
    },
    assertConfirmed: (client) => {
      expect(client.stopExecution).toHaveBeenCalledWith("ex-1");
    },
    success: { ok: true, action: "cancel", executionId: "ex-1", status: "canceled" },
  },
  {
    name: "n8n_create_credential",
    build: ({ client }) => createCreateCredentialTool(() => client),
    params: { name: "GitHub", type: "githubApi", data: { token: "secret" } },
    refusal: {
      ok: false,
      action: "create_credential",
      error: "confirm must be true to create",
    },
    seedConfirmed: (client) => {
      client.createCredential = vi.fn().mockResolvedValue({
        id: "cred-1",
        name: "GitHub",
        type: "githubApi",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
      });
    },
    assertConfirmed: (client) => {
      expect(client.createCredential).toHaveBeenCalledWith({
        name: "GitHub",
        type: "githubApi",
        data: { token: "secret" },
      });
    },
    success: { ok: true, action: "create_credential" },
  },
  {
    name: "n8n_delete_credential",
    build: ({ client }) => createDeleteCredentialTool(() => client),
    params: { id: "cred-1" },
    refusal: {
      ok: false,
      action: "delete_credential",
      error: "confirm must be true to delete",
    },
    seedConfirmed: (client) => {
      client.deleteCredential = vi.fn().mockResolvedValue({
        id: "cred-1",
        name: "GitHub",
        type: "githubApi",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
      });
    },
    assertConfirmed: (client) => {
      expect(client.deleteCredential).toHaveBeenCalledWith("cred-1");
    },
    success: { ok: true, action: "delete_credential", deleted: { id: "cred-1", name: "GitHub" } },
  },
];

describe("confirmation gate coverage", () => {
  let backupDir: string;

  beforeEach(async () => {
    backupDir = await fs.mkdtemp(path.join(tmpdir(), "n8n-confirm-gate-"));
  });

  afterEach(async () => {
    await fs.rm(backupDir, { recursive: true, force: true });
  });

  it("covers every confirm-gated write tool in the codebase", () => {
    expect(GATE_CASES.map((gateCase) => gateCase.name).sort()).toEqual(
      [
        "n8n_activate",
        "n8n_archive_workflow",
        "n8n_cancel_execution",
        "n8n_create_credential",
        "n8n_create_tag",
        "n8n_create_workflow",
        "n8n_deactivate",
        "n8n_delete_credential",
        "n8n_delete_execution",
        "n8n_delete_executions",
        "n8n_delete_tag",
        "n8n_delete_workflow",
        "n8n_pin_node_data",
        "n8n_retry_execution",
        "n8n_retry_executions",
        "n8n_save_workflow",
        "n8n_set_workflow_tags",
        "n8n_trigger",
        "n8n_unarchive_workflow",
        "n8n_unpin_node_data",
      ].sort(),
    );
  });

  describe.each(GATE_CASES)("$name", (gateCase) => {
    it.each([
      { label: "missing confirm", params: {} },
      { label: "confirm:false", params: { confirm: false } },
    ])("blocks the destructive action when $label", async ({ params: confirmOverride }) => {
      const client = makeFakeClient();
      const tool = gateCase.build({ client, backupDir });
      const params = { ...gateCase.params, ...confirmOverride };

      const details = await detailsOf(tool, params);

      expect(details).toMatchObject(gateCase.refusal);
      expectNoClientApiCalls(client);
    });

    it("proceeds when confirm:true", async () => {
      const client = makeFakeClient();
      gateCase.seedConfirmed(client as unknown as FakeClient);
      const tool = gateCase.build({ client, backupDir });

      const details = await detailsOf(tool, { ...gateCase.params, confirm: true });

      expect(details).toMatchObject(gateCase.success);
      gateCase.assertConfirmed(client as unknown as FakeClient);
    });
  });
});
