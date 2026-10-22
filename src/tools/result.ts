/**
 * Repo-local success helper. Keeps the historical name, signature, and
 * required-`details` return type that tool call sites, the OpenClaw plugin entry,
 * and golden contracts depend on. `details` is repo-owned here: the kit no longer
 * emits its non-standard `details` field, and the MCP boundary only forwards
 * `content`.
 *
 * The text is 2-space JSON and is not capped here. The MCP boundary in
 * `mcp-server.ts` redacts it first and then applies the kit's UTF-8 byte cap, so a
 * secret cannot be cut in half by the cap and slip past redaction.
 *
 * This repo does not yet route errors through kit `fail` / `refuseUnconfirmed`
 * or batch results through `partialFailure`; write tools still embed
 * `{ ok: false, ... }` inside success payloads via this helper.
 */
export function jsonToolResult<T>(details: T): {
  content: Array<{ type: "text"; text: string }>;
  details: T;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(details, null, 2) ?? "null" }],
    details,
  };
}
