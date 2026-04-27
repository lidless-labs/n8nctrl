import { describe, it, expect } from "vitest";
import { createScaffoldBrowserBridgeNodeTool } from "../src/tools/scaffold-browser-bridge-node.ts";

async function run(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tool = createScaffoldBrowserBridgeNodeTool();
  const res = (await tool.execute("call-1", params)) as {
    details: Record<string, unknown>;
  };
  return res.details;
}

describe("n8n_scaffold_browser_bridge_node", () => {
  it("uses an OpenAI-compatible fixed-length array schema for position", () => {
    const tool = createScaffoldBrowserBridgeNodeTool();
    const positionSchema = (
      tool.parameters as {
        properties: { position: { items: unknown; minItems: number; maxItems: number } };
      }
    ).properties.position;

    expect(Array.isArray(positionSchema.items)).toBe(false);
    expect(positionSchema.items).toMatchObject({ type: "number" });
    expect(positionSchema.minItems).toBe(2);
    expect(positionSchema.maxItems).toBe(2);
  });

  it("emits a code-node by default with spawnSync wrapping the requested platform/action", async () => {
    const details = await run({
      platform: "coderlegion",
      action: "scan-comments",
      input: { limit: 5 },
    });

    expect(details.mode).toBe("code-node");
    const node = details.node as Record<string, unknown>;
    expect(node.type).toBe("n8n-nodes-base.code");
    expect(node.typeVersion).toBe(2);
    expect(node.name).toBe("Browser Bridge: coderlegion scan-comments");

    const params = node.parameters as { jsCode: string; language: string };
    expect(params.language).toBe("javaScript");
    expect(params.jsCode).toContain("spawnSync");
    // PLATFORM/ACTION are JSON.stringify'd, so they land in double quotes.
    expect(params.jsCode).toContain('"coderlegion"');
    expect(params.jsCode).toContain('"scan-comments"');
    expect(params.jsCode).toContain('"limit": 5');
    // Should NOT include positional shell args — that's the execute-command shape.
    expect(params.jsCode).not.toContain("<<'JSON'");
  });

  it("emits an Execute Command node with a quoted heredoc when mode='execute-command'", async () => {
    const details = await run({
      platform: "substack",
      action: "draft-post",
      input: { title: "Hello" },
      mode: "execute-command",
    });

    expect(details.mode).toBe("execute-command");
    const node = details.node as Record<string, unknown>;
    expect(node.type).toBe("n8n-nodes-base.executeCommand");
    expect(node.typeVersion).toBe(1);

    const command = (node.parameters as { command: string }).command;
    expect(command).toContain("node bin/browser-bridge.js substack draft-post <<'JSON'");
    expect(command).toContain('"title": "Hello"');
    expect(command).toMatch(/JSON\s*$/);
  });

  it("warns when execute-command mode is used with non-empty input", async () => {
    const details = await run({
      platform: "linktree",
      action: "scan-links",
      mode: "execute-command",
      input: { limit: 50 },
    });

    const warnings = details.warnings as string[];
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/per-item upstream data/);
  });

  it("does not warn when execute-command mode is used with empty input", async () => {
    const details = await run({
      platform: "linktree",
      action: "status",
      mode: "execute-command",
    });
    expect(details.warnings).toEqual([]);
  });

  it("rejects non-slug platform/action values to keep them safe to interpolate into shell commands", async () => {
    const tool = createScaffoldBrowserBridgeNodeTool();
    await expect(
      tool.execute("call-1", { platform: "co; rm -rf /", action: "status" }),
    ).rejects.toThrow(/platform must be a kebab/);
    await expect(
      tool.execute("call-1", { platform: "coderlegion", action: "react`pwn`" }),
    ).rejects.toThrow(/action must be a kebab/);
  });

  it("allows overriding bridgeDir, nodeName, and position", async () => {
    const details = await run({
      platform: "coderlegion",
      action: "status",
      bridgeDir: "/srv/bridge/",
      nodeName: "Custom Name",
      position: [400, 200],
    });

    const node = details.node as Record<string, unknown>;
    expect(node.name).toBe("Custom Name");
    expect(node.position).toEqual([400, 200]);
    // Trailing slash on bridgeDir is normalized away.
    const jsCode = (node.parameters as { jsCode: string }).jsCode;
    expect(jsCode).toContain('"/srv/bridge"');
    expect(jsCode).not.toContain('"/srv/bridge/"');
  });

  it("defaults input to {} so the emitted code is still valid JSON", async () => {
    const details = await run({
      platform: "coderlegion",
      action: "status",
    });
    const jsCode = (details.node as { parameters: { jsCode: string } })
      .parameters.jsCode;
    expect(jsCode).toContain("const input = {}");
  });

  it("makes no n8n API calls — pure local generator", async () => {
    // No client passed in. If the tool ever started reaching for one,
    // creating the tool factory without a client would have to be
    // re-thought; this test pins down the contract.
    const tool = createScaffoldBrowserBridgeNodeTool();
    const res = await tool.execute("call-1", {
      platform: "coderlegion",
      action: "status",
    });
    expect(res).toBeDefined();
  });
});
