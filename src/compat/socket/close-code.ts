import { isValidStatusCode } from "../../protocol/close-codes";
import { createError } from "../errors";

/// The close code to put on the wire, or `undefined` for "the caller did not say".
///
/// `undefined` is a real answer rather than a missing one. `ws` writes an *empty* close
/// payload when `close()` is called with no code (`sender.js`: `if (code ===
/// undefined) buf = EMPTY_BUFFER`), and a peer reads an empty close frame as 1005,
/// "no status received" (RFC 6455 section 7.1.5). Substituting 1000 claimed a normal
/// shutdown the caller never stated, and it made 1005 unobservable from a ventijs peer
/// in both directions.
///
/// A code that is not `undefined` is truncated toward zero first, then validated, which
/// is `ws`'s order: a fractional reserved code such as `1005.5` passes both validators
/// and truncates to 1005 on the wire, where the peer's own validation refuses it. The
/// divergence is recorded in `COMPATIBILITY.md`.
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
