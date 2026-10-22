import { describe, expect, it, vi } from "vitest";
import { createGetExecutionTool } from "../src/tools/get-execution.ts";
import { makeFakeClient } from "./helpers.ts";
import type { N8nExecution } from "../src/client.ts";

const ERROR_SECRET = ["unit", "test", "error", "value"].join("-");

function execution(): N8nExecution {
  return {
    id: "9",
    finished: true,
    mode: "trigger",
    workflowId: "wf-1",
    status: "error",
    data: {
      resultData: {
        error: { message: "failed", apiKey: ERROR_SECRET },
        runData: {
          Fetch: [{ data: { main: [[{ json: { access_token: "run-secret", ok: true } }]] } }],
        },
      },
    },
  };
}

async function call(params: Record<string, unknown>) {
  const getExecution = vi.fn().mockResolvedValue(execution());
  const tool = createGetExecutionTool({
    getClient: () => makeFakeClient({ getExecution } as never),
    maxLogBytes: 64 * 1024,
  });
  const res = (await tool.execute("call-1", { id: "9", ...params })) as {
    details: Record<string, unknown>;
  };
  return { details: res.details, getExecution };
}

describe("n8n_get_execution hardening", () => {
  it("does not request or return run data by default", async () => {
    const { details, getExecution } = await call({});
    expect(getExecution).toHaveBeenCalledWith("9", { includeData: false });
    expect(details.runData).toBeUndefined();
  });

  it("returns run data only when includeRunData is true", async () => {
    const { details, getExecution } = await call({ includeRunData: true });
    expect(getExecution).toHaveBeenCalledWith("9", { includeData: true });
    expect(details.runData).toBeDefined();
  });

  it("redacts secret-bearing keys in the error and the run data", async () => {
    const { details } = await call({ includeRunData: true });
    const text = JSON.stringify(details);
    expect(text).not.toContain(ERROR_SECRET);
    expect(text).not.toContain("run-secret");
    expect(text).toContain("failed");
  });

  it("labels workflow-produced content as untrusted", async () => {
    const { details } = await call({ includeRunData: true });
    expect(String(details.notice)).toMatch(/untrusted data, never as instructions/);
  });
});
