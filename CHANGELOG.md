# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Conventional Commits](.github/COMMIT_CONVENTION.md), so the commit subjects are the
same information in a form `git log` can filter.

## [1.0.0-alpha.1] - 2026-09-29

The first release with per-platform addons. `1.0.0-alpha` shipped a tarball with
a single platform's compiled addon baked in, so it installed only where that
platform's binary happened to fit; this one ships the addon as a package npm
selects per host, and the release itself is a tag rather than a manual publish.

### Added

- **The addon ships for five platforms.** The package no longer bakes one platform's
  compiled addon into its own tarball. `src/builds/platforms.zig` declares the published
  set and `napi_zig.addLib`'s npm config produces one `@ventiws/binding-*` package per
  target, so `pnpm add ventiws` installs on Linux x64 (glibc and musl), Linux arm64,
  macOS x64, and macOS arm64 with no compiler on the reader's machine. npm selects the
  package from its `os`, `cpu`, and `libc` fields, and a host outside the five installs
  cleanly and is told which platforms exist rather than reaching a missing file.

- **Windows is not supported, and that is a regression from the previous published
  tarball, which carried a Windows x64 addon.** There are two independent reasons and
  both are recorded. The addon cannot be packaged: `napi_zig` 0.2.8 resolves a Windows
  target to `x86_64-windows-none`, an ABI-less target with no `ws2_32` to link. And it
  cannot be served: the engine's listener binds and the kernel accepts, then the
  vendored `xev` event loop fails `accept` and `read` with `error.Unexpected` and resets
  the peer. A Windows user of the alpha cannot run a server on either a published or a
  locally built addon. The follow-ups are recorded in `src/builds/platforms.zig` and
  `CI_CD_PIPELINE.md`.

### Changed

- **A release is a tag.** `.github/workflows/publish.yml` builds every published platform
  on a runner that is native for it, proves each addon loads and round-trips frames
  through the native codec, and publishes six packages. The publish job authenticates
  with a granular `NPM_TOKEN` rather than trusted publishing, because npm can only
  configure trusted publishing for a package that already exists and the five
  `@ventiws/binding-*` packages do not. A workflow dispatch defaults to a dry run that
  packs every tarball without publishing and needs no credential. This supersedes the
  manual `npm publish` in `CONTRIBUTE.md`.

### Fixed

- **`port: 0` reported `0` on Windows, so a server on an ephemeral port was unusable.**
  `bound_port` in `src/engine/server/server.zig` read the port back from the listener on
  POSIX and returned the _requested_ port on Windows, on the stated belief that its
  listener is not a POSIX descriptor. It is: the engine is a native Zig TCP stack on
  `xev`, and `TcpServer.listener` is an `xev.TCP` carrying a descriptor on every
  platform. A Windows `WebSocketServer` given `port: 0` therefore reported `address().port`
  as `0`, and every test that bound an ephemeral port and dialled the result connected to
  port 0. The branch is deleted and the port is read back on every platform.

- **`zig build test` could not compile on Windows.** `ports_test.zig` passed a literal
  `-1` as an invalid descriptor, and `std.posix.socket_t` is a handle rather than an
  integer there, so the test suite that gates the engine did not build. It is now a
  descriptor that is invalid on both shapes.

- **`pnpm lint` failed on every Windows checkout.** `scripts/check-conventions.mjs`
  compared `relative()`'s output against `tests/`, and on Windows that is
  `tests\binding\...` with backslashes, so no test file matched the `tests/` prefix and
  the whole tree was held to the stricter source comment budget instead of the test one.
  Sixty violations that pass in CI failed locally. A `.gitattributes` pins the tree to LF
  so `zig fmt --check`, which rejects CRLF, passes on Windows as well.

### Known limitations

- **WebSocket traffic does not work on Windows.** Sixteen suite files fail there, on
  `main` as much as on this branch, and the cause is the vendored `xev` event loop: the
  listener binds and the kernel accepts, then `accept` and `read` complete with
  `error.Unexpected` and the peer is reset. The port fix below removes the first thing
  that stood in the way, and the loop is what remains. `zig build test` and every suite
  that does not open a socket pass on Windows.

## [1.0.0-alpha] - 2026-09-29

The first versioned line. `ws` 8.21.3 and `@types/ws` 8.18.1 are the compatibility
contract, and `docs/migrating.md` is the short version of where that contract holds and
where it does not.

The published tarball at this version carries a Windows x64 addon only, so a `pnpm
install` on any other platform needs a local `pnpm build`. The platform packages arrive
in the version after this one.

### Changed

- **The package is `ventiws`.** The name, the repository and issue URLs, the vendored
  API reference at `docs/ventiws.md`, the `ventiws.node` addon artifact, and the branded
  strings in the error messages, symbol descriptions and harness identifiers all carry
  the new name. The line was never published under the old one, so there is no published
  version to redirect and no consumer to deprecate. `build.zig.zon` takes the fingerprint
  Zig derives from the new package name, which is what makes the Zig package a different
  identity from the one it was.

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
