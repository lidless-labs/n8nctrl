/**
 * Byte-budget helpers for upstream HTTP responses. The budget is enforced
 * while the body streams in, and a declared `Content-Length` over the budget
 * is rejected before any body is read.
 */

export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export class ResponseTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`response exceeded the ${maxBytes} byte limit`);
    this.name = "ResponseTooLargeError";
  }
}

function declaredLength(res: Response): number | undefined {
  const raw = res.headers.get("content-length");
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function limitStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let seen = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      seen += value.byteLength;
      if (seen > maxBytes) {
        await reader.cancel().catch(() => undefined);
        controller.error(new ResponseTooLargeError(maxBytes));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * Return a response whose body errors with `ResponseTooLargeError` once more
 * than `maxBytes` have been read. Throws immediately when `Content-Length`
 * already exceeds the budget.
 */
export async function boundResponse(
  res: Response,
  maxBytes: number,
): Promise<Response> {
  const declared = declaredLength(res);
  if (declared !== undefined && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(maxBytes);
  }
  if (!res.body) return res;
  return new Response(limitStream(res.body, maxBytes), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

export async function readTextBounded(
  res: Response,
  maxBytes: number,
): Promise<string> {
  return (await boundResponse(res, maxBytes)).text();
}
