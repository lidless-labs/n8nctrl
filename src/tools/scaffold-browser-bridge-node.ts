import { Type } from "@sinclair/typebox";
import { jsonToolResult } from "./result.ts";

const Schema = Type.Object(
  {
    platform: Type.String({
      minLength: 1,
      description:
        "Browser-bridge platform slug (e.g. 'coderlegion', 'substack', 'linktree').",
    }),
    action: Type.String({
      minLength: 1,
      description:
        "Browser-bridge action (e.g. 'scan-comments', 'draft-post', 'status').",
    }),
    input: Type.Optional(
      Type.Object({}, { additionalProperties: true }) as unknown as ReturnType<
        typeof Type.Object
      >,
    ),
    mode: Type.Optional(
      Type.Union(
        [Type.Literal("execute-command"), Type.Literal("code-node")],
        {
          description:
            "Which n8n node shape to emit. 'code-node' (default) handles JSON I/O cleanly via spawnSync. 'execute-command' is a heredoc shell call — operator-friendly but no easy access to per-call inputs from upstream nodes.",
        },
      ),
    ),
    bridgeDir: Type.Optional(
      Type.String({
        description:
          "Absolute path to the browser-bridge checkout on the n8n host. Default '/home/user/.openclaw/workspace/pipeline/work/browser-bridge' to match docs/n8n-usage.md.",
      }),
    ),
    nodeName: Type.Optional(
      Type.String({
        description:
          "Override the generated node name. Default 'Browser Bridge: <platform> <action>'.",
      }),
    ),
    position: Type.Optional(
      Type.Tuple([Type.Number(), Type.Number()], {
        description: "n8n canvas position [x, y]. Default [0, 0].",
      }),
    ),
  },
  { additionalProperties: false },
);

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const DEFAULT_BRIDGE_DIR =
  "/home/user/.openclaw/workspace/pipeline/work/browser-bridge";

export function createScaffoldBrowserBridgeNodeTool() {
  return {
    name: "n8n_scaffold_browser_bridge_node",
    label: "n8n: scaffold browser-bridge node",
    description:
      "Generate a ready-to-paste n8n node JSON that calls the browser-bridge CLI for a given (platform, action, input). Mirrors the patterns in browser-bridge's docs/n8n-usage.md so n8n workflows don't need to rediscover the spawn/heredoc shape every time. Pure local generator — no n8n API call. Default mode 'code-node' uses spawnSync with stdin JSON; 'execute-command' uses an Execute Command node with a quoted heredoc.",
    parameters: Schema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const params = rawParams as {
        platform: string;
        action: string;
        input?: Record<string, unknown>;
        mode?: "execute-command" | "code-node";
        bridgeDir?: string;
        nodeName?: string;
        position?: [number, number];
      };

      const platform = params.platform.trim();
      const action = params.action.trim();
      if (!SLUG_RE.test(platform)) {
        throw new Error(
          `platform must be a kebab/alnum slug (got: ${JSON.stringify(platform)})`,
        );
      }
      if (!SLUG_RE.test(action)) {
        throw new Error(
          `action must be a kebab/alnum slug (got: ${JSON.stringify(action)})`,
        );
      }

      const mode = params.mode ?? "code-node";
      const bridgeDir = (params.bridgeDir ?? DEFAULT_BRIDGE_DIR).replace(
        /\/+$/,
        "",
      );
      const nodeName =
        params.nodeName ?? `Browser Bridge: ${platform} ${action}`;
      const position = params.position ?? [0, 0];
      const input = params.input ?? {};

      const node =
        mode === "execute-command"
          ? buildExecuteCommandNode({
              nodeName,
              position,
              bridgeDir,
              platform,
              action,
              input,
            })
          : buildCodeNode({
              nodeName,
              position,
              bridgeDir,
              platform,
              action,
              input,
            });

      const warnings: string[] = [];
      if (mode === "execute-command" && Object.keys(input).length > 0) {
        warnings.push(
          "Execute Command mode bakes the input JSON into the heredoc. To pass per-item upstream data, use mode='code-node' instead.",
        );
      }

      return jsonToolResult({
        platform,
        action,
        mode,
        nodeName,
        bridgeDir,
        node,
        pasteHint:
          "Copy `node` into n8n via the canvas's right-click 'Paste' (workflows.paste) - it accepts a single node object or {nodes:[...]}.",
        warnings,
      });
    },
  };
}

interface BuildArgs {
  nodeName: string;
  position: [number, number];
  bridgeDir: string;
  platform: string;
  action: string;
  input: Record<string, unknown>;
}

// Stable but unique-per-call id. n8n re-numbers on import so collisions only
// matter within one paste, but we still want determinism for snapshot tests.
function nodeId(args: BuildArgs): string {
  const slug = `${args.platform}-${args.action}`.toLowerCase().slice(0, 32);
  return `bb-${slug}`;
}

function buildExecuteCommandNode(args: BuildArgs): Record<string, unknown> {
  const heredocBody = JSON.stringify(args.input, null, 2);
  // Quoted heredoc tag ('JSON') — bash leaves the body untouched, so we don't
  // have to escape `$`, backticks, or quotes inside the JSON.
  const command =
    `cd ${args.bridgeDir}\n` +
    `node bin/browser-bridge.js ${args.platform} ${args.action} <<'JSON'\n` +
    `${heredocBody}\n` +
    `JSON\n`;

  return {
    parameters: { command },
    id: nodeId(args),
    name: args.nodeName,
    type: "n8n-nodes-base.executeCommand",
    typeVersion: 1,
    position: args.position,
  };
}

function buildCodeNode(args: BuildArgs): Record<string, unknown> {
  // Mirrors docs/n8n-usage.md "Code Node Wrapper". Input lives inside the
  // jsCode as a JSON literal; agents using this on real workflows can swap
  // in $json.* references after pasting.
  const inputLiteral = JSON.stringify(args.input, null, 2);
  const jsCode =
    `const { spawnSync } = require('node:child_process');\n` +
    `\n` +
    `const BRIDGE_DIR = ${JSON.stringify(args.bridgeDir)};\n` +
    `const PLATFORM = ${JSON.stringify(args.platform)};\n` +
    `const ACTION = ${JSON.stringify(args.action)};\n` +
    `\n` +
    `// Replace any field below with $json.* / $('Node').item.json.* to wire\n` +
    `// upstream data into the call.\n` +
    `const input = ${inputLiteral};\n` +
    `\n` +
    `const proc = spawnSync('node', ['bin/browser-bridge.js', PLATFORM, ACTION], {\n` +
    `  cwd: BRIDGE_DIR,\n` +
    `  input: \`\${JSON.stringify(input)}\\n\`,\n` +
    `  encoding: 'utf8',\n` +
    `  maxBuffer: 10 * 1024 * 1024,\n` +
    `});\n` +
    `\n` +
    `let payload;\n` +
    `try {\n` +
    `  payload = JSON.parse(proc.stdout);\n` +
    `} catch (err) {\n` +
    `  payload = {\n` +
    `    ok: false,\n` +
    `    platform: PLATFORM,\n` +
    `    action: ACTION,\n` +
    `    result: null,\n` +
    `    warnings: [],\n` +
    `    artifacts: [],\n` +
    `    error: {\n` +
    `      code: 'invalid_bridge_stdout',\n` +
    `      message: err.message,\n` +
    `      step: 'n8n-parse-stdout',\n` +
    `      retryable: false,\n` +
    `    },\n` +
    `  };\n` +
    `}\n` +
    `\n` +
    `return [{ json: { ...payload, exitCode: proc.status, stderr: (proc.stderr || '').trim() } }];\n`;

  return {
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode,
    },
    id: nodeId(args),
    name: args.nodeName,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: args.position,
  };
}
