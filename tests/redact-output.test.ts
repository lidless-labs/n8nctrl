import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets, redactString } from "../src/tools/redact-output.ts";

describe("redactSecrets", () => {
  it("masks secret-bearing keys at any depth, including inside arrays", () => {
    const out = redactSecrets({
      message: "boom",
      headers: { Authorization: "Basic abc", "x-api-key": "k-123", accept: "json" },
      nodes: [{ accessToken: "t1", name: "n1" }, { client_secret: "s", ok: true }],
      cookie: "sid=1",
    });
    expect(out).toEqual({
      message: "boom",
      headers: { Authorization: REDACTED, "x-api-key": REDACTED, accept: "json" },
      nodes: [{ accessToken: REDACTED, name: "n1" }, { client_secret: REDACTED, ok: true }],
      cookie: REDACTED,
    });
  });

  it("masks token-shaped strings under innocuous keys", () => {
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTYifQ", "c2lnbmF0dXJlMTIz"].join(".");
    const out = redactSecrets({
      note: `call failed with Bearer abcdefghijkl1234 and ${jwt}`,
      other: "ghp_abcdefghijklmnopqrstuvwx",
    }) as Record<string, string>;
    expect(out.note).not.toContain("abcdefghijkl1234");
    expect(out.note).not.toContain(jwt);
    expect(out.other).toBe(REDACTED);
  });

  it("leaves ordinary values and primitives alone", () => {
    expect(redactSecrets({ a: 1, b: null, c: ["x"], d: true })).toEqual({
      a: 1,
      b: null,
      c: ["x"],
      d: true,
    });
    expect(redactString("plain text")).toBe("plain text");
  });

  it("does not mutate its input", () => {
    const input = { token: "keep-me", nested: { password: "p" } };
    redactSecrets(input);
    expect(input).toEqual({ token: "keep-me", nested: { password: "p" } });
  });

  it("stops at a depth limit instead of recursing forever", () => {
    let deep: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 200; i++) deep = { next: deep };
    expect(() => redactSecrets(deep)).not.toThrow();
  });
});
