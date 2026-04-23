# n8n-ops-mcp

Ops-focused n8n tools for Claude-compatible clients. List, inspect, trigger, validate, and safely edit n8n workflows from any MCP host — with first-class [OpenClaw](https://github.com/openclaw/openclaw) support.

Status: v0.1.0 — read + trigger + validate + activate/deactivate/save (behind `enableEdit` with auto-backup). MCP wrapper and npm publish next.

## Why

Your AI agent has no native awareness of your n8n footprint. If a pipeline breaks, you SSH to the host or open the n8n UI. With this package, your agent can answer "what's broken in my n8n?" from chat, and trigger manual workflows without you leaving your client.

This is an **ops** tool — focused on listing, triggering, validating, and editing workflows. If you want a catalog/docs tool that indexes n8n's node library, see [n8n-mcp](https://www.npmjs.com/package/n8n-mcp).

## Tools

**`n8n_list_workflows`** - list workflows with optional `active`, `tags`, `name` (substring), `limit` filters. Returns id, name, active state, tags, updatedAt.

**`n8n_get_workflow`** - fetch one workflow by id. Returns metadata by default. Pass `includeDefinition: true` to get the full node graph + connections.

**`n8n_list_executions`** - list recent executions with optional `workflowId`, `status` (success/error/running/waiting/canceled), `limit` filters. Returns id, workflowId, workflowName, status, mode, startedAt, stoppedAt.

**`n8n_get_execution`** - fetch one execution by id. Includes per-node run log (truncated to `maxExecutionLogBytes`, default 64 KB, with a tail hint when it exceeds) and the raw error object verbatim when status is `error`. Pass `includeRunData: false` to skip the run log and get just status + error.

**`n8n_list_webhooks`** - scan workflows for webhook and form-trigger nodes and return their paths + fully-formed `triggerUrl`. Pairs with `n8n_trigger` mode='webhook' so agents can discover and call webhooks without opening n8n. Optional `workflowId` for a single workflow, `activeOnly` (default true), `limit` (default 50).

**`n8n_validate_workflow`** - static checks on a workflow: deprecated node types (function → code), legacy Code-node API (`$node[]`, `items` global, `require()`), orphan nodes, disabled nodes, missing trigger. Returns issues with severity (error/warning/info) and a summary count.

### Write tools (behind `enableEdit`)

**`n8n_activate`** - activate a workflow so its triggers start firing. Idempotent.

**`n8n_deactivate`** - deactivate a workflow so triggers stop firing. Running executions are not cancelled. Idempotent.

**`n8n_save_workflow`** - overwrite a workflow. Before writing: fetches the current version, snapshots it to `backupDir` as `<id>-<timestamp>.json` (mode 0600), runs `validateWorkflow` on the proposed new state, and aborts on error-severity issues (pass `skipValidation: true` to bypass). Requires `confirm: true` to actually PUT. Response includes the backup path and a `restoreHint` describing how to roll back.

**`n8n_trigger`** - run a workflow. Two modes:
- `mode: "webhook"` + `webhookPath` - POST (or GET/PUT/DELETE) to the configured base URL + path, with an optional JSON `payload`. This is the reliable path.
- `mode: "workflow"` + `workflowId` - attempts `POST /api/v1/workflows/:id/execute`. Pre-checks that the workflow is active and has a webhook/manual/form trigger node. Most n8n builds do not expose this endpoint on the Public API and will 405; the tool surfaces a hint to switch to webhook mode in that case.

## Install

```bash
git clone https://github.com/solomonneas/n8n-ops-mcp.git
cd n8n-ops-mcp
npm install
```

### OpenClaw

Register in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["n8n"],
    "load": {
      "paths": ["/path/to/n8n-ops-mcp"]
    },
    "entries": {
      "n8n": {
        "enabled": true,
        "config": {
          "baseUrl": "http://your-n8n-host:5678"
        }
      }
    }
  }
}
```

Set the API key in your OpenClaw environment (generate in n8n under Settings -> API):

```bash
# ~/.openclaw/workspace/.env
N8N_API_KEY=eyJhbGciOi...
```

Restart the gateway so the env var loads:

```bash
systemctl --user restart openclaw-gateway
```

## Config

| Key | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | string | required | n8n base URL |
| `apiKey` | string | empty | Inline key. Prefer env var. |
| `apiKeyEnv` | string | `N8N_API_KEY` | Env var to read the key from if `apiKey` is blank. |
| `enableEdit` | boolean | `false` | Enable write tools (not yet implemented). |
| `maxExecutionLogBytes` | number | `65536` | Cap on inline execution log bytes. |
| `requestTimeoutMs` | number | `15000` | HTTP timeout. |
| `backupDir` | string | `~/.n8n-backups` | Pre-save snapshot directory. |

## Client setups

- **OpenClaw:** see Install above.
- **Claude Desktop / Claude Code / Codex CLI / Hermes Agent:** pending, via the MCP wrapper entry point (shipping in v0.2.0).

## Roadmap

- [x] `n8n_list_workflows`
- [x] `n8n_get_workflow`
- [x] `n8n_list_executions`
- [x] `n8n_get_execution`
- [x] `n8n_trigger` (webhook + manual)
- [x] `n8n_list_webhooks` (surface webhook paths for mode='webhook')
- [x] `n8n_validate_workflow` (Code node + deprecated node checks)
- [x] `n8n_activate` / `n8n_deactivate` (behind `enableEdit`)
- [x] `n8n_save_workflow` with auto-backup + validation gate (behind `enableEdit`)
- [ ] `n8n_search_executions` (text search across run logs)
- [ ] MCP wrapper + npm publish

## License

MIT
