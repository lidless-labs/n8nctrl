import { describe, it, expect, vi } from "vitest";
import { createCancelExecutionTool } from "../src/tools/cancel-execution.ts";
import { makeFakeClient } from "./helpers.ts";
import { N8nApiError, type N8nClient, type N8nExecution } from "../src/client.ts";

async function run(
  tool: ReturnType<typeof createCancelExecutionTool>,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = (await tool.execute("call-1", params)) as { details: Record<string, unknown> };
  return res.details;
}

function buildTool(client: N8nClient) {
  return createCancelExecutionTool(() => client);
}

describe("n8n_cancel_execution", () => {
  it("stops a running execution and returns a success summary", async () => {
    const stopped: N8nExecution = {
      id: "42",
      finished: true,
      mode: "trigger",
      workflowId: "wf-1",
      status: "canceled",
      startedAt: "2026-04-23T00:00:00.000Z",
      stoppedAt: "2026-04-23T00:00:05.000Z",
      workflowData: { id: "wf-1", name: "My Workflow" },
    };
    const stopExecution = vi.fn().mockResolvedValue(stopped);
    const client = makeFakeClient({ stopExecution });
    const tool = buildTool(client);

    const details = await run(tool, { id: "42" });

    expect(stopExecution).toHaveBeenCalledWith("42");
    expect(details).toMatchObject({
      ok: true,
      action: "cancel",
      executionId: "42",
      workflowId: "wf-1",
      workflowName: "My Workflow",
      status: "canceled",
      finished: true,
      startedAt: "2026-04-23T00:00:00.000Z",
      stoppedAt: "2026-04-23T00:00:05.000Z",
    });
  });

  it("returns ok:false with reason=not_found_or_finished on 404", async () => {
    const stopExecution = vi
      .fn()
      .mockRejectedValue(
        new N8nApiError(404, "/api/v1/executions/999/stop", "not found"),
      );
    const client = makeFakeClient({ stopExecution });
    const tool = buildTool(client);

    const details = await run(tool, { id: "999" });

    expect(details.ok).toBe(false);
    expect(details.reason).toBe("not_found_or_finished");
    expect(details.executionId).toBe("999");
  });

  it("rethrows non-404 API errors so the agent sees the real failure", async () => {
    const stopExecution = vi
      .fn()
      .mockRejectedValue(
        new N8nApiError(500, "/api/v1/executions/7/stop", "upstream exploded"),
      );
    const client = makeFakeClient({ stopExecution });
    const tool = buildTool(client);

    await expect(run(tool, { id: "7" })).rejects.toThrow(/upstream exploded/);
  });
});
