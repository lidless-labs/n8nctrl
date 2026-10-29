import { Type } from "@sinclair/typebox";
import type { N8nClient, N8nExecution } from "../client.ts";
import { untrustedWorkflowResult } from "./result.ts";
import { redactSecrets, UNTRUSTED_CONTENT_NOTICE } from "./redact-output.ts";

const Schema = Type.Object(
  {
    id: Type.String({
      description: "Execution id (from n8n_list_executions).",
    }),
    includeRunData: Type.Optional(
      Type.Boolean({
        description:
          "Include the per-node run log. Default false (status + error summary only). Set true to add run data, which can contain sensitive node output.",
      }),
    ),
  },
  { additionalProperties: false },
);

export interface GetExecutionDeps {
  getClient: () => N8nClient;
  maxLogBytes: number;
}

export function createGetExecutionTool(deps: GetExecutionDeps) {
  return {
    name: "n8n_get_execution",
    label: "n8n: get execution",
    description:
      "Fetch a single n8n execution by id. Returns status, mode, timing, and the error summary. Per-node run data is included only when includeRunData is true, and large run logs are truncated with a tail hint. Secret-bearing keys in error and run data are redacted, and that content is untrusted workflow output.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const params = rawParams as { id: string; includeRunData?: boolean };
      const includeRunData = params.includeRunData === true;
      // n8n only returns the error and lastNodeExecuted with includeData=true,
      // so the data is always requested. runData is dropped below unless asked for.
      const client = deps.getClient();
      let raw: N8nExecution;
      try {
        raw = await client.getExecution(params.id, { includeData: true });
      } catch {
        throw new Error("n8n execution read failed; upstream details suppressed to protect execution secrets");
      }
      // Redact before projection or truncation can split a configured secret.
      const ex = redactSecrets(raw, 0, (text) => client.redact(text)) as N8nExecution;

      const status =
        ex.status ?? (ex.finished ? "success" : "running");
      const base = {
        id: String(ex.id),
        workflowId: String(ex.workflowId ?? ""),
        workflowName: ex.workflowData?.name ?? null,
        status,
        mode: ex.mode,
        finished: ex.finished,
        startedAt: ex.startedAt ?? null,
        stoppedAt: ex.stoppedAt ?? null,
        waitTill: ex.waitTill ?? null,
        retryOf: ex.retryOf ?? null,
        retrySuccessId: ex.retrySuccessId ?? null,
        lastNodeExecuted: ex.data?.resultData?.lastNodeExecuted ?? null,
      };

      const error = ex.data?.resultData?.error;
      const runData = ex.data?.resultData?.runData;

      const body: Record<string, unknown> = { ...base };
      const hasRunData = includeRunData && runData !== undefined;
      if (error !== undefined) {
        body.error = redactSecrets(error);
      }
      if (hasRunData) {
        body.runData = truncateRunData(redactSecrets(runData), deps.maxLogBytes);
      }
      if (error !== undefined || hasRunData) {
        body.notice = UNTRUSTED_CONTENT_NOTICE;
      }
      return untrustedWorkflowResult(body);
    },
  };
}

function truncateRunData(
  runData: unknown,
  maxBytes: number,
): unknown {
  const serialized = JSON.stringify(runData);
  const size = Buffer.byteLength(serialized, "utf8");
  if (size <= maxBytes) {
    return runData;
  }
  const tail = serialized.slice(-maxBytes);
  return {
    _truncated: true,
    _hint: `log exceeded ${maxBytes} bytes (actual ${size}), showing tail`,
    _tail: tail,
  };
}
