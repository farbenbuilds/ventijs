# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Conventional Commits](.github/COMMIT_CONVENTION.md), so the commit subjects are the
same information in a form `git log` can filter.

## [Unreleased]

### Changed

- **The package is now `ventiws`.** The name, the repository and issue URLs, the vendored
  API reference at `docs/ventiws.md`, the `ventiws.node` addon artifact, and the branded
  strings in the error messages, symbol descriptions and harness identifiers all follow.
  Nothing was published under the old name, so there is no published version to redirect.
  `build.zig.zon` takes the fingerprint Zig derives from the new package name, which is
  what makes the Zig package a different identity from the one it was.

## [1.0.0-alpha] - 2026-09-29

The first versioned line. `ws` 8.21.3 and `@types/ws` 8.18.1 are the compatibility
contract, and `docs/migrating.md` is the short version of where that contract holds and
where it does not.

Nothing is published to npm yet: the package ships one platform's compiled addon, so a
`pnpm install` builds it. See the README.

### Fixed

The seven entries below were all reported by a tracker row marked `done` while the
behaviour it described was broken. Each is measured against a live `ws` peer, and each
came with the test that could not have passed before.

- **`allowSynchronousEvents: false` lost messages.** A read arriving while a deferred
  delivery held earlier bytes was discarded outright, with no `error`, no `close` and no
  counter. Twelve messages at one write each delivered three. The pause now keeps a
  bounded queue of un-decoded reads, which is the queue `ws` keeps, and the resume drains
  it in the order the peer sent them. Measured at 0, 1, 5 and 20 ms intervals on the
  server and the client route, 12/12 on both implementations.
- **`maxBufferedChunks` is enforced.** It was reported on `server.options` and read by
  nobody, and the tracker called it `unreachable` on the reasoning that a single
  retained read was already far below `ws`'s 262144. That described the code's shape
  rather than the protocol's, and the reads it did not retain were dropped rather than
  bounded. It now bounds the queue, and refuses at `ws`'s bound with
  `WS_ERR_TOO_MANY_BUFFERED_PARTS` and a 1008.
- **The `wss:` client dropped every TLS and `http.request` option.** `ca`, `cert`, `key`,
  `pfx`, `passphrase`, `secureContext`, `rejectUnauthorized`, `checkServerIdentity`,
  `servername`, `agent`, `createConnection`, `localAddress`, `family` and `lookup` were
  all read by nobody, so a caller pinning an internal CA got a `self-signed certificate`
  error naming the certificate they had just supplied, and a proxy hook or a connection
  pool was unreachable. `@types/ws` types `ClientOptions` as extending
  `SecureContextOptions` and the request options, and `ws` spreads the caller's object
  into the request, so these keys are the contract rather than an implementation detail.
- **The opening handshake had the wrong header precedence.** The library's upgrade headers
  went _under_ the caller's, so a caller merging headers from a config object could set
  `Connection: keep-alive` and produce a request that is not an upgrade. URL credentials
  overwrote an explicit `Authorization`, silently downgrading a bearer token to basic
  auth. `origin: ''` sent a header with an empty value. `handshakeTimeout: 0` armed a
  timer rather than arming none, so the documented way of saying "no deadline" refused
  the handshake on the next tick. All four now match `ws`.
- **Two valid `perMessageDeflate` options were answered with a 400.**
  `serverMaxWindowBits: 15` is the maximum legal value and the one this build emits, and
  it was refused; `clientMaxWindowBits: 12` was read as a limit on this server when
  RFC 7692 section 7.1.1.2 makes it the window the client will use. Both connect now, in
  all four directions between the two implementations.
- **`send` ignored three of its options.** `compress: false` compressed anyway, so a
  caller shipping already-compressed payloads paid a deflate on both ends for nothing.
  `mask: false` and `ping(data, false)` masked anyway on a client. `send(blob)` threw,
  though `ws` accepts one and its own API reference lists it as a valid payload. A blob is
  read asynchronously and the send after it waits behind the read, as `ws` orders it.
- **`createWebSocketStream` diverged on two paths.** `{ readableObjectMode: true }`
  pushed a Buffer where `ws` gives a string for a text message, so every line-protocol
  pipeline built on it broke silently. `end()` resolved on the socket's `close` rather
  than when the close frame was written. The conformance harness had been comparing both
  implementations against a stub socket, so neither path was exercised by a test that
  could fail; it now runs real servers on both legs.

### Added

- The `maxBufferedChunks` and `http.request`/TLS option surfaces now have tracker rows.
  The first had none because it was believed unreachable; the second because it was
  believed to be an implementation detail, which `@types/ws` says it is not.
- `codec_encode` takes a `maskFrame` flag. The encoder decided masking from the
  connection role alone, so honouring `send`'s `mask` option needed somewhere to put the
  caller's choice. A server still refuses to mask, which was already the documented
  position.
- The engine's bound for a peer's `server_max_window_bits` is one module
  (`src/compat/extensions/offer-window.ts`) rather than a branch inside the refusal
  predicate, because it is a statement about the compressor and the predicate is a
  statement about the negotiation.

### Known divergences from `ws`

Four, all deliberate, all recorded in `COMPATIBILITY.md` with the measurement behind them.

- A `server_max_window_bits` below 15 in a client offer is declined. `ws` accepts it,
  answers it, and then compresses at 15 regardless, so its header claims a window the
  stream does not use.
- A redirect from `wss:` to `ws:` is refused. `ws` follows the hop after stripping the
  credentials, which is the behaviour of a client that will send a bearer token over a
  plaintext connection because a server it trusts said so.
- The close deadline and the two payload limits are validated where `ws` coerces, so a
  value outside the range is a `RangeError` rather than a silently clamped limit.
- A refused frame's message names the cause `ws` names. The refusal table has one entry
  for `maxFragments` and `maxBufferedChunks`, so the `maxBufferedChunks` path reports
  `Too many message fragments`.

Two `ws` behaviours are also recorded as unreachable, with the architecture that removes
them: `WS_NO_BUFFER_UTIL` and `WS_NO_UTF_8_VALIDATE` both guard an optional native npm
module, and ventiws compiles no such module.

### Documentation

- `COMPATIBILITY.md`, `docs/compliance-api.md`, `docs/compliance.md` and
  `docs/compliance-error-codes.md` record what actually happens, including the rows that
  were wrong. A tracker that cites a file which does not exist is worse than no tracker,
  so `tests/conformance/close-latch.conformance.test.ts`, which was cited as passing
  evidence, is replaced by the test that exists.
- The 64 KiB engine capacity is now stated with the measurement that settles what it
  bounds. The public surface was asked to match `ws` here and already does: a 100 MiB
  message and 300 concurrent connections both pass, and the 64 KiB is a property of the
  engine's startup slab on a route no constructor reaches. Raising it to `ws`'s default
  would cost 12.8 GiB per server at 128 connections.
- `zslay` is named in `CODEBASE.md` as what it is: the first-party frame parser under
  `receive.zig` and `encode.zig`, pinned in `build.zig.zon` to the same `farbenbuilds`
  artifact the engine resolves, which is what makes the two routes agree on the wire by
  construction.
- `docs/compliance.md` gains the rule the stream stub exposed: a comparison is evidence
  only if its reference leg can fail.

## [0.0.0]

Never published. The pre-alpha line, from the first commit to `e2add84`, has no release
history: the public surface, the RFC 6455 codec, the µWebZockets engine route, the Autobahn
harness, the conformance suite and the tracking documents were all built on `main` with no
published version behind them.
