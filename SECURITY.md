# Security Policy

## Supported versions

Security fixes apply to the current development revision and the latest
published release. Older snapshots and unreleased local builds do not receive
backports.

| Version                      | Supported |
| ---------------------------- | --------- |
| Current development revision | Yes       |
| Latest published release     | Yes       |
| Older tagged releases        | No        |

## Reporting a vulnerability

Do not open a public issue, pull request, or discussion that contains an
undisclosed vulnerability.

Send a private report to
[trananhquan1009@gmail.com](mailto:trananhquan1009@gmail.com) or
[noah1109.tran@gmail.com](mailto:noah1109.tran@gmail.com). Include:

- the affected revision, Node.js version, and target platform;
- a minimal reproducer, packet sequence, or frame hex dump;
- expected and observed behavior;
- impact and preconditions;
- logs with secrets removed; and
- any suggested mitigation.

The maintainers will acknowledge the report, reproduce and assess it, prepare a
fix and regression test, and coordinate disclosure. Response time depends on
severity and maintainer availability; no fixed service-level agreement is
offered.

## Threat model

The application embedding ventijs is trusted. Network peers are untrusted. The
attacker-controlled surface is the same as a raw WebSocket server:

- the HTTP upgrade request, including headers, extensions, and path;
- every WebSocket frame, including fragmentation, control frames, masking keys,
  and claimed payload lengths;
- compressed payloads when per-message deflate is negotiated;
- connection churn, idle peers, and traffic volume.

Application code passing options to the constructors is trusted. Config values
are still validated explicitly, because accidental misconfiguration should
produce a clear error rather than undefined engine behavior.

## Security boundaries

The Zig engine parses and frames all untrusted bytes, and never exposes engine
slabs, pointers, or offsets to JavaScript. The two lifetime rules below are the
memory-safety contract at the FFI boundary.

Outbound buffers are borrowed only for the duration of the native call and
copied into the bounded outbound queue before it returns.
`tests/binding/socket.test.ts` asserts that copy.

Inbound payloads are copied into Node-owned `Buffer` instances inside
`takeSocketMessage`, and the engine's own message buffer is reused for the next
frame, so the copy is the only copy and the returned buffer is safe to retain
past the handler. `tests/binding/socket-echo.test.ts` exercises it end to end
against a real client. The residual risk is the reverse direction: a caller that
mutates the returned `Buffer` cannot affect the engine, because the ring slot is
already freed.
[COMPATIBILITY.md](COMPATIBILITY.md) records the state of both.

Every native handle carries a generation counter. A handle used after close, or
after its slot is reused, resolves to a typed error. Completion callbacks latch
terminal state before dispatch, so `close` fires exactly once even under
teardown races.

The public surface deliberately excludes features that would widen the attack
surface without a compatibility requirement:

- no synchronous extension callbacks that run arbitrary JavaScript from an
  engine thread;
- no runtime code loading, `eval`, or `new Function`;
- no remote artifact fetching. The native addon is resolved from the installed
  package layout only.

## Resource limits

Deployments must size the engine for their traffic and apply normal operating
system limits such as file descriptors and memory caps. The compatibility layer
records the `ws` options that describe limits, and the engine enforces the
capacities it was compiled with:

- `maxPayload` is validated and recorded but not yet read, so it is not a limit
  today. The limit that applies is the engine's compiled
  `message_capacity = 32 * 1024` in `src/engine/server/options.zig`, a
  `comptime` constant baked into the addon. An oversized frame is closed by the
  engine with code `1009` and no fallback buffer is allocated.
- Outbound queues are bounded. When a queue reaches its high-water mark, the
  engine reports backpressure and `bufferedAmount` reflects the queued bytes;
  `send` returns no value, matching `ws`. Producers that ignore backpressure
  cannot grow memory without bound.
- Planned: idle connections swept by a configurable timeout. Until that option
  lands, deployments must rely on their own liveness checks.
- Per-message deflate is normalised and never negotiated, so no compressed
  payload is accepted today. When negotiation lands it requires
  no-context-takeover, and decompression has to be capped by the negotiated
  message capacity so a compressed expansion bomb cannot exceed it.

## Dependency policy

The published package has exactly two runtime dependencies: `napi-zig` and
`uWebZockets`. Both are pinned exactly. The engine vendors BoringSSL, lsquic,
zslay, libxev, libdeflate, and related components; their revisions and licenses
are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Engine updates
require a fresh native build, the full `ws` conformance suite, and the Autobahn
gate before release.

Do not add a runtime dependency for functionality the standard library or the
engine already provides. Development tooling is not shipped and is excluded
from the published tarball.

## Verification

CI builds and executes the addon on `ubuntu-24.04` only. The matrix in
[CI_CD_PIPELINE.md](CI_CD_PIPELINE.md), covering Linux, musl, macOS, and
Windows, is the target and no other runner executes the artifact today, so no
claim of platform coverage is made here. The compatibility suite runs the same
scenarios against `ws` and ventijs and compares observable behaviour. The
Autobahn harness exists in the tree and is not a CI job yet; it probes the
target before it runs, and it is capacity-scoped, because 128 of the 517
selected cases exceed the engine's 32 KiB message limit and are reported as
`skipped-capacity` rather than as passes. These controls reduce risk; they do
not guarantee the absence of defects. Consumers should pin an exact version,
review the shipped licences, and load-test under their own workload before
production deployment.

## Disclosure

Please allow a reasonable remediation and release window before publication.
Security advisories will credit reporters who request attribution and will
describe affected versions, impact, and upgrade guidance without exposing
unnecessary exploit detail before a fix is available.
