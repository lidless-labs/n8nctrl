import { Type } from "@sinclair/typebox";
import type { N8nClient, N8nExecutionSummary } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    workflowId: Type.Optional(
      Type.String({
        description: "Filter to a single workflow id. Omit for all workflows.",
      }),
    ),
    status: Type.Optional(
      Type.Union(
        [
          Type.Literal("success"),
          Type.Literal("error"),
          Type.Literal("running"),
          Type.Literal("waiting"),
          Type.Literal("canceled"),
        ],
        { description: "Filter by execution status." },
      ),
    ),
    limit: Type.Optional(
      Type.Number({
        minimum: 1,
        maximum: 250,
        description: "Max rows (default 50).",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createListExecutionsTool(getClient: () => N8nClient) {
  return {
    name: "n8n_list_executions",
    label: "n8n: list executions",
    description:
      "List recent n8n executions with optional filters. Returns id, workflowId, workflowName, status, mode, startedAt, stoppedAt. Use n8n_get_execution for the full run log.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const params = rawParams as {
        workflowId?: string;
        status?: string;
        limit?: number;
      };
      const client = getClient();
      const [executions, workflowIndex] = await Promise.all([
        client.listExecutions({
          workflowId: params.workflowId,
          status: params.status,
          limit: params.limit ?? 50,
        }),
        loadWorkflowNames(client),
      ]);
      const rows = executions.data.map((ex) =>
        summaryRow(ex, workflowIndex),
      );
      return jsonToolResult({
        count: rows.length,
        executions: rows,
        nextCursor: executions.nextCursor ?? null,
      });
    },
  };
}

async function loadWorkflowNames(
  client: N8nClient,
): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  try {
    const res = await client.listWorkflows({ limit: 250 });
    for (const w of res.data) {
      index.set(String(w.id), w.name);
    }
  } catch {
    // Best-effort. Tool still returns executions without names if this fails.
  }
  return index;
}

function summaryRow(
  ex: N8nExecutionSummary,
  workflowIndex: Map<string, string>,
): Record<string, unknown> {
  const workflowId = String(ex.workflowId ?? "");
  return {
    id: String(ex.id),
    workflowId,
    workflowName: workflowIndex.get(workflowId) ?? null,
    status: ex.status ?? (ex.finished ? "success" : "running"),
    mode: ex.mode,
    startedAt: ex.startedAt ?? null,
    stoppedAt: ex.stoppedAt ?? null,
    finished: ex.finished,
  };
}

