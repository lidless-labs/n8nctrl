import { Type } from "@sinclair/typebox";
import { N8nApiError, type N8nClient } from "../client.ts";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    id: Type.String({
      description:
        "Execution id to retry (from n8n_list_executions or n8n_search_executions).",
    }),
    confirm: Type.Boolean({
      description:
        "Must be true to actually retry. Each retry spawns a new execution that may re-run side effects (HTTP calls, DB writes, etc). Verify the workflow is safe to re-run before confirming.",
    }),
    loadWorkflow: Type.Optional(
      Type.Boolean({
        description:
          "If true, retry against the currently saved workflow instead of the version captured at the original execution time. Omit to accept n8n's default.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createRetryExecutionTool(getClient: () => N8nClient) {
  return {
    name: "n8n_retry_execution",
    label: "n8n: retry execution",
    description:
      "Retry a failed n8n execution by id via POST /executions/{id}/retry. Creates a NEW execution, and the response surfaces both the original id and the newExecutionId so agents can follow up. If the id no longer matches an execution (404), returns ok:false with reason 'not_found'. If the execution is not retryable (409, typically still running), returns ok:false with reason 'not_retryable'. All other API errors rethrow. Optional loadWorkflow:true retries against the current saved workflow rather than the version captured at the original execution time. Requires enableEdit and explicit confirm=true.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const { id, confirm, loadWorkflow } = rawParams as {
        id: string;
        confirm: boolean;
        loadWorkflow?: boolean;
      };
      if (!confirm) {
        return jsonToolResult({
          ok: false,
          action: "retry",
          originalExecutionId: id,
          error: "confirm must be true to retry",
          hint: "Each retry spawns a new execution that may re-run side effects (HTTP calls, DB writes, etc). Verify the workflow is safe to re-run before confirming.",
        });
      }
      const client = getClient();
      const opts: { loadWorkflow?: boolean } =
        loadWorkflow === undefined ? {} : { loadWorkflow };
      try {
        const ex = await client.retryExecution(id, opts);
        const status = ex.status ?? (ex.finished ? "success" : "running");
        return jsonToolResult({
          ok: true,
          action: "retry",
          originalExecutionId: id,
          newExecutionId: String(ex.id),
          workflowId: String(ex.workflowId ?? ""),
          workflowName: ex.workflowData?.name ?? null,
          status,
          finished: ex.finished,
          startedAt: ex.startedAt ?? null,
          stoppedAt: ex.stoppedAt ?? null,
          loadWorkflow: loadWorkflow ?? null,
        });
      } catch (err) {
        if (err instanceof N8nApiError && err.status === 404) {
          return jsonToolResult({
            ok: false,
            action: "retry",
            originalExecutionId: id,
            reason: "not_found",
            message:
              "Execution not found. It may have been deleted or never existed.",
          });
        }
        if (err instanceof N8nApiError && err.status === 409) {
          return jsonToolResult({
            ok: false,
            action: "retry",
            originalExecutionId: id,
            reason: "not_retryable",
            message:
              "Execution is not retryable. It may still be running, or n8n refused the retry for this execution's state.",
          });
        }
        throw err;
      }
    },
  };
}
