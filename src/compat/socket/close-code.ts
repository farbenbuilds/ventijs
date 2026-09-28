import { isValidStatusCode } from "../../protocol/close-codes";
import { createError } from "../errors";

/// `undefined` is a real answer, not a missing one. `ws` writes an *empty* close payload
/// when `close()` takes no code (`sender.js`: `if (code === undefined) buf =
/// EMPTY_BUFFER`), and a peer reads that as 1005, "no status received" (RFC 6455 section
/// 7.1.5). Substituting 1000 claimed a shutdown the caller never stated and made 1005
/// unobservable in both directions.

// A code is truncated toward zero, then validated, which is `ws`'s order: a fractional
// reserved code such as `1005.5` passes both validators and truncates to 1005 on the
// wire, where the peer's own validation refuses it. See `COMPATIBILITY.md`.
export function closeCodeOf(code: unknown): number | undefined {
  if (code === undefined) return undefined;
  return Math.trunc(assertCloseCode(code));
}

function assertCloseCode(code: unknown): number {
  if (typeof code !== "number" || !isValidStatusCode(code)) {
    throw createError(
      "ERR_INVALID_CLOSE_CODE",
      "First argument must be a valid error code number",
      TypeError,
    );
  }
  return code;
}
