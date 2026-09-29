# Security Policy

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

## Supported versions

| Version                                | Supported                                    |
| -------------------------------------- | -------------------------------------------- |
| `main`                                 | Yes                                          |
| Any published release                  | None; releases are pre-alpha and unsupported |
| Anything older than the current `main` | No                                           |

ventiws is pre-alpha, so a fix lands on `main` and is not backported. A consumer
who pins a commit has to apply the patch themselves, and gets no coverage on a
platform CI does not build, which today means everything but Linux.

## Threat model

The application embedding ventiws is trusted; network peers are not. The
attacker-controlled surface is the same as a raw WebSocket server: the HTTP
upgrade request including its headers, extensions, and path; every frame
including fragmentation, control frames, masking keys, and claimed payload
lengths; compressed payloads when per-message deflate is negotiated; and
connection churn, idle peers, and traffic volume. Constructor options come from
trusted code and are validated anyway, so a misconfiguration produces an error
rather than undefined engine behavior.

## Security boundaries

The Zig engine parses and frames all untrusted bytes and never exposes engine
slabs, pointers, or offsets to JavaScript. Two lifetime rules are the
memory-safety contract at the FFI boundary. An outbound buffer is borrowed only
for the duration of the native call and copied into the bounded outbound queue
before it returns, so retaining or freeing the `Buffer` afterwards changes
nothing. An inbound payload is copied into a Node-owned `Buffer` inside
`takeSocketMessage`, which the engine reuses for the next frame, so the returned
buffer is safe to retain past the handler and a caller that mutates it cannot
reach the engine, which `tests/binding/socket-echo.test.ts` exercises against a
real client.

Every native handle packs a generation counter into the same word as its state
(`src/engine/socket/handles.zig`), so a handle used after close, or after its slot
is reused, resolves to a typed error, and completion callbacks latch terminal
state before dispatch so `close` fires exactly once under teardown races. Three things are deliberately absent: no `eval` and no `new Function`,
no network fetch of a build artifact (`src/binding/load.ts` resolves the addon
from the installed package layout only), and no extension callback that runs
arbitrary JavaScript from an engine thread. Each rule's evidence test is named in
[COMPATIBILITY.md](COMPATIBILITY.md#boundary-and-lifetime-invariants).

## Resource limits

Every engine capacity is a `comptime` constant, so it is a property of the build
and no JavaScript option raises it. [CODEBASE.md](CODEBASE.md#capacities) gives
each constant, its value, its file, and the reason for the number;
[COMPATIBILITY.md](COMPATIBILITY.md#engine-capacity-limits) says which socket
route each one binds. Two of them bound the engine's memory rather than one
message: a connection past the per-server cap is terminated on open, and a burst
larger than the inbound ring is dropped and counted by `serverDroppedMessages`,
because the engine cannot stop a read its consumer has not drained. Every
outbound queue is bounded, so a producer that ignores backpressure cannot grow
memory without limit.

## Dependency policy

The published package declares no npm runtime dependency. The addon is
self-contained: µWebZockets is the first-party engine and `napi-zig` the only
third-party runtime component, both pinned by hash in `build.zig.zon`, and the
engine vendors BoringSSL, lsquic, libdeflate, zlib, and the rest of its own
dependencies; [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) records every
revision and license. Do not add one the standard library or the engine already
provides.

## Verification

[CI_CD_PIPELINE.md](CI_CD_PIPELINE.md) lists every workflow and what each gates
on, on `ubuntu-24.04` only. The conformance suite compares `ws` and ventiws on
the same scenarios. The Autobahn harness is a CI job (`autobahn.yml`), gated
against the committed known-failure baseline, and a case above the engine's
compiled message capacity is reported as `skipped-capacity` rather than as a
pass, so a capacity gap cannot read as conformance. The recorded run is in
[COMPATIBILITY.md](COMPATIBILITY.md#rfc-6455-conformance).

No gate establishes the absence of defects. Pin an exact version, review the
shipped licenses, and load-test under your own workload before deploying.

## Disclosure

Please allow a reasonable remediation and release window before publication.
Security advisories credit reporters who ask for attribution, and describe
affected versions, impact, and upgrade guidance without exposing exploit detail
before a fix is available.
