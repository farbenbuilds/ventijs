import type { EngineStatus } from "../../types/status";
import { createError } from "../errors";
import { statusError } from "./payload";

/// Maps a rejected native close onto a coded error instead of leaving the
/// socket latched in CLOSING with no frame sent. Exhaustive over `EngineStatus`
/// so a new member cannot fall through to a generic message.
export function closeFailure(status: EngineStatus): Error {
  switch (status) {
    case "backpressure":
      return createError("ERR_BACKPRESSURE", "ventijs: the outbound staging ring is full");
    case "invalid-handle":
      return createError("ERR_INVALID_HANDLE", "ventijs: the connection handle is stale");
    case "ok":
    case "closing":
    case "closed":
      return createError("ERR_INVALID_STATE", "ventijs: the connection is already closing");
    case "payload-too-large":
    case "invalid-close-code":
    case "invalid-close-reason":
    case "protocol-error":
    case "policy-violation":
      return statusError(status);
  }
}
