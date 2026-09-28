/// The codes ventijs puts on a thrown or emitted error.
///
/// The `ERR_*` half is ventijs's own, for the conditions `ws` reports by throwing a bare
/// `Error` or a `TypeError`: a bad option, a socket used in a state it is not in. The
/// `WS_ERR_*` half is `ws`'s, for the conditions it reports on the socket's `error` event
/// after refusing a frame, and they carry `ws`'s own strings so an application written
/// against `ws` reads the same code it always did.
export type WsErrorCode =
  | "WS_ERR_EXPECTED_FIN"
  | "WS_ERR_EXPECTED_MASK"
  | "WS_ERR_INVALID_CLOSE_CODE"
  | "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
  | "WS_ERR_INVALID_OPCODE"
  | "WS_ERR_INVALID_UTF8"
  | "WS_ERR_UNEXPECTED_MASK"
  | "WS_ERR_UNEXPECTED_RSV_1"
  | "WS_ERR_UNEXPECTED_RSV_2_3"
  | "WS_ERR_TOO_MANY_BUFFERED_PARTS"
  | "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
  | "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";

export type VentijsErrorCode =
  | "ERR_INVALID_OPTION"
  | "ERR_INVALID_CLOSE_CODE"
  | "ERR_INVALID_CLOSE_REASON"
  | "ERR_SOCKET_NOT_OPEN"
  | "ERR_SOCKET_CLOSED"
  | "ERR_INVALID_STATE"
  | "ERR_INVALID_HANDLE"
  | "ERR_MAX_PAYLOAD"
  | "ERR_BACKPRESSURE"
  | "ERR_PROTOCOL"
  | "ERR_POLICY_VIOLATION";

export type ErrorCode = WsErrorCode | VentijsErrorCode;

export type CodedError = Error & { readonly code: ErrorCode };
