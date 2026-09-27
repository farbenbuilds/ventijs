# ws surface compliance map

The upstream `ws` API reference is vendored at [ventijs.md](ventijs.md). This directory maps each item in that reference to the
ventijs module that implements it and to its status. It answers one question,
"What does ventijs actually implement", which the vendored reference
deliberately does not answer.

The pinned contract is `ws` 8.21.3 with `@types/ws` 8.18.1. Both are
devDependencies, so the conformance suite can run the two implementations side
by side. The public type surface is the vendored declaration file
`src/types/ws.d.ts`.

| Document                                                    | Question it answers                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| [COMPATIBILITY.md](../COMPATIBILITY.md)                     | Which behaviour is verified, and by which test?             |
| [docs/compliance-api.md](compliance-api.md)                 | Which module implements each `ws` API item?                 |
| [docs/compliance-error-codes.md](compliance-error-codes.md) | Which `WS_ERR_*` codes and environment variables can occur? |
| [docs/ventijs.md](ventijs.md)                               | What does `ws` do? The contract, not a feature list.        |

## Status vocabulary

The first four values are the ones
[COMPATIBILITY.md](../COMPATIBILITY.md) uses, with the same meaning. The fifth
is added here because a dozen vendored items have no ventijs counterpart by
construction, and calling them `todo` would imply a plan that does not exist.

| Status        | Meaning                                                                         |
| ------------- | ------------------------------------------------------------------------------- |
| `done`        | Implemented and covered by a passing evidence test                              |
| `partial`     | Exists in a limited form; the row names what is missing                         |
| `todo`        | Planned, not implemented                                                        |
| `deferred`    | Out of scope until the named prerequisite lands                                 |
| `unreachable` | No counterpart by construction; the row states the architecture that removes it |

## Rules for these tables

- A row is only `done` when its evidence test exists and passes. A test that is
  written but failing is not evidence.
- Every status is traceable to a module under `src/` and, where one exists, to a
  test under `tests/`. A row with neither is a claim, not a status.
- A row whose behaviour diverges from `ws` says so in the note and names the
  file that records the divergence.
- `partial` is not a polite word for `todo`. It means the surface exists, a
  caller can reach it, and something observable is missing. The note says what.

## Updating these tables

Update the affected row in the same change that moves the status.

`message` and `send` moved together, and they are worth naming because they are
the pair that decides whether a ventijs socket can echo at all. They are now
implemented on the engine route, where `src/engine/server/connections.zig` takes
the parsed payload and `src/engine/ffi/socket_pump.zig` moves staged replies onto
the wire. They are still `todo` on the facade's HTTP upgrade route, which adopts
a raw Node stream and does no framing, and the facade is what these tables
describe. A status here is a statement about a route, not about the product.
