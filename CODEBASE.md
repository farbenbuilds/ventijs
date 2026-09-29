# ventiws Codebase

## Boundaries

TypeScript owns the public surface: option normalization and validation, the
listener registry and event dispatch, the Node HTTP upgrade path, and the client
handshake. Zig owns the protocol: header parsing, framing, masking, UTF-8
validation, fragmentation, control frames, `permessage-deflate`, backpressure, and
the engine's own HTTP and WebSocket routing. Nothing but a Node-API call crosses
the line, and every value crossing it is a primitive, a slice the callee copies,
or a status ordinal TypeScript maps to a named union.

| Crossing             | TypeScript owns                                | Zig owns                                                          |
| -------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Public options       | `src/compat/options/{shared,server,client}.ts` | `src/engine/server/options.zig` trusts the result                 |
| Message bytes in     | `src/compat/socket/codec-inbound.ts`           | `src/engine/codec/ingest.zig`, `driver.zig`                       |
| Message bytes out    | `src/compat/socket/codec-send.ts`              | `src/engine/codec/encode.zig`, `outbound.zig`, over `zslay.frame` |
| Codec handle         | `src/binding/codec-create.ts`                  | `src/engine/codec/handles.zig`, `handles-table.zig`               |
| Codec refusal        | `src/compat/socket/codec-refusal.ts`           | `src/engine/ffi/codec_status.zig`                                 |
| Engine listener      | `src/binding/server.ts`                        | `src/engine/ffi/server_io.zig`, `server/server.zig`               |
| Engine connection    | `src/binding/socket.ts`                        | `src/engine/ffi/socket_io.zig`, `socket/socket_ops.zig`           |
| Engine thread events | `src/binding/native.ts` dispatch callback      | `src/engine/channel/{callbacks,ring,events}.zig`                  |
| Compiled capacities  | `src/binding/native-limits.ts`                 | `src/engine/ffi/server_io.zig:engine_limits`                      |
| ABI declaration      | `src/binding/native.ts`                        | `src/lib.zig`                                                     |

`src/types/ws.d.ts` is a vendored copy of the DefinitelyTyped `ws` declarations
(`@types/ws` 8.18.1, MIT), with only the `export =` footer adapted to ESM type
exports. It is the single declaration site for the public type surface,
`src/index.ts` re-exports it, and every stage of the pipeline after it is
generated from it.

## Layout

```text
src/
├── index.ts
├── lib.zig
├── engine_tests.zig
├── binding/
├── builds/
│   └── targets/
├── compat/
│   ├── client/
│   ├── events/
│   ├── extensions/
│   ├── options/
│   ├── server/
│   └── socket/
├── engine/
│   ├── channel/
│   ├── codec/
│   ├── ffi/
│   ├── server/
│   └── socket/
├── engine-tests/
│   ├── channel/
│   ├── codec/
│   ├── ffi/
│   ├── server/
│   └── socket/
├── protocol/
└── types/
```

`build.zig` delegates to `src/builds/orchestrator.zig`; `build.zig` and
`build.zig.zon` stay at the repository root so the `napi-zig` CLI runs there
without a working-directory flag.

| Directory             | What it is for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/compat/`         | The `ws`-shaped facade: everything a consumer can reach, split by the surface it implements. `socket/` holds the socket record and the codec-route modules, `server/` the Node upgrade path, `client/` the `http.ClientRequest` handshake, `extensions/` the RFC 7692 negotiation, `events/` the listener registry, `options/` the normalizers. No native call is made from here; each one goes through `src/binding/`.                                                                                                                                                  |
| `src/binding/`        | The typed addon ABI. `load.ts` resolves the `.node`, `native.ts` declares every entry point `src/lib.zig` exports, `handle.ts` packs the 64-bit connection handle, and the rest wrap one call each. `native-limits.ts` types `engineLimits()`. A new native entry point needs a row in `native.ts` and a wrapper here.                                                                                                                                                                                                                                                   |
| `src/engine/codec/`   | The RFC 6455 frame codec, and the module the public surface actually frames with. `header.zig` and `utf8.zig` parse, `receive.zig` and `fragments.zig` reassemble, `encode.zig` and `outbound.zig` write, `deflate.zig` and `inflate.zig` are RFC 7692, `handles.zig` owns the codec table. The header and mask primitives underneath it are the first-party `zslay`, the same package the pinned `uWebZockets` fork resolves, which is what makes the codec route and the engine route agree on the wire by construction rather than by review. It never sees a socket. |
| `src/engine/channel/` | The only path an engine thread has to JavaScript: a bounded single-producer ring in `ring.zig`, a fixed event vocabulary in `events.zig`, and the threadsafe-function bridge in `callbacks.zig`, which renders on the main thread and allocates nothing on the engine thread.                                                                                                                                                                                                                                                                                            |
| `src/engine/ffi/`     | The Node-API entry points, one file per plane, matching `src/lib.zig` line for line. `server_io.zig` and `socket_io.zig` resolve a generation-checked handle before touching anything; `codec_*.zig` is the codec's half; `socket_pump.zig` and `socket_inbound.zig` are the engine-thread write drain and the receiver.                                                                                                                                                                                                                                                 |
| `src/engine/server/`  | The engine listener: `server.zig` is the create/listen/close/finalize lifecycle, `instance.zig` the live record and the instance table, `registry.zig` the bounded slot table, `options.zig` the trusted `ListenConfig`, `engine_config.zig` the engine `ServerConfig`, `connections.zig` the route trampolines, `topic.zig` per-connection outbound topics, `inbound.zig` the inbound message path, `ports.zig` the bound port, `server_cleanup.zig` the environment teardown hook.                                                                                     |
| `src/engine/socket/`  | The per-connection slab on the engine route: `handles.zig` packs state and generation into one atomic word, `socket.zig` is the record and its terminal latch, `socket_ops.zig` the outbound transitions, `payload.zig` the staging ring, `queues.zig` the per-server FIFO over it, `status.zig` the state and operation vocabulary.                                                                                                                                                                                                                                     |
| `src/builds/`         | The Zig build graph, one concern per file. `build.zig` only calls `orchestrator.inject(b)`; `vendor.zig` pins the engine, `testing.zig` owns the unit-test step, and `targets/` holds the default target query and the `-fPIC` the shared addon needs on every vendored archive. `build.zig.zon` at the root pins the engine, `zslay`, and `napi-zig`; `zslay` is the first-party frame parser and is pinned to the artifact the engine already resolves, so the graph carries one copy.                                                                                 |
| `src/engine-tests/`   | One Zig unit suite per testable module, mirroring the `engine/` folder, aggregated by `root.zig` and entered through `src/engine_tests.zig`. `zig build test` runs it. The two engine-coupled modules, `src/engine/server/server.zig` and `src/engine/server/connections.zig`, are covered by `tests/binding/` instead of here.                                                                                                                                                                                                                                          |
| `src/types/`          | Type-only modules: the vendored `ws.d.ts` contract and the internal event maps, option records, and status unions. A public type is declared in one place and re-exported, never restated per module.                                                                                                                                                                                                                                                                                                                                                                    |
| `src/protocol/`       | `close-codes.ts`, the RFC 6455 close codes and their predicates. Framing and backpressure policy live in Zig, so there is nothing else here.                                                                                                                                                                                                                                                                                                                                                                                                                             |

## The two routes

Two paths carry a frame to a peer. Both go through `src/binding/`, and past that
they share no code.

**The codec route is the public one.** Node's `http.Server` answers the `upgrade`,
`src/compat/server/upgrade.ts` adopts the `Duplex`, and a Zig codec behind a
Node-API handle does the framing for bytes read from and written to that stream.
`src/compat/socket/attach.ts` and `codec-inbound.ts` feed it, `codec-send.ts` and
`codec-outbound.ts` drive it, and the client route (`src/compat/client/dial.ts`)
uses the same codec over `http.ClientRequest`.

**The engine route is the µWebZockets one.** The engine binds its own listener and
routes its own `WebSocket` over the server and socket handles in
`src/binding/{server,socket}.ts`. It is reached only from `tests/binding/`,
`tests/autobahn/`, and `bench/`: the public `ws` surface cannot use it, because
the engine's `WebSocket` holds a `*TcpConnection` carved from a startup slab and
admits no adopted socket.

[docs/adr/0001-transport-and-framing-ownership.md](docs/adr/0001-transport-and-framing-ownership.md)
records why the split falls where it does, including the rejected alternative of
putting the engine under the upgrade path.

## Lifetime rules

1. **No engine pointer outlives the call that produced it.** A slab, a ring, or a
   handle table is owned by the module that carved it; the only thing that crosses
   is a generation-checked handle or a `Buffer` the callee copies. That is what
   makes a stale call a typed `invalid-handle` instead of a use-after-free.
2. **A buffer handed to `send` is borrowed for the call only.** The engine copies
   the bytes into its staging ring before returning, so retaining or freeing the
   `Buffer` afterwards changes nothing, and the engine never holds a JavaScript
   allocation across a return.

What a handler sees is already a copy, so retaining `data` after a `message`
callback is safe, exactly as it is in `ws`.

## Data flow

Inbound, codec route:

1. `Duplex` read in `src/compat/socket/codec-inbound.ts`
2. `feedCodec` in `src/binding/codec.ts`
3. `codec_feed` in `src/engine/ffi/codec_io.zig`
4. `ingest` and the `driver` feed loop in `src/engine/codec/`
5. decoded events in `src/engine/codec/events_store.zig`
6. `selectCodecEvent` and `takeCodecEvent` in `src/binding/codec.ts`
7. `deliver` in `src/compat/socket/codec-events.ts`
8. `emitEvent` in `src/compat/events/emitter.ts`

Outbound, codec route:

1. `sendData` in `src/compat/socket/send.ts`
2. `sendFramed` in `src/compat/socket/codec-send.ts`
3. `writeFrame` in `src/compat/socket/codec-outbound.ts`
4. `encodeCodecFrame` in `src/binding/codec-encode.ts`
5. `codec_encode` in `src/engine/ffi/codec_encode.zig`
6. `encode` in `src/engine/codec/encode.zig`
7. `Duplex` write

On the engine route both lists are the engine's own read and write path:
`src/engine/server/inbound.zig` stages into `src/engine/socket/queues.zig`,
`src/binding/inbound.ts` takes the message out, and outbound staging in
`src/engine/socket/payload.zig` is published by `src/engine/ffi/socket_pump.zig`
to the per-connection topic in `src/engine/server/topic.zig`.

## Ownership

| Concern                          | Owner      | Rule                                                                          |
| -------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| Public API shape and defaults    | TypeScript | Mirrors `ws`; validated before any native call                                |
| Option validation                | TypeScript | Explicit per-field checks; no coercion of untrusted input                     |
| Connection and parser state      | Zig        | Fixed-capacity slabs owned by the module that carved them                     |
| Frame assembly, masking, UTF-8   | Zig        | `src/engine/codec/`, with the bounds check in the same language as the buffer |
| Outbound queues and backpressure | Zig        | Bounded; overflow reports a typed status instead of allocating                |
| Message payloads observed by JS  | Node       | Copied into a Node-owned `Buffer` before a handler runs                       |
| Event dispatch                   | TypeScript | Explicit listener arrays; no emitter inheritance                              |
| Transport, upgrade, client dial  | Node       | `node:http`, `node:net`, `node:tls`; the `ws` drop-in property depends on it  |

Every value crossing the boundary is a primitive, a slice the callee copies, or a
status ordinal. Numeric statuses are mapped to the `EngineStatus` union in
`src/types/status.ts` before they reach a consumer, and a new member turns
`applySendStatus` in `src/compat/socket/send.ts` into a type error rather than a
silent no-op.

## Capacities

Every one is a `comptime` constant, so it is a property of the build. The seven
the engine route exposes to JavaScript are read by `engineLimits()` in
`src/binding/server.ts` and typed by `src/binding/native-limits.ts`; the rest are
internal to the module that declares them.

| Constant                           | Value      | Declared in                           | Why that number                                                                                                                                       |
| ---------------------------------- | ---------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message_capacity`                 | 65536      | `src/engine/server/capacities.zig:7`  | The conformance suite's largest group-1 payload, so nothing it asks for is above the cap                                                              |
| `frame_capacity`                   | 65536      | `src/engine/server/capacities.zig:10` | A frame can never exceed a message, so it tracks it                                                                                                   |
| `write_queue_capacity`             | 131072     | `src/engine/server/capacities.zig:14` | A maximum frame plus its header; equal to `message_capacity` the header has nowhere to land and the payload is dropped                                |
| `connection_capacity`              | 128        | `src/engine/server/capacities.zig:4`  | The per-connection footprint is the message slab plus the write queue, so this is the main memory knob                                                |
| `inbound_slots`                    | 64         | `src/engine/server/instance.zig:42`   | The burst budget: the engine cannot stop reading once a consumer falls behind, so this is 4 MiB per server at the cap                                 |
| `outbound_slots` (`payload_slots`) | 8          | `src/engine/server/instance.zig:36`   | An outbound payload is taken by the pump that staged it, so the ring only has to outlast one write                                                    |
| `message_floor`                    | 8192       | `src/engine/codec/capacities.zig:8`   | A codec's first reassembly allocation, paid by every connection that ever exists, so too large costs the floor and too small only costs reallocations |
| `outbound_floor`                   | 1024       | `src/engine/codec/capacities.zig:11`  | The first frame buffer; a frame is sized to the message on the first `encode`, so this only covers the small frames that dominate                     |
| `control_slots`                    | 8          | `src/engine/codec/capacities.zig:14`  | One 64 KiB socket read, Node's default high-water mark; a peer past it gets backpressure rather than a dropped ping                                   |
| `max_message_bytes`                | 4294967295 | `src/engine/codec/capacities.zig:5`   | The ceiling on `maxPayload`, which is a number width and not a buffer: a codec's buffers are runtime-sized and grow into it                           |
| `initial_boundaries`               | 16         | `src/engine/codec/fragments.zig:11`   | Reserved fragment boundaries before a peer has fragmented anything, 64 bytes per connection                                                           |
| `max_fragments`                    | 16384      | `src/engine/codec/capacities.zig:17`  | Matches `ws`'s default, which `ws` treats as a policy failure closed with 1008                                                                        |

`maxPayload` moves none of them. It sizes a codec's runtime buffers, and
`max_message_bytes` is the only bound it meets. `maxFragments` is measured against
`max_fragments`, and its allocation starts at `initial_boundaries` and doubles, so
a peer that never fragments costs 64 bytes.
