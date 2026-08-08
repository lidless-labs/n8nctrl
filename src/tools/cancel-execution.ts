import { Type } from "@sinclair/typebox";
import { N8nApiError, type N8nClient } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    id: Type.String({
      description:
        "Execution id to stop (from n8n_list_executions or n8n_search_executions).",
    }),
    confirm: Type.Boolean({
      description:
        "Must be true to actually cancel. Cancellation can leave a multi-step automation partially applied (e.g. a record written but its follow-up notification or cleanup never run). Fetch n8n_get_execution first if you need the current state.",
    }),
  },
  { additionalProperties: false },
);

export function createCancelExecutionTool(getClient: () => N8nClient) {
  return {
    name: "n8n_cancel_execution",
    label: "n8n: cancel execution",
    description:
      "Stop a running or waiting n8n execution by id. Closes the triage loop after n8n_search_executions locates a stuck run. If the execution is already finished, deleted, or never existed, returns ok:false with reason 'not_found_or_finished' rather than throwing. Requires enableEdit and explicit confirm=true.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const { id, confirm } = rawParams as { id: string; confirm: boolean };
      if (!confirm) {
        return jsonToolResult({
          ok: false,
          action: "cancel",
          executionId: id,
          error: "confirm must be true to cancel",
          hint: "Cancellation can leave a multi-step automation partially applied (e.g. a record written but its follow-up notification or cleanup never run). Fetch n8n_get_execution first if you need the current state.",
        });
      }
      const client = getClient();
      try {
        const ex = await client.stopExecution(id);
        const status = ex.status ?? (ex.finished ? "success" : "running");
        return jsonToolResult({
          ok: true,
          action: "cancel",
          executionId: String(ex.id),
          workflowId: String(ex.workflowId ?? ""),
          workflowName: ex.workflowData?.name ?? null,
          status,
          finished: ex.finished,
          startedAt: ex.startedAt ?? null,
          stoppedAt: ex.stoppedAt ?? null,
        });
      } catch (err) {
        if (err instanceof N8nApiError && err.status === 404) {
          return jsonToolResult({
            ok: false,
            action: "cancel",
            executionId: id,
            reason: "not_found_or_finished",
            message:
              "Execution not found. It may have already finished, been deleted, or never existed.",
          });
        }
        throw err;
      }
    },
  };
}
