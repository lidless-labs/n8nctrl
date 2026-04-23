import { vi } from "vitest";

export interface CapturedCall {
  url: string;
  method: string;
  /** Header names are normalized to lowercase so assertions survive
   *  case-insensitive refactors (e.g. swapping to `new Headers(...)`). */
  headers: Record<string, string>;
  body: string | null;
}

export interface FakeResponse {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
  /** Throw this value instead of resolving a Response. Typed `unknown` so tests
   *  can verify non-Error rejections are still redacted. */
  rejectWith?: unknown;
  /** If true, the fake fetch returns a promise that resolves only once the
   *  AbortSignal fires, throwing an AbortError at that point. Used to exercise
   *  the client's timeout branch without leaking real timers. */
  hangUntilAbort?: boolean;
}

export interface FakeFetch {
  calls: CapturedCall[];
  queue(...responses: FakeResponse[]): void;
  restore(): void;
}

/**
 * Monkey-patch `globalThis.fetch` for a single test. Returns a handle to the
 * captured calls, a queue() setter for upcoming responses, and a restore()
 * that puts the original fetch back. The queue is FIFO; if empty, we return
 * an empty-text 200 so tests that forgot to queue still fail loudly in
 * assertions rather than hanging or silently returning {}.
 *
 * NOT safe under test.concurrent — process globals are shared across workers.
 */
export function makeFakeFetch(): FakeFetch {
  const calls: CapturedCall[] = [];
  const responses: FakeResponse[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = vi.fn(
    async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      const headers = flattenHeaders(init.headers);
      const body =
        init.body === undefined || init.body === null
          ? null
          : typeof init.body === "string"
            ? init.body
            : String(init.body);

      calls.push({
        url,
        method: (init.method ?? "GET").toUpperCase(),
        headers,
        body,
      });

      const next = responses.shift() ?? { status: 200, text: "" };

      if (next.hangUntilAbort) {
        const signal = init.signal as AbortSignal | undefined;
        if (!signal) {
          throw new Error("hangUntilAbort used without an AbortSignal");
        }
        return new Promise<Response>((_, reject) => {
          if (signal.aborted) {
            reject(abortError());
            return;
          }
          signal.addEventListener("abort", () => reject(abortError()), {
            once: true,
          });
        });
      }

      if (next.rejectWith !== undefined) throw next.rejectWith;

      const text =
        next.text !== undefined
          ? next.text
          : next.body === undefined
            ? ""
            : JSON.stringify(next.body);
      return new Response(text, {
        status: next.status ?? 200,
        headers: next.headers,
      });
    },
  ) as unknown as typeof fetch;

  return {
    calls,
    queue(...r) {
      responses.push(...r);
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function flattenHeaders(h: RequestInit["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[k.toLowerCase()] = v;
    return out;
  }
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}
