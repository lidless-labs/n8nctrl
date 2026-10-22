import { annotationsFromTiers, type ToolAnnotations, type ToolTier } from "@lidless-labs/effect-operator-kit";

/**
 * Tool tier registry. Executor v2 prompts only on `destructiveHint === true`, so
 * only the reads are declared read-only; every tool that writes, deletes, runs or
 * triggers keeps the kit's fail-closed `destructiveHint: true`. `annotationsFor`
 * throws for a tool with no entry, so a new tool cannot register unclassified.
 */
export const TOOL_TIERS: Readonly<Record<string, ToolTier>> = {
  n8n_list_workflows: "read",
  n8n_get_workflow: "read",
  n8n_list_executions: "read",
  n8n_get_execution: "read",
  n8n_search_executions: "read",
  n8n_list_webhooks: "read",
  n8n_validate_workflow: "read",
  n8n_audit_browser_bridge_usage: "read",
  n8n_scaffold_browser_bridge_node: "read",
  n8n_list_schedules: "read",
  n8n_list_tags: "read",
  n8n_get_workflow_tags: "read",
  n8n_run_audit: "read",
  n8n_find_workflows_using_node_type: "read",
  n8n_execution_stats: "read",
  n8n_list_credentials: "read",
  n8n_get_credential_schema: "read",
  n8n_find_workflows_using_credential: "read",
  n8n_check_disabled_nodes: "read",
  n8n_diff_workflow: "read",

  n8n_trigger: "destructive",
  n8n_activate: "destructive",
  n8n_deactivate: "destructive",
  n8n_save_workflow: "destructive",
  n8n_cancel_execution: "destructive",
  n8n_retry_execution: "destructive",
  n8n_delete_execution: "destructive",
  n8n_delete_executions: "destructive",
  n8n_archive_workflow: "destructive",
  n8n_unarchive_workflow: "destructive",
  n8n_delete_workflow: "destructive",
  n8n_create_workflow: "destructive",
  n8n_pin_node_data: "destructive",
  n8n_unpin_node_data: "destructive",
  n8n_create_tag: "destructive",
  n8n_delete_tag: "destructive",
  n8n_set_workflow_tags: "destructive",
  n8n_retry_executions: "destructive",
  n8n_create_credential: "destructive",
  n8n_delete_credential: "destructive",
};

const ANNOTATIONS = annotationsFromTiers(TOOL_TIERS);

export function annotationsFor(name: string): ToolAnnotations {
  const annotations = ANNOTATIONS[name];
  if (!annotations) throw new Error(`no tool tier registered for ${name}`);
  return annotations;
}
