import type { EngineStatus } from "../../types/status";
import { createError } from "../errors";
import { statusError } from "./payload";

/// Exhaustive over `EngineStatus` so a new member cannot fall through to a generic message.
export function closeFailure(status: EngineStatus): Error {
  switch (status) {
    case "backpressure":
      return createError("ERR_BACKPRESSURE", "ventiws: the outbound staging ring is full");
    case "invalid-handle":
      return createError("ERR_INVALID_HANDLE", "ventiws: the connection handle is stale");
    case "ok":
    case "closing":
    case "closed":
      return createError("ERR_INVALID_STATE", "ventiws: the connection is already closing");
    case "payload-too-large":
    case "invalid-close-code":
    case "invalid-close-reason":
    case "protocol-error":
      return statusError(status);
    case "policy-violation":
      return createError(
        "ERR_POLICY_VIOLATION",
        "ventiws: app-initiated close is not implemented on the engine route",
      );
  }
}
