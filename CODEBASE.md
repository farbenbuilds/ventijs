# ventijs Codebase

## Scope

ventijs is a Node.js native addon that exposes the
[µWebZockets](https://github.com/farbenbuilds/uWebZockets) first-party Zig
engine through a `ws`-compatible TypeScript surface. The repository contains two languages with
a single hard boundary between them: TypeScript owns the public API, argument
validation, and generated type surface; Zig owns buffer lifetime, protocol
parsing, framing, and backpressure.

This document describes the architecture the codebase is converging on, the
ownership rules that govern every cross-language call, and the exact state of
the current branch.

## Design rules

1. Data is grouped by access pattern. Connection pools, router tables, and
   frame queues are parallel arrays or contiguous slabs, not linked structures
   of objects.
2. Parsing and transforms are pure functions with explicit input and output
   state. Mutable I/O state stays at the transport boundary.
3. Hot paths have fixed capacity. Exhaustion returns a typed error or applies
   backpressure; it never triggers an unbounded allocation.
4. No object-oriented programming. No classes, no `this`, no inheritance, no
   hidden state. Constructor-shaped exports are plain functions returning
   explicit state records.
5. Modules are granular. A source file that approaches 150 lines is split by
   responsibility before it grows a second reason to change.
6. The published package has exactly two runtime dependencies: `napi-zig` and
   `uWebZockets`. Everything else is development tooling.

## Repository layout

Current tree on this branch:

```text
ventijs/
├── flake.nix                  # pinned Node.js, pnpm, Zig 0.16.0 dev shell
├── flake.lock                 # locked Nix inputs
├── lefthook.yml               # pre-commit hook contract
├── .oxlintrc.json             # oxlint rules for the TypeScript tree
├── .oxfmtrc.json              # oxfmt formatting rules
├── pnpm-workspace.yaml        # pnpm settings (lefthook build approval)
├── package.json               # package metadata, scripts, exports
├── tsconfig.json              # strict TypeScript configuration
├── tsconfig.dist-types.json   # built-declaration check through package exports
├── tsdown.config.ts           # bundle, declaration, and native artifact pipeline
├── build.zig                  # build entry, delegates to src/builds/orchestrator.zig
├── build.zig.zon              # pinned uWebZockets and napi-zig revisions
├── scripts/
│   ├── check-staged.sh        # staged-file hygiene checks
│   └── oxlint-plugin.mjs      # local rules for the anti-OOP conventions
├── src/
│   ├── index.ts               # public type surface plus the runtime values
│   ├── lib.zig                # napi-zig root module declaration and exports
│   ├── engine_tests.zig       # Zig unit test entry point
│   ├── engine/                # native engine modules, grouped by plane
│   │   ├── channel/           # engine-thread to JS transport
│   │   │   ├── callbacks.zig  # threadsafe channel rendering events to JS
│   │   │   ├── events.zig     # engine event vocabulary
│   │   │   └── ring.zig       # bounded SPSC event ring
│   │   ├── ffi/               # N-API entry points
│   │   │   ├── server_io.zig  # handle-resolving server FFI free functions
│   │   │   └── socket_io.zig  # handle-resolving socket FFI free functions
│   │   ├── server/            # lifecycle, config, and route wiring
│   │   │   ├── server.zig     # server lifecycle free functions
│   │   │   ├── server_cleanup.zig # environment-teardown cleanup hook
│   │   │   ├── instance.zig   # live server record and instance table
│   │   │   ├── registry.zig   # bounded slot table for server instances
│   │   │   ├── options.zig    # trusted listen configuration structs
│   │   │   ├── engine_config.zig # engine application configuration record
│   │   │   ├── ports.zig      # listener bound-port introspection
│   │   │   └── connections.zig # engine WebSocket route trampolines
│   │   └── socket/            # per-connection state and staging
│   │       ├── socket.zig     # per-connection ops and terminal latch
│   │       ├── socket_ops.zig # outbound transitions over one record
│   │       ├── status.zig     # connection state and operation vocabulary
│   │       ├── handles.zig    # generation-checked connection slot slab
│   │       └── payload.zig    # bounded outbound payload staging ring
│   ├── engine-tests/          # one Zig unit suite per testable module
│   │   ├── root.zig           # suite aggregator
│   │   ├── channel/           # callbacks, events, and ring suites
│   │   ├── ffi/               # addon surface suite
│   │   ├── server/            # instance, options, ports, registry suites
│   │   └── socket/            # handles, payload, socket, socket_ops suites
│   ├── binding/
│   │   ├── load.ts            # native addon resolution and typed loading
│   │   ├── native.ts          # addon ABI types and engine event records
│   │   ├── handle.ts          # connection handle pack and unpack helpers
│   │   ├── server.ts          # server create/listen/close/finalize wrappers
│   │   └── socket.ts          # socket send/close/pause/resume wrappers
│   ├── compat/
│   │   ├── constructors.ts    # WebSocket/WebSocketServer runtime assembly
│   │   ├── errors.ts          # coded error factories and status mapping
│   │   ├── ready-state.ts     # CONNECTING/OPEN/CLOSING/CLOSED ordinals
│   │   ├── stream.ts          # createWebSocketStream duplex adapter
│   │   ├── events/
│   │   │   ├── registry.ts    # listener registry replacing EventEmitter
│   │   │   ├── emitter.ts     # EventEmitter-shaped surface over the registry
│   │   │   ├── dom-events.ts  # DOM event object factories
│   │   │   └── dom-listeners.ts # add/removeEventListener and on* attributes
│   │   ├── options/
│   │   │   ├── shared.ts      # shared normalization helpers and constants
│   │   │   ├── server.ts      # server option validation and normalization
│   │   │   └── client.ts      # client option validation and normalization
│   │   ├── socket/
│   │   │   ├── socket.ts      # WebSocket constructor-shaped factory
│   │   │   ├── state.ts       # socket record, brands, and defaults
│   │   │   ├── attach.ts      # native and upgraded-stream adoption
│   │   │   ├── send.ts        # send routing into the binding
│   │   │   ├── payload.ts     # payload normalization and status mapping
│   │   │   ├── close-reason.ts # close reason argument handling
│   │   │   └── lifecycle.ts   # close/terminate/pause/resume and terminal latch
│   │   └── server/
│   │       ├── server.ts      # WebSocketServer constructor-shaped factory
│   │       ├── close.ts       # server close and address semantics
│   │       ├── listeners.ts   # Node HTTP server event wiring
│   │       ├── upgrade.ts     # handleUpgrade and shouldHandle
│   │       ├── handshake.ts   # accept key, rejections, subprotocol parsing
│   │       └── clients.ts     # clientTracking set maintenance
│   ├── protocol/
│   │   ├── backpressure.ts    # bufferedAmount math and water marks
│   │   ├── close-codes.ts     # RFC 6455 close codes and predicates
│   │   └── framing.ts         # frame header math and masking
│   ├── types/
│   │   ├── ws.d.ts            # vendored DefinitelyTyped ws contract, ESM footer
│   │   ├── close.ts           # ready-state and close-code unions
│   │   ├── errors.ts          # stable error codes and coded-error shape
│   │   ├── events.ts          # event-map, handler, and registry types
│   │   ├── options.ts         # normalized client and server option records
│   │   ├── server.ts          # ServerState and the server event map
│   │   ├── socket.ts          # SocketState and the socket event map
│   │   └── status.ts          # engine status to error-code mapping types
│   └── builds/
│       ├── orchestrator.zig   # build entry: addon, build options, tests
│       ├── vendor.zig         # engine dependency and pinned version
│       ├── testing.zig        # Zig unit test module and test step
│       └── targets/
│           ├── default.zig    # default build target query
│           └── native.zig     # position-independent vendor archives
├── tests/
│   ├── autobahn/              # RFC 6455 harness: target, gate, and report
│   ├── binding/
│   │   ├── addon.test.ts      # native pipeline smoke test
│   │   ├── server*.test.ts    # server lifecycle and limits
│   │   ├── socket*.test.ts    # connection slab and socket boundaries
│   │   └── support.ts         # fixtures shared by the binding suites
│   ├── compat/
│   │   ├── events/            # registry, emitter, and DOM listener tests
│   │   ├── options/           # option normalization tests
│   │   ├── socket/            # facade socket tests and the native fixture
│   │   ├── server/            # server, upgrade, and handshake policy tests
│   │   ├── errors.test.ts     # coded error factories
│   │   └── stream.test.ts     # duplex adapter over a native socket
│   ├── conformance/           # ws side-by-side scenario suites
│   ├── protocol/              # close code, framing, and backpressure tests
│   ├── tooling/               # lint plugin rule tests
│   ├── types/                 # fixtures checked by pnpm typecheck
│   └── declarations/          # fixtures checked by pnpm typecheck:dist
├── bench/                     # same-host harness comparing ventijs with ws
│   ├── index.ts               # entry point, sizing, and report path
│   ├── echo/                  # one echo server and client per implementation
│   └── support/               # plan, sampling, statistics, provenance, report
└── .github/                   # community templates, issue forms, CI workflows
```

Target layout as the binding lands:

```text
build.zig                      # build entry; delegates to src/builds/orchestrator.zig
build.zig.zon                  # pinned uWebZockets and napi-zig revisions
src/
├── index.ts                   # thin public re-export surface
├── lib.zig                    # napi-zig module declaration and exports
├── builds/                    # Zig build graph helpers, one concern per file
│   ├── orchestrator.zig       # build entry and wiring
│   ├── vendor.zig             # engine dependency and pinned version
│   ├── testing.zig            # Zig test module and test step
│   └── targets/               # target-specific build settings
│       ├── default.zig        # default build target query
│       └── native.zig         # position-independent vendor archives
├── binding/                   # native addon loading and typed N-API calls
│   ├── load.ts                # platform/arch addon resolution, one error type
│   ├── server.ts              # server handle create/listen/close free functions
│   └── socket.ts              # socket handle send/close/ping free functions
├── compat/                    # ws API compatibility, one concern per module
│   ├── constructors.ts        # WebSocket/WebSocketServer runtime assembly
│   ├── errors.ts              # coded error factories and status mapping
│   ├── ready-state.ts         # ready-state ordinals for both facades
│   ├── stream.ts              # createWebSocketStream duplex adapter
│   ├── events/                # listener registry, emitter, and DOM handlers
│   ├── options/               # shared, server, and client normalization
│   ├── socket/                # socket factory, state, send, and lifecycle
│   └── server/                # server factory, upgrade, and handshake policy
├── protocol/                  # pure TypeScript helpers
│   ├── close-codes.ts         # RFC 6455 close code constants and predicates
│   ├── framing.ts             # length and mask helpers used by tests
│   └── backpressure.ts        # bufferedAmount and high-water policy
├── types/                     # public and internal type-only modules
├── engine_tests.zig           # Zig unit test entry point
├── engine-tests/              # per-module Zig unit suites, mirroring engine/
├── engine/                    # native engine modules, grouped by plane
│   ├── channel/               # event transport, vocabulary, and ring
│   ├── ffi/                   # N-API entry points
│   ├── server/                # lifecycle, instance table, config, routes
│   └── socket/                # per-connection slab, ops, staging
└── ...                        # further entry points and build wiring
```

Zig and TypeScript share `src/`. `napi-zig` expects the addon root module at
`src/lib.zig`, `tsdown` expects the package entry at `src/index.ts`, and the
file extensions keep the two languages apart. `build.zig` and `build.zig.zon`
stay at the repository root so the `napi-zig` CLI runs there without a
working-directory flag. The build graph itself lives in `src/builds/`:
`build.zig` only delegates to the orchestrator, which wires the vendor
dependency, the build metadata, and the tests. Future Zig modules live beside
the TypeScript files in `src/` or in a dedicated subdirectory split by
responsibility.

Test and tooling directories:

```text
tests/          # vitest unit, integration, and boundary tests
tests/autobahn/ # RFC 6455 conformance harness, run by node, not by vitest
bench/          # benchmark harness that runs ventijs and ws through one path
```

## Language boundary and ownership

The boundary is a small set of free functions with primitive or slice
arguments. There is no shared mutable object graph across the boundary.

| Concern                          | Owner      | Rule                                                      |
| -------------------------------- | ---------- | --------------------------------------------------------- |
| Public API shape and defaults    | TypeScript | Mirrors `ws`; validated before any native call            |
| Option validation                | TypeScript | Explicit per-field checks; no coercion of untrusted input |
| Connection and parser state      | Zig        | Fixed-capacity slabs owned by the engine                  |
| Frame assembly, masking, UTF-8   | Zig        | SIMD fast paths with scalar tails                         |
| Outbound queues and backpressure | Zig        | Bounded; overflow reports backpressure to JS              |
| Message payloads observed by JS  | Node       | Copied into Node-owned `Buffer` at the boundary           |
| Event dispatch                   | TypeScript | Explicit listener arrays; no hidden emitter inheritance   |

Two lifetime rules are absolute:

1. Engine slabs are never exposed to JavaScript. Inbound frames are copied into
   Node-owned buffers before a handler runs, so retaining `data` after the
   callback is safe and behaves exactly like `ws`.
2. Buffers passed to `send`, `ping`, `pong`, or `close` are borrowed for the
   duration of the native call only. The engine copies them into its outbound
   queue before returning.

## End-to-end type pipeline

One type model flows in one direction:

```text
Zig declarations and comptime capacities
        |
        v
napi-zig ABI surface (validated at binding time)
        |
        v
TypeScript binding types (type-only modules, no runtime cost)
        |
        v
tsdown declaration bundle (dist/*.d.ts)
        |
        v
Consumer TypeScript project
```

Rules that keep the pipeline honest:

- Public types are declared once and re-exported, never redefined per module.
- The binding layer imports types with `import type` so no runtime graph is
  created for declarations.
- Generated declarations are treated as build output. The one hand-maintained
  declaration is `src/types/ws.d.ts`, the vendored `@types/ws` contract below.
- Numeric status codes crossing the boundary are mapped to stable unions in
  TypeScript and never leaked as magic integers.

### Vendored declarations

`src/types/ws.d.ts` is a vendored copy of the DefinitelyTyped `ws` declarations
(`@types/ws` 8.18.1, MIT) and the single source of the public type surface. Only
the footer is adapted, converting `export =` into ESM type exports so `tsdown`
can bundle it, and exporting `Server` to match upstream's ESM entry. The header
records the upstream version.

- `src/index.ts` re-exports the type surface with `export type *` and the
  runtime constructors from `src/compat/constructors.ts`; the only export not
  in upstream's ESM entry is `WebSocketEventMap`, a deliberate superset.
- The file is exempt from oxlint and oxfmt because upstream style violates the
  project rules; `pnpm typecheck:dist` still checks the bundled output with
  `skipLibCheck: false`.
- Attribution ships in `dist/index.d.mts` and is recorded in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Refresh procedure: re-download `@types/ws` `index.d.ts`, keep the header and
  footer adaptations, then run `pnpm build` and `pnpm test`.

## Runtime data flow

```text
JS: new WebSocketServer(options)
      |
      v
compat/options/{shared,server,client}.ts: validate and normalize
      |
      v
binding/server.ts: createServer(config) ----> Zig engine
                                                  |
                                      uWebZockets: accept, upgrade, parse
                                                  |
                               +------------------+------------------+
                               |                                     |
                     engine -> threadsafe fn                engine -> threadsafe fn
                     ("connection")                         ("message", "close", ...)
                               |                                     |
                               v                                     v
                     compat/events/registry.ts dispatch     compat/events/registry.ts dispatch
                               |                                     |
                               v                                     v
                        JS listener                           JS listener
```

Outbound path:

```text
JS: socket.send(data, options)
      |
      v
compat/socket/send.ts: validate data and options
      |
      v
binding/socket.ts: sendSocket(server, connection, data, binary)
      |
      v
engine/ffi/socket_io.zig: resolve server and connection handles
      |
      v
engine/socket/socket.zig: state transition ----> engine/socket/payload.zig: copy into the
                                                   bounded staging ring
                                                          |
                                       engine/ffi/socket_pump.zig: cluster inbox,
                                       which wakes the engine thread
                                                          |
                                       engine pokes the topic subscriber, which
                                       calls WebSocket.send
                                                          |
                                                   libxev non-blocking write
```

The inbound direction is the mirror image. The engine's `message` callback hands
the parsed payload to `engine/socket/queues.zig`, which copies it into the
server's inbound ring and emits a `connection_message` wakeup.
`src/binding/socket.ts` then pulls the bytes with `takeSocketMessage`, which
copies them into a Node-owned `Buffer` and frees the ring slot, because the
engine reuses its own buffer for the next frame.

Backpressure flows the other way: when the outbound ring exceeds its
high-water mark, the native call reports it, queue growth stays visible through
`socket.bufferedAmount`, and pending sends drain through their callbacks.
`ws` does not return a boolean from `send`, so neither does ventijs.

## Event loop model

- The µWebZockets engine runs its own event loop; it is not driven by the
  Node.js event loop.
- Native events are marshalled to the Node main thread through a single
  threadsafe-function channel per instance.
- Callbacks registered from JavaScript are stored in explicit arrays keyed by
  event name. Dispatch iterates a snapshot so a handler that removes another
  handler cannot corrupt iteration.
- `close` is emitted exactly once. The binding marks the handle terminal before
  dispatch so a teardown race cannot emit twice.
- Any API that touches a terminal handle is a no-op or resolves a typed error,
  never a crash.

## Capacity and failure model

Capacities are named configuration, not byte arithmetic. The compatibility
layer maps `ws` options such as `maxPayload` onto engine limits at server or
socket construction time. When a peer exceeds a limit, the engine applies the
same observable behavior a `ws` user expects: a close with code `1009` for
oversized payloads, `1002` for protocol errors, and `1008` for policy
rejections. A limit violation never allocates a fallback buffer.

Errors crossing the boundary use a small fixed set of named codes. JavaScript
receives `Error` instances with stable `code` values; Zig never throws through
the ABI.

## Module conventions

- TypeScript files use `kebab-case` and export free functions or const
  records. No default exports, except the `src/index.ts` default that mirrors
  the `ws` entry point with both the value and its type meaning.
- Zig files use `snake_case`, functions and variables use `snake_case`, and
  types use `PascalCase`.
- A module owns one responsibility. If a module needs two sections to explain
  itself, it becomes two modules.
- Control flow follows the Linux kernel style: guard clauses first, early
  returns, no nested `if`/`else` ladders, no loop bodies that branch on mode
  flags. See [CODING_CONVENTION.md](CODING_CONVENTION.md).

## Current branch state

`feat/native-foundation` added the native memory foundation, the server
lifecycle, and the only threadsafe path from an engine thread to JavaScript.
`feat/socket-io` added the per-connection state machine, the bounded outbound
staging ring, and the socket FFI. `refactor/quality-hardening` closes the races
and lifetime gaps the audit found, optimizes the build, and adds the gates that
keep the rules enforced:

- `src/engine/socket/handles.zig` holds the generation-checked connection slab. One slot maps
  one-to-one onto an engine pool slot; `acquire` bumps the generation and
  `resolve` rejects a stale handle, so a call against a closed connection
  surfaces as a typed error instead of a use-after-free.
- `src/engine/server/options.zig` trusts the JavaScript configuration once: it validates the
  host, port, backlog, route path, and per-route limits against the compiled
  capacities, reads every integer at the 53-bit safe width, and copies them
  into fixed-capacity `ListenConfig`, `Limits`, and `ServerConfig` records;
  `maxConnections` is enforced when a peer opens.
- `src/engine/server/engine_config.zig` owns the single engine `ServerConfig`
  the cluster is built from. The engine compile-checks the connection, message,
  write-queue, idle-timeout, route-capture, and HTTP/3 capacities against the
  generated application type, so the module narrows the two the check does not
  cover: the HTTP/2 session region and the radix router region. At the engine
  defaults those two regions fill about 82 percent of the 82 MB per-server
  startup slab for transports and routes ventijs never negotiates; narrowing
  them brings the slab to about 50 MB.
- `src/engine/server/registry.zig` is a fixed-capacity atomic slot table; `src/engine/server/instance.zig`
  holds the live `Instance` record and the bounded table that binds engine
  callbacks to server state; `src/engine/server/connections.zig` registers the comptime
  WebSocket trampolines that acquire and release slab slots.
- `src/engine/channel/events.zig` defines the fixed-size event vocabulary and
  `src/engine/channel/callbacks.zig` is the only bridge an engine thread may use to reach
  JavaScript: a bounded ring travels through one threadsafe function and is
  rendered on the Node main thread, allocating nothing on the engine thread.
- `src/engine/server/server.zig` exposes create/listen/close/finalize. Create builds the
  engine application through `AppType.cluster(1)`; listen binds the listener
  and starts the engine thread; close routes through the cluster wakeup; the
  `server_closed` event proves the loop has drained before finalize joins the
  thread and frees every resource. Finalize refuses to free while events are
  still queued (`EventsPending`), and every server handle carries a generation
  and a Node environment owner, so stale handles and cross-worker calls are
  typed errors. `listening` reports the bound port, so `port: 0` resolves to
  the ephemeral port the kernel assigned.
- `src/engine-tests/` holds one unit suite per testable module in the mirrored
  plane folder, aggregated by `root.zig` and entered through
  `src/engine_tests.zig`; `src/builds/testing.zig`
  compiles that entry for `zig build test`, and the `zig-test.yml` workflow runs
  it plus the addon-backed binding suite. `server` and `connections` are
  engine-coupled and are covered there instead of in the unit binary.
- `src/binding/{native,handle,server}.ts` declare the addon ABI, pack and
  unpack the 64-bit connection handle, and wrap the lifecycle calls;
  `src/binding/load.ts` keeps resolving the `.node` and now types the full
  `VentiAddon` record.
- `tests/binding/addon.test.ts` proves the Zig build, addon load, version
  round-trip, and lifecycle surface; `tests/binding/` drives create, listen, a
  live WebSocket connection through the slab, close, and finalize.
- `src/engine/socket/payload.zig` is the outbound boundary. `stage` copies JavaScript
  bytes into a fixed-capacity structure-of-arrays ring before the call returns
  and publishes each record with a release store, so JavaScript memory is never
  retained and the engine thread only ever observes whole records. An
  oversized payload is rejected before any copy, and a full ring reports
  backpressure instead of allocating.
- `src/engine/socket/status.zig` holds the connection lifecycle and operation
  vocabulary, including the `ws` close-code acceptance rule.
- `src/engine/socket/socket.zig` is the per-connection slab: one record per engine
  pool slot, mirroring the handle index, with the bounded ring attached.
  `send`, `close`, `pause_dispatch`, and `resume_dispatch` are explicit
  transitions over that record; `finish` flips the terminal latch with one
  atomic compare-exchange per connection generation, so a close race can never
  emit two terminal events. `connections.zig` opens the record when a peer
  arrives and only emits `connectionClose` for the latch winner.
- `src/engine/ffi/socket_io.zig` is the FFI seam: every entry point resolves the
  server through the instance table and the connection through the
  generation-checked slab first, so a call against a closed connection returns
  `invalid-handle` instead of dereferencing a stale slot.
- `src/binding/socket.ts` mirrors that surface for TypeScript: `sendSocket`,
  `closeSocket`, `pauseSocket`, `resumeSocket`, and `socketBufferedAmount`
  validate handles, payloads, and close codes before the native call and map
  the camelCase ABI statuses onto `EngineStatus`. `EngineStatus` gained
  `invalid-close-code` and `invalid-close-reason`, and the coded-error map
  covers both.
- `src/engine-tests/socket/{payload,socket}_test.zig` cover copy semantics, capacity
  limits, close validation, dispatch pause, buffered accounting, and the
  concurrent terminal latch; `tests/binding/socket*.test.ts` drive the ops
  through the addon against a live connection. The engine-thread drain that turns
  staged records into frames landed with `src/engine/ffi/socket_pump.zig`, and
  `tests/binding/socket-echo.test.ts` drives a real `ws` client through a text
  round trip, a binary round trip with the opcode preserved, a burst inside the
  inbound budget, and the drop accounting beyond it.
- `src/engine/socket/handles.zig` packs state and generation into one atomic word, so
  `resolve` answers both checks with a single acquire load and can never pair a
  fresh generation with a stale state. `src/engine/socket/socket.zig` gives every
  record a spin lock; `open`, `finish`, and the FFI operations serialize on it,
  and each operation re-checks the generation it resolved against, so a
  recycled slot can never receive a stale send, close, or pause.
- `src/engine/socket/socket_ops.zig` holds the outbound transitions; close stages its
  frame and enters `closing` under the lock, so two concurrent closes stage
  exactly one frame, and the close frame is counted in `bufferedAmount`.
- `src/engine/channel/ring.zig` reserves the last `connection_capacity + 2` slots for
  terminal events, so a burst of regular events can never drop a close or
  `server_closed`. A dropped reservation is counted, never silently retired.
- `src/engine/channel/callbacks.zig` latches a closing state before the engine thread
  is joined, uses a stack-buffer arena for rendering, and `server_cleanup.zig`
  registers an environment cleanup hook that stops the engine thread and frees
  a server a worker never finalized. `server_io.zig` keeps the N-API wrappers
  separate from the lifecycle, mirroring `socket_io.zig`.
- `pnpm build:binding` builds in ReleaseSafe: the addon drops from ~98 MB to
  ~9 MB and the engine's startup temporary no longer overflows a worker's
  default stack. `scripts/check-conventions.mjs` enforces the 150-line budget,
  Zig naming, filename case, and the emoji ban through `pnpm lint` and a
  `lefthook` job; CI also runs `typecheck:dist` after the addon build and the
  test job discovers new pure suites instead of enumerating directories.

The build-graph bullets below come from `refactor/build-orchestrator` and
remain current:

- `build.zig` only calls `orchestrator.inject(b)`. `src/builds/orchestrator.zig`
  resolves the target and optimize mode, wires the addon through
  `napi_zig.addLib`, and hands the test wiring to `src/builds/testing.zig`.
- `src/builds/vendor.zig` configures the uWebZockets dependency and reads its
  pinned version; `src/builds/targets/` holds the default target query and the
  position-independent flag the shared addon needs on every vendored archive.
- `package.json` defines the package scripts (`build`, `build:binding`, `dev`,
  `format`, `format:check`, `lint`, `lint:fix`, `test`, `test:watch`,
  `typecheck`, `typecheck:dist`, `release`, `prepublishOnly`) and development
  dependencies, including the `napi-zig` CLI.
- `tsdown.config.ts` enables bundled declaration output and copies the host
  `.node` artifact into `dist/`, so `pnpm build` produces a self-contained
  package for the current platform.
- The addon links the full `uWebZockets` engine module; `src/lib.zig` exposes
  `engineVersion()`, `http3Available()`, and the server lifecycle functions.
  The engine's TLS surface (`App.init_https`, `TlsContext.init`) is reachable
  from the addon but not yet exposed to TypeScript.
- The engine's vendored C dependencies (BoringSSL, lsquic, libdeflate, zlib)
  build once into `.zig-cache/` from pinned package sources. They link into the
  shared addon, so `src/builds/targets/native.zig` marks every archive position
  independent through the build graph; without it the link fails on absolute
  `R_X86_64_32` relocations.
- `napi-zig` was wired by hand following its manual setup guide, never with
  `napi-zig new`, so the existing tsdown, oxlint, and oxfmt configuration is
  not scaffolded over.
- `src/binding/load.ts` resolves the `.node` from `zig-out/` first and from
  `dist/` second, returning the typed `VentiAddon` record declared in
  `src/binding/native.ts`.
- `.oxlintrc.json` and `.oxfmtrc.json` encode
  [CODING_CONVENTION.md](CODING_CONVENTION.md); `lefthook.yml` runs them on
  every commit alongside `zig fmt`, typecheck, and the test suite.
- `flake.nix` pins Node.js, pnpm, Zig 0.16.0, zls, and TypeScript tooling;
  `.#musl` selects a musl dev shell on musl hosts.
- `tests/binding/addon.test.ts` proves the Zig build, addon load, and version
  round-trip.

The next milestone is adoption: the engine carries a full RFC 6455 message round
trip over its own listener, but the `ws`-shaped facade's HTTP upgrade path still
adopts a raw Node stream and does no framing, and client construction is still
absent. The addon exposes the engine version, the server lifecycle, and the
per-connection socket operations including the drain and the receiver; the
`ws`-shaped upgrade path is what sits on top of them without them yet.
