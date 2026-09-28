import type { CodecFailureName } from "../../binding/codec";
import type { ErrorCode, WsErrorCode } from "../../types/errors";

/// One refused frame, as the peer and the application each hear about it. The close
/// code is the RFC's, so it cannot change. The rest is `ws`'s: the same `WS_ERR_*`
/// string on `error.code`, the same `RangeError` (or `Error` for the two payload faults
/// `ws` does not range-check), and the same message. A migrating caller keys on that.
export type Refusal = {
  readonly closeCode: number;
  readonly code: ErrorCode;
  readonly reason: string;
  readonly message: string;
  readonly ctor: ErrorConstructor;
};

/// `ws`'s reasons, which is also what a close frame's payload reads on the wire and on
/// the socket's own `close` event. Every one is a close reason, so none can be longer
/// than the 123 bytes RFC 6455 section 5.5 allows.
export const REFUSALS: Record<CodecFailureName, Refusal> = {
  expectedFin: refused(1002, "WS_ERR_EXPECTED_FIN", "protocol error", "FIN must be set"),
  expectedMask: refused(1002, "WS_ERR_EXPECTED_MASK", "protocol error", "MASK must be set"),
  invalidCloseCode: refused(
    1002,
    "WS_ERR_INVALID_CLOSE_CODE",
    "protocol error",
    "invalid status code",
  ),
  invalidControlPayloadLength: refused(
    1002,
    "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH",
    "protocol error",
    "invalid payload length",
  ),
  invalidOpcode: refused(1002, "WS_ERR_INVALID_OPCODE", "protocol error", "invalid opcode"),
  unexpectedMask: refused(1002, "WS_ERR_UNEXPECTED_MASK", "protocol error", "MASK must be clear"),
  unexpectedRsv1: refused(1002, "WS_ERR_UNEXPECTED_RSV_1", "protocol error", "RSV1 must be clear"),
  unexpectedRsv2or3: refused(
    1002,
    "WS_ERR_UNEXPECTED_RSV_2_3",
    "protocol error",
    "RSV2 and RSV3 must be clear",
  ),
  unsupportedDataPayloadLength: refused(
    1002,
    "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH",
    "protocol error",
    "payload length > 2^53 - 1",
  ),
  // A plain `Error`, not a `RangeError`: `ws` raises these two the same way, and both
  // are a 1007.
  invalidUtf8: {
    closeCode: 1007,
    code: "WS_ERR_INVALID_UTF8",
    reason: "invalid payload",
    message: "Invalid WebSocket frame: invalid UTF-8 sequence",
    ctor: Error,
  },
  invalidCompressedData: {
    closeCode: 1007,
    code: "WS_ERR_INVALID_UTF8",
    reason: "invalid payload",
    message: "Invalid WebSocket frame: invalid UTF-8 sequence",
    ctor: Error,
  },
  tooManyBufferedParts: {
    closeCode: 1008,
    code: "WS_ERR_TOO_MANY_BUFFERED_PARTS",
    reason: "too many message fragments",
    message: "Too many message fragments",
    ctor: RangeError,
  },
  unsupportedMessageLength: {
    closeCode: 1009,
    code: "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH",
    reason: "message too big",
    message: "Max payload size exceeded",
    ctor: RangeError,
  },
  // The one fault with no `ws` equivalent: a compressed payload that is not a DEFLATE
  // stream, which `ws` reports as a 1007 with no code. It keeps the protocol error it
  // always was, because none of the twelve describes it.
  protocolError: {
    closeCode: 1002,
    code: "ERR_PROTOCOL",
    reason: "protocol error",
    message: "Invalid WebSocket frame",
    ctor: RangeError,
  },
};

/// Every framing fault `ws` raises is a `RangeError` except the two payload faults.
function refused(closeCode: number, code: WsErrorCode, reason: string, detail: string): Refusal {
  return {
    closeCode,
    code,
    reason,
    message: `Invalid WebSocket frame: ${detail}`,
    ctor: RangeError,
  };
}
