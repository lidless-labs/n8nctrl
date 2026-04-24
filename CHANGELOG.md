# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.1] - 2026-04-24

### Changed
- Reframed the README as MCP-first (any MCP-compatible client) while preserving the "built for OpenClaw" origin story and first-class plugin path.
- Refreshed package and plugin descriptions to cover the full workflow + execution lifecycle added in 0.7/0.8.
- Added this `CHANGELOG.md`.

No behavior changes. Docs and metadata only.

## [0.8.0] - 2026-04-23

### Added
- `n8n_create_workflow` - `POST /workflows`. Accepts `n8n_get_workflow(includeDefinition=true)` output directly, strips read-only fields, runs `validateWorkflow` as a pre-check. New workflow is created inactive. Primary restore path for `n8n_delete_workflow` snapshots (one-call restore).

## [0.7.0] - 2026-04-23

### Added
- `n8n_archive_workflow` - soft-delete. Reversible, preserves the original id, deactivates as a side effect.
- `n8n_unarchive_workflow` - restore an archived workflow. Does NOT reactivate triggers.
- `n8n_delete_workflow` - permanent delete. Confirm-gated, snapshots to `backupDir` before the DELETE; aborts if the snapshot can't be written. Restore via `n8n_create_workflow`.

## [0.6.0] - 2026-04-23

### Added
- `n8n_delete_executions` - batch form of delete-execution. Client-side fan-out with bounded concurrency (default 3, max 10), capped at 50 ids, confirm-gated. 404 per id is treated as `already_deleted` (idempotent). A 5xx on any id aborts the batch via an `AbortController` - no new ids claimed and in-flight requests cancelled client-side. Best-effort, not transactional.

## [0.5.1] - 2026-04-23

### Changed
- Consolidated per-test `createFakeClient` copies into a shared fake-fetch harness (`tests/helpers/fake-fetch.ts`).
- Added `N8nClient` wire-shape coverage so any drift from n8n's REST contract is caught at the HTTP boundary.

## [0.5.0] - 2026-04-23

### Added
- `n8n_delete_execution` - `DELETE /executions/{id}`. Confirm-gated, irreversible. Returns `ok: false` with `reason: "not_found"` on 404.

## [0.4.0] - 2026-04-23

### Added
- `n8n_retry_execution` - `POST /executions/{id}/retry`. Creates a NEW execution and surfaces both `originalExecutionId` and `newExecutionId`. Optional `loadWorkflow: true` retries against the currently saved workflow.

## [0.3.0] - 2026-04-23

### Added
- `n8n_cancel_execution` - `POST /executions/{id}/stop`. Closes the triage loop after `n8n_search_executions` locates a stuck run.

## [0.2.0] - 2026-04-23

### Added
- `n8n_search_executions` - text-search recent executions for an error fragment. Defaults to scanning `status=error` payloads; `scope: "all"` also greps per-node run data.

## [0.1.2] - 2026-04-23

### Added
- `openclaw.build.{openclawVersion,pluginSdkVersion}` in `package.json` for ClawHub publish metadata.

## [0.1.1] - 2026-04-23

### Added
- `openclaw.compat.pluginApi` in `package.json` for ClawHub publish.

## [0.1.0] - 2026-04-23

### Added
- Initial release. Read-only ops tools: `n8n_list_workflows`, `n8n_get_workflow`, `n8n_list_executions`, `n8n_get_execution`, `n8n_list_webhooks`, `n8n_validate_workflow`, `n8n_trigger`.
- Edit tools behind `enableEdit`: `n8n_activate`, `n8n_deactivate`, `n8n_save_workflow` (auto-backup + validation gate).
- MCP stdio wrapper so the plugin runs in any MCP-compatible client (Claude Desktop, Claude Code, Codex CLI, Hermes Agent).
- Built as a first-class OpenClaw plugin (shared gateway process, auth profiles, hooks).

[0.8.1]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.8.1
[0.8.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.8.0
[0.7.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.7.0
[0.6.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.6.0
[0.5.1]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.5.1
[0.5.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.5.0
[0.4.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.4.0
[0.3.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.3.0
[0.2.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.2.0
[0.1.2]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.1.2
[0.1.1]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/solomonneas/n8n-ops-mcp/releases/tag/v0.1.0
