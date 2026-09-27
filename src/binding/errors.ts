import type { CodedError, ErrorCode } from "../types/errors";

/// Native error names mapped to the stable public codes. The napi-zig bridge
/// throws `Error` with the Zig error name as the message, so the name is the
/// only discriminator the binding has.
const NATIVE_ERROR_CODES: Readonly<Record<string, ErrorCode>> = {
  UnknownServer: "ERR_INVALID_HANDLE",
  InvalidServerState: "ERR_INVALID_STATE",
  ServerNotClosed: "ERR_INVALID_STATE",
  EventsPending: "ERR_INVALID_STATE",
  EnvCleanupUnavailable: "ERR_INVALID_STATE",
  InvalidHost: "ERR_INVALID_OPTION",
  InvalidPort: "ERR_INVALID_OPTION",
  InvalidBacklog: "ERR_INVALID_OPTION",
  InvalidPath: "ERR_INVALID_OPTION",
  InvalidConnectionCapacity: "ERR_INVALID_OPTION",
  InvalidMessageCapacity: "ERR_INVALID_OPTION",
  InvalidFrameCapacity: "ERR_INVALID_OPTION",
  ThreadsafeFunctionUnavailable: "ERR_PROTOCOL",
  // Resource and environment failures the engine wrappers can surface; these
  // are states of the host, not ABI mismatches.
  CapacityExhausted: "ERR_INVALID_STATE",
  ServerCapacityExhausted: "ERR_INVALID_STATE",
  EngineWorkerMissing: "ERR_INVALID_STATE",
  AddressInUse: "ERR_INVALID_STATE",
  SystemResources: "ERR_INVALID_STATE",
  ThreadQuotaExceeded: "ERR_INVALID_STATE",
  OutOfMemory: "ERR_INVALID_STATE",
};

/// Wraps a native addon failure in a coded `Error`. The native name stays the
/// message so existing diagnostics keep working; an unknown name is an ABI
/// mismatch and reports `ERR_PROTOCOL`.
export function nativeError(error: unknown): CodedError {
  const name = error instanceof Error ? error.message : String(error);
  const code = NATIVE_ERROR_CODES[name] ?? "ERR_PROTOCOL";
  return Object.assign(new Error(name), { code });
}

/// A guard failure: a value the caller passed that the binding refuses before
/// any native call is made.
///
/// Coded like every other error in the repository. These are the checks that keep
/// a bad value away from the ABI, and an uncoded `RangeError` here is the one
/// error shape a consumer sees that carries no stable code, which is exactly the
/// thing the error policy exists to prevent.
export function guardError(
  message: string,
  constructor: ErrorConstructor = RangeError,
  code: ErrorCode = "ERR_INVALID_HANDLE",
): CodedError {
  return Object.assign(new constructor(message), { code });
}

/// Runs a native call, converting a native failure into a coded `Error`.
export function callNative<T>(call: () => T): T {
  try {
    return call();
  } catch (error) {
    throw nativeError(error);
  }
}
