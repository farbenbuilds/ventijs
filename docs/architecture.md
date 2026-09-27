# Architecture

A short orientation for someone new to the repository. It deliberately does not
restate the design, which
[CODEBASE.md](../CODEBASE.md) owns and keeps current; this page only says which
document answers which question.

## The one-paragraph version

ventijs wraps the first-party µWebZockets Zig engine in a Node-API addon and
exposes a `ws`-compatible TypeScript surface on top. Zig owns parsing, framing,
buffers, and backpressure. TypeScript owns option validation, the observable
event surface, and the generated declarations. The compatibility target is
[`ws` 8.21.3](https://github.com/websockets/ws) plus `@types/ws` 8.18.1, whose
API reference is vendored at [ventijs.md](ventijs.md), credited to the `ws`
authors at the top of that file.

## Where to look

| Question                                                    | Document                                               |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| What owns which file, and how does data cross the boundary? | [CODEBASE.md](../CODEBASE.md)                          |
| What is implemented, what is missing, and what proves it?   | [COMPATIBILITY.md](../COMPATIBILITY.md)                |
| Which `ws` API item maps to which ventijs module?           | [compliance-api.md](compliance-api.md)                 |
| Why an error carries the code it carries                    | [compliance-error-codes.md](compliance-error-codes.md) |
| What style is enforced, and by which tool                   | [CODING_CONVENTION.md](../CODING_CONVENTION.md)        |
| Which command runs which check                              | [CONTRIBUTE.md](../CONTRIBUTE.md)                      |
| What CI runs, and what each job gates on                    | [CI_CD_PIPELINE.md](../CI_CD_PIPELINE.md)              |
| What the engine's fixed capacities are, and who sets them   | [COMPATIBILITY.md](../COMPATIBILITY.md)                |

## The four layers

```text
src/index.ts          the public surface: re-exports only
src/compat/**         the ws-shaped facade: options, events, upgrade path
src/binding/**        the typed addon ABI: handles, statuses, threadsafe events
src/engine/**         the Zig engine: slabs, rings, the drain, the receiver
```

The rule that keeps the layers honest: an engine pointer never crosses into
JavaScript, and a JavaScript buffer is never retained by the engine. Anything a
handler sees is already a copy.

## The two things to know before reading the code

The engine is compiled with fixed capacities, most importantly a 32 KiB message
size and a 64-message inbound burst. They are `comptime` constants, so no
JavaScript option raises them, and they are the reason several Autobahn cases
and several benchmark payload sizes do not apply.
[COMPATIBILITY.md](../COMPATIBILITY.md) has the table.

The engine has no hook for stopping a read when its consumer falls behind, so a
burst larger than the inbound ring is dropped and counted rather than
backpressured. `serverDroppedMessages` reports it; it is not silent.
