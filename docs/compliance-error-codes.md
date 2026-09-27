# ws error codes and environment variables

The vendored reference at [ventijs.md](ventijs.md) documents twelve `WS_ERR_*`
codes and two environment variables. This file records whether each can occur in
ventijs, and why. The status vocabulary is defined in
[compliance.md](compliance.md).

## Why none of the twelve is reachable

`ws` emits every `WS_ERR_*` code from its JavaScript frame receiver, the module that
reads bytes off the socket and decodes frames. ventijs has no such receiver, and that is
the architecture rather than a missing feature: frames are parsed in Zig, by the codec in
`src/engine/codec/`, and the condition each code names is answered with a close frame
instead of a thrown error.

`src/compat/socket/attach.ts` now hands the adopted `Duplex` to that codec, so frames
_are_ read on the upgrade route; the conclusion still holds for a different reason, and
the previous version of this file recorded the earlier one. A refusal ends the connection
with the close code RFC 6455 section 7.4.1 assigns the condition, and the observable
surface is that code and its reason.

Every code below is therefore `unreachable`. The note gives the code a peer observes
instead, so the row is useful rather than merely negative.

## `WS_ERR_*` codes

| Code                                     | Condition in `ws`                      | ventijs                                                                                                                                         | Status        |
| ---------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `WS_ERR_EXPECTED_FIN`                    | FIN unset where a final frame was due  | Zig codec; the peer sees `1002`                                                                                                                 | `unreachable` |
| `WS_ERR_EXPECTED_MASK`                   | Unmasked frame sent to a server        | Zig codec; the peer sees `1002`                                                                                                                 | `unreachable` |
| `WS_ERR_INVALID_CLOSE_CODE`              | Close frame with an invalid close code | Zig codec; the peer sees `1002`                                                                                                                 | `unreachable` |
| `WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH`  | Control frame above 125 bytes          | Zig codec; the peer sees `1002`                                                                                                                 | `unreachable` |
| `WS_ERR_INVALID_OPCODE`                  | Reserved or unknown opcode             | Zig codec; the peer sees `1002`                                                                                                                 | `unreachable` |
| `WS_ERR_INVALID_UTF8`                    | Invalid UTF-8 in a text or close frame | Zig codec; the peer sees `1007`                                                                                                                 | `unreachable` |
| `WS_ERR_UNEXPECTED_MASK`                 | Masked frame sent to a client          | No client exists, so the condition cannot arise                                                                                                 | `unreachable` |
| `WS_ERR_UNEXPECTED_RSV_1`                | RSV1 set with no negotiated extension  | Zig codec; the peer sees `1002`                                                                                                                 | `unreachable` |
| `WS_ERR_UNEXPECTED_RSV_2_3`              | RSV2 or RSV3 set                       | Zig codec; the peer sees `1002`                                                                                                                 | `unreachable` |
| `WS_ERR_TOO_MANY_BUFFERED_PARTS`         | Buffered chunk or fragment count limit | Neither route reassembles fragments, and the outbound bound is a byte-bounded ring rather than a chunk count; `maxFragments` is not implemented | `unreachable` |
| `WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH` | Frame length above 2^53 - 1            | The engine's compiled 32 KiB message cap rejects the frame first, with `1009`                                                                   | `unreachable` |
| `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`      | Message above `maxPayload`             | The codec's compiled 32 KiB cap closes with `1009`. `maxPayload` is normalised and reported at its `ws` value but not read                      | `unreachable` |

## Errors ventijs does raise

ventijs uses its own `ERR_*` codes, declared in `src/types/errors.ts` and
produced by `src/compat/errors.ts`. Every thrown error carries a stable string
code, which is an additive divergence from `ws` and is recorded in
[COMPATIBILITY.md](../COMPATIBILITY.md). The codes reachable from the facade are
`ERR_INVALID_OPTION`, `ERR_INVALID_STATE`, `ERR_SOCKET_NOT_OPEN`,
`ERR_SOCKET_CLOSED`, `ERR_INVALID_HANDLE`, `ERR_BACKPRESSURE`,
`ERR_INVALID_CLOSE_CODE`, `ERR_INVALID_CLOSE_REASON`, `ERR_MAX_PAYLOAD`, and
`ERR_PROTOCOL`. `ERR_MAX_PAYLOAD` is the one the engine reports: staging a frame
larger than `max_frame_bytes` returns the `payload_too_large` status, which
becomes `ERR_MAX_PAYLOAD` on the send callback.

`ERR_POLICY_VIOLATION` is declared and mapped from the engine's
`policy_violation` status, but nothing in `src/engine/` returns that status, so
the code is unreachable today.

Two reachability facts this file previously recorded as engine-only are now
also true of the codec route, because the codec route is the one a caller
reaches: `ERR_MAX_PAYLOAD` is reported through a send callback when a frame is
larger than the compiled `max_frame_bytes`, and an inbound message above the
compiled `message_capacity` closes with `1009`. Those two report different codes
for the same condition, which is a divergence a caller keying on the code should
know about; `COMPATIBILITY.md` records it.

## Environment variables

| Variable               | Effect in `ws`                                         | ventijs                                                        | Status     |
| ---------------------- | ------------------------------------------------------ | -------------------------------------------------------------- | ---------- |
| `WS_NO_BUFFER_UTIL`    | Suppresses the optional `bufferutil` native module     | No such module is compiled in, so there is nothing to suppress | `deferred` |
| `WS_NO_UTF_8_VALIDATE` | Suppresses the optional `utf-8-validate` native module | No such module is compiled in; the engine parses in Zig        | `deferred` |

Both are `ws` implementation details for its optional native acceleration, and
neither is part of the API surface. They become `unreachable` rather than
`deferred` if the engine never gains those optional modules; the prerequisite
for keeping the `deferred` label is a native acceleration module appearing in a
published build.
