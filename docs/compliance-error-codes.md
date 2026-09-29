# ws error codes and environment variables

The vendored reference at [ventiws.md](ventiws.md) documents twelve `WS_ERR_*` codes
and two environment variables. This file records whether each can occur in ventiws,
and why. The status vocabulary is defined in [compliance.md](compliance.md).

## Where the codes come from

`ws` emits every `WS_ERR_*` code from its JavaScript frame receiver, the module that
reads bytes off the socket and decodes frames. ventiws decodes frames in Zig, by the
codec in `src/engine/codec/`, and that codec runs on the Node `Duplex` the upgrade
route adopts (`src/compat/socket/attach.ts` hands the transport to
`src/compat/socket/codec-inbound.ts`). The classification the parser already made
crosses the boundary as an ordinal in `CodecFailureName` and becomes
`error.code` through `src/compat/socket/refusal-table.ts`, so a refused frame is
`ws`-shaped to the application and RFC-shaped to the peer.

All twelve are `done`. The close code and the close reason are RFC 6455 section 7.4.1
and cannot change; the `error.code`, the constructor, and the message are `ws`'s, and
are pinned by `tests/compat/socket/refusal-codes.test.ts` and
`tests/compat/socket/refusal-payload-codes.test.ts`.

## `WS_ERR_*` codes

The code in the first column is also the `error.code` on the socket's `error` event.

| Code                                     | Condition                                                                                  | Close code | Constructor  | Status |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | ---------- | ------------ | ------ |
| `WS_ERR_EXPECTED_FIN`                    | Control frame with FIN clear                                                               | 1002       | `RangeError` | `done` |
| `WS_ERR_EXPECTED_MASK`                   | Unmasked frame to a server                                                                 | 1002       | `RangeError` | `done` |
| `WS_ERR_UNEXPECTED_MASK`                 | Masked frame to a client                                                                   | 1002       | `RangeError` | `done` |
| `WS_ERR_INVALID_OPCODE`                  | Reserved opcode, a continuation with no message open, a new data frame inside one          | 1002       | `RangeError` | `done` |
| `WS_ERR_INVALID_CLOSE_CODE`              | Close code RFC 6455 section 7.4 does not permit on the wire (1005, 1006, 1015, 1016, 2999) | 1002       | `RangeError` | `done` |
| `WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH`  | Control frame over 125 bytes, or a one-byte close payload                                  | 1002       | `RangeError` | `done` |
| `WS_ERR_UNEXPECTED_RSV_1`                | RSV1 set with no negotiated extension, or on a control frame                               | 1002       | `RangeError` | `done` |
| `WS_ERR_UNEXPECTED_RSV_2_3`              | RSV2 or RSV3 set                                                                           | 1002       | `RangeError` | `done` |
| `WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH` | Declared 64-bit length above 2^53 - 1                                                      | 1009       | `RangeError` | `done` |
| `WS_ERR_INVALID_UTF8`                    | Invalid UTF-8 in a text message or a close reason                                          | 1007       | `Error`      | `done` |
| `WS_ERR_TOO_MANY_BUFFERED_PARTS`         | More fragments in one message than `maxFragments` allows                                   | 1008       | `RangeError` | `done` |
| `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`      | A message over `maxPayload`                                                                | 1009       | `RangeError` | `done` |

`ws`'s message is `Invalid WebSocket frame: ` plus its own detail for every framing
fault, and a bare message for the two count limits, `Too many message fragments` and
`Too many buffered chunks`. ventiws reports the first of those on both paths; see the
paragraph on `WS_ERR_TOO_MANY_BUFFERED_PARTS` below.

Three messages are `ws`'s in wording but not in full. `ws` interpolates the offending
number into `WS_ERR_INVALID_CLOSE_CODE`, `WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH`, and
`WS_ERR_INVALID_OPCODE`, and the codec reports the fault rather than the number, so
those three read without it. A `WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH` message is
`ws`'s exactly, but it is the one fault `ws` prefixes with `Unsupported WebSocket
frame: ` rather than `Invalid WebSocket frame: `, because the length is a number the
frame could not have meant.

`ERR_INVALID_COMPRESSED_DATA` is a code ventiws adds for a payload that is not a
DEFLATE stream, which `ws` reports as a bare `zlib` error with no code. The close code
is 1007 either way; the addition is what keeps a broken compressed stream from reading
as `WS_ERR_INVALID_UTF8`, which a caller would act on by checking text.

`WS_ERR_TOO_MANY_BUFFERED_PARTS` covers two conditions in `ws`, and both are reachable
here. `maxFragments` is enforced per connection and reports the code. `maxBufferedChunks`
bounds the receiver's queue of un-decoded socket reads, which in `ws` is
`Receiver._buffers` (`node_modules/ws/lib/receiver.js:100`) and here is
`state.pendingInput`; a read arriving while an `allowSynchronousEvents: false` delivery
is deferred is queued rather than dropped, and the bound is checked at
`src/compat/socket/codec-inbound.ts:41` against `ws`'s 262144 default, which
`src/compat/server/server.ts:47` also echoes on `server.options` so
`Object.keys(server.options)` matches.
`tests/compat/socket/inbound-queue.test.ts` covers that path.

The two differ in one observable way, which is a divergence and not a gap: `ws` gives the
two a message each, `Too many buffered chunks` and `Too many message fragments`
(`node_modules/ws/lib/receiver.js:106` and `:507`), while `REFUSALS` has one
`tooManyBufferedParts` entry for both (`src/compat/socket/refusal-table.ts:72`), so the
`maxBufferedChunks` path reports `Too many message fragments`. The `error.code`, the
`RangeError`, and the 1008 are `ws`'s on both paths; a caller keying on the code is
unaffected and a caller matching on the message is not.

`ERR_PROTOCOL` is the one ventiws keeps for a fault it has no more specific name for:
a non-minimal length field, and anything else the parser cannot attribute. It is a
1002 and a `RangeError`, and `ws` names none of these.

## Errors ventiws adds

`ws` leaves many thrown errors uncoded. ventiws adds a stable string `code` to every
error it raises, declared in `src/types/errors.ts` and produced by
`src/compat/errors.ts`. `ERR_INVALID_OPTION`, `ERR_INVALID_STATE`,
`ERR_INVALID_HANDLE`, `ERR_SOCKET_NOT_OPEN`, `ERR_SOCKET_CLOSED`,
`ERR_INVALID_CLOSE_CODE`, `ERR_INVALID_CLOSE_REASON`, `ERR_MAX_PAYLOAD`,
`ERR_BACKPRESSURE`, `ERR_POLICY_VIOLATION`, and `ERR_PROTOCOL` each answer a
condition `ws` reports some other way, so the addition is additive.

Two of them exist because there is no peer to tell. `ERR_MAX_PAYLOAD` is reported on
a local `send` the codec refuses, through the send callback or an `error` event, and
the socket stays open (`tests/compat/socket/max-payload-options.test.ts`); the
receive path for the same limit reports `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`, because
there the peer is the one being answered. `ERR_POLICY_VIOLATION` comes from the
engine's `policy_violation` status, which `src/engine/ffi/socket_pump.zig:41` returns
when a staged control record cannot cross the engine's publish topic, mapped through
`src/binding/socket.ts:23` and `src/compat/errors.ts:11`.

## Environment variables

| Variable               | Effect in `ws`                                               | ventiws                                         | Status        |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------------- | ------------- |
| `WS_NO_BUFFER_UTIL`    | Guards `require("bufferutil")` in `ws/lib/buffer-util.js`    | Masking is `zslay.frame.mask` in the codec      | `unreachable` |
| `WS_NO_UTF_8_VALIDATE` | Guards `require("utf-8-validate")` in `ws/lib/validation.js` | UTF-8 validation is `src/engine/codec/utf8.zig` | `unreachable` |

Both guard an optional native acceleration module, and ventiws compiles no such
module. A `bufferutil`-shaped escape hatch would be a second, unaccelerated route to
the same answer, which is the opposite of the design, so both are `unreachable` by
construction rather than waiting on a prerequisite.
