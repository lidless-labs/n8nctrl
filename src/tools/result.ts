import { boundResult } from "@lidless-labs/effect-operator-kit";

/**
 * Repo-local success helper. Keeps the historical name, signature, and
 * required-`details` return type that tool call sites, the OpenClaw plugin entry,
 * and golden contracts depend on. `details` is repo-owned here: the kit no longer
 * emits its non-standard `details` field, and the MCP boundary only forwards
 * `content`.
 *
 * The text is 2-space JSON under the kit's UTF-8 byte cap, measured on the text
 * alone so a large `details` copy does not shrink the usable size. A result over
 * the cap is cut with the kit's `[truncated: ...]` marker, and `details` becomes
 * the kit's `{ truncated: true, originalBytes, returnedBytes, maxBytes }` flag
 * instead of the full payload.
 *
 * This repo does not yet route errors through kit `fail` / `refuseUnconfirmed`
 * or batch results through `partialFailure`; write tools still embed
 * `{ ok: false, ... }` inside success payloads via this helper.
 */
export function jsonToolResult<T>(details: T): {
  content: Array<{ type: "text"; text: string }>;
  details: T;
  structuredContent?: Record<string, unknown>;
} {
  const bounded = boundResult<{
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
  }>({
    content: [{ type: "text", text: JSON.stringify(details, null, 2) ?? "null" }],
  });
  if (bounded.structuredContent === undefined) {
    return { content: bounded.content, details };
  }
  return {
    content: bounded.content,
    details: bounded.structuredContent as T,
    structuredContent: bounded.structuredContent,
  };
}
