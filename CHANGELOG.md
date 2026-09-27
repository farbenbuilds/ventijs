# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Conventional Commits](.github/COMMIT_CONVENTION.md), so the commit subjects are the
same information in a form `git log` can filter.

## [Unreleased]

Pre-alpha. No npm release exists. Every entry below is on `main` and has not shipped.

### Added

- CommonJS build alongside ESM, with `import` and `require` conditions in `exports` and
  a `types` condition under each. `require("ventijs")` returns the `WebSocket` class
  with the named exports attached, and `tests/declarations/consumer.cts` compiles a
  CommonJS consumer through the `require` path so the condition cannot rot.
- `docs/migrating.md`: the short version of where the `ws` contract holds and where it
  does not, for a team deciding whether to switch.
- The `continuation` frame kind, so `send`'s `fin` option fragments an outbound
  message and a continuation carries opcode 0 as RFC 6455 section 5.4 requires.
- `binaryType` is honoured on delivery: `arraybuffer`, `fragments`, and `blob` deliver
  what they say, and `fragments` slices the codec's reassembly buffer at the piece
  boundaries so the value still costs no copy beyond the reassembly.
- `skipUTF8Validation` reaches the validator. The codec is the validator, so the option
  is one flag at codec creation.
- `allowSynchronousEvents` pauses the parse loop rather than buffering events, so a
  `close` behind the messages in one read is delivered after them, as `ws` delivers it.
- `maxFragments` is enforced against the compiled bound, and a peer exceeding it is
  closed with 1008 rather than 1002.
- `ws+unix:` client addresses: IPC over a UNIX domain socket or a Windows named pipe.
- The compiled fragment bound is reported as `engineLimits().maxFragments`, so a caller
  can read the number it is competing with.
- A missing native addon is reported from the `WebSocketServer` constructor, so the
  failure is catchable rather than an uncaught exception inside a Node `upgrade`
  listener, and the message names the platform.
- `new WebSocket(address, options)`, the two-argument overload `@types/ws` declares.
- `clientTracking` is a truthiness, matching `ws`, so `null`, `0`, and `""` disable it.
- A CJS declaration consumer and a `tsconfig.dist-types.json` that can check one.

### Fixed

- The client never fired `close`. Every pre-101 failure set the ready state and emitted
  nothing, so a `Promise` wrapper around `new WebSocket` hung for the life of the
  process.
- `send`'s `binary` option was ignored on every reachable route, putting a binary frame
  on the wire where `ws` puts text.
- `send`'s `fin` option was hardcoded, so a caller could not fragment a message at all.
- `close()` with no code wrote 1000, asserting a normal shutdown the caller never
  stated and making 1005 unobservable in both directions.
- A code-less close frame reported 1006, which says the transport failed, about a
  connection that ended by exactly the agreed handshake.
- `closeTimeout: 0` was read as "no deadline" and held the transport and the codec slot
  at `CLOSING` for the life of the process.
- A `close` frame overtook a data message already queued behind it, dropping the
  message. A peer that writes a message and a close in one read is how every application
  says goodbye.
- `autoPong: false` was answered anyway on server sockets, so a caller that said "I will
  answer pings myself" got two pongs.
- A 3xx that would not be followed surfaced as both `redirect` and
  `unexpected-response`, and reported a hardcoded 302 rather than the status the peer
  sent.
- An `unexpected-response` listener could not take the refusal over, which made the
  event a notification of a teardown rather than an offer.
- A `redirect` listener could not prevent the cross-host credential strip, so the
  per-hop header inspection the event exists for was impossible.
- A control record the engine cannot carry stayed at the head of the outbound ring and
  stopped outbound traffic for every connection on that server, permanently.
- `codec_feed` unmasked in place under a `Buffer` the application owns. It reads and
  leaves the caller's bytes alone now.
- `codec_fragments` existed but was not exported from `lib.zig`, so the first read of a
  message's fragment boundaries threw out of the native call.
- The boundary's event-kind bound was written against `rejected`, so a kind added after
  it was unsendable and `send` reported a protocol error for a frame the caller asked
  for.

### Changed

- `engineLimits` reports `maxFragments` alongside the existing capacities.
- The codec is split by responsibility where it grew past the module budget: the byte
  copy, the fragment bookkeeping, the event dispatch, the peer's close, the deferral
  policy, and the handle table are each one module. `src/binding/codec.ts` splits the
  same way, because the three directions through a codec have nothing in common but the
  handle.
- `pnpm build` runs `scripts/finalize-exports.mjs` after `tsdown`, because the bundler
  regenerates `exports` on every build and did not write the `types` conditions.

### Documentation

- The README's status table and quick start describe the implementation rather than a
  state several commits behind it.
- `COMPATIBILITY.md`, `docs/compliance-api.md`, `docs/compliance.md`, and
  `docs/compliance-error-codes.md` record the resolved rows and the corrections, and
  name what is still outstanding.
