import { ok } from "@lidless-labs/effect-operator-kit";

/**
 * Repo-local success helper. Delegates to effect-operator-kit `ok` while
 * keeping the historical name, signature, and required-`details` return type
 * that tool call sites and golden contracts depend on.
 *
 * This repo does not yet route errors through kit `fail` / `refuseUnconfirmed`
 * or batch results through `partialFailure`; write tools still embed
 * `{ ok: false, ... }` inside success payloads via this helper.
 */
export function jsonToolResult<T>(details: T): {
  content: Array<{ type: "text"; text: string }>;
  details: T;
} {
  // kit `ok` always sets `details`; cast preserves this repo's required-details contract
  // (kit's McpTextResult marks details optional for fail paths that omit it).
  return ok(details) as {
    content: Array<{ type: "text"; text: string }>;
    details: T;
  };
}
