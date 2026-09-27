# ventijs CI/CD Pipeline

The pipeline verifies formatting, type safety, `ws` compatibility, RFC 6455
protocol behavior, native addon builds for every supported target, and release
metadata. A passing pipeline is evidence for the tested configurations; it is
not a proof that all memory or security defects are absent.

## Current state

The pipeline is implemented incrementally. `ts-lint.yml`, `zig-lint.yml`,
`nix-lint.yml`, `ts-test.yml`, and `zig-test.yml` are wired; the workflows marked
planned below are the contract for the remaining changes. Until they land,
contributors run the same commands locally as described in
[CONTRIBUTE.md](CONTRIBUTE.md).

## Workflows

| Workflow       | State       | Trigger                                                      | Purpose                                                       |
| -------------- | ----------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| `ts-lint.yml`  | Implemented | pushes and pull requests to `main`, manual                   | oxlint, oxfmt, typecheck                                      |
| `zig-lint.yml` | Implemented | pushes and pull requests to `main`, manual                   | `zig fmt` and the Zig build graph                             |
| `zig-test.yml` | Implemented | pushes and pull requests to `main`, manual                   | `zig build test` units and the binding lifecycle suite        |
| `nix-lint.yml` | Implemented | pushes and pull requests to `main`, manual                   | Nix formatting and flake checks                               |
| `ts-test.yml`  | Implemented | pushes and pull requests to `main`, manual                   | vitest unit, boundary, and registry tests without the addon   |
| `native.yml`   | Planned     | pushes and pull requests to `main`, manual, reusable         | Build and test the `napi-zig` addon on the native matrix      |
| `autobahn.yml` | Implemented | Zig, harness, and lockfile changes to `main`, weekly, manual | RFC 6455 conformance, sharded and incrementally skipped       |
| `perf.yml`     | Implemented | Zig and benchmark changes to `main`, nightly, manual         | Regression guard against the `main` baseline and `ws`         |
| `publish.yml`  | Planned     | `v*` tag push                                                | Verification, prebuild packaging, npm release with provenance |

Every workflow runs against the Node.js version pinned in `flake.nix`. The
pnpm store and the Zig cache are cached per lockfile hash; caches are never
shared between the candidate and baseline benchmark jobs.

## Lint and type gates

```sh
pnpm lint
pnpm format:check
pnpm typecheck
zig fmt --check --exclude zig-pkg src build.zig
nix fmt --check
```

`oxlint` enforces the repository rules that are mechanically checkable: no
`class`, no `this`, no `extends`, no prototype mutation, no unchecked `any`,
and no import of a runtime dependency outside `napi-zig` and `uWebZockets`.
`oxfmt` formats TypeScript, JSON, and Markdown. `tsc --noEmit` runs in the
strict configuration in `tsconfig.json`; weakening a compiler option is a
review-blocking change. `zig fmt` is authoritative for all `.zig` files.

`scripts/check-conventions.mjs` complements the linters (it runs inside
`pnpm lint` and as a `lefthook` job): it rejects `src/` and `tests/` files above
the 150-line module budget, rejects `camelCase` Zig function names, rejects
non-kebab-case TypeScript file names, and rejects emoji code points. The
vendored `src/types/ws.d.ts` and non-text files are excluded.

## Unit and build verification

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
```

`pnpm build` proves the `tsdown` bundle and declaration output compile from a
clean checkout. Tests run in vitest and cover option normalization, close-code
mapping, event dispatch ordering, boundary lifetime rules, and capacity
exhaustion. The build job uploads `dist/` and the generated `.d.ts` bundle so
reviewers can inspect the published type surface without building locally.

`ts-test.yml` runs without the native toolchain, so it cannot run a suite that
builds a WebSocket: the frame codec is in the addon, so a facade socket cannot be
attached without one. It names the two trees that provably do not need it:

```sh
pnpm exec vitest run tests/protocol tests/compat/options
```

The paths are an inclusion list rather than the exclusion list this used to be,
because an exclusion list is a claim about every file in the repository and it went
stale as soon as the codec landed: a new suite that needed the addon failed in the
wrong job, on a missing addon, which reads as a broken test rather than a misplaced
one. An inclusion list only needs editing when a suite genuinely stops needing one,
and a suite added anywhere else lands in the job that has the addon.

`zig-test.yml` runs two jobs with the same toolchain and cache: units
(`zig build test`, compiling `src/engine_tests.zig` and the per-module suites
under `src/engine-tests/`, mirroring the `src/engine/` planes) and the
addon-backed suite, which runs `pnpm build:binding`, checks the built declarations
with `pnpm exec tsdown && pnpm run typecheck:dist`, and then runs the whole
vitest suite:

```sh
pnpm exec vitest run --no-file-parallelism
```

so every suite `ts-test.yml` leaves out is covered here, and no file list here can
disagree with the one there. Both jobs cache `.zig-cache` and `zig-pkg` between
runs. Neither installs a vendor C toolchain: the engine compiles
BoringSSL, lsquic, libdeflate, and zlib itself from pinned package sources.

## Native addon matrix

The native workflow builds the `napi-zig` addon with Zig 0.16.0 and runs the
integration suite against the compiled artifact. Cross-compilation is the
default; a target without a native runner is built and packaged, then executed
only where a runner exists.

| Target                | Runner             | Executed                    |
| --------------------- | ------------------ | --------------------------- |
| `x86_64-linux-gnu`    | `ubuntu-24.04`     | Yes                         |
| `aarch64-linux-gnu`   | `ubuntu-24.04-arm` | Yes                         |
| `x86_64-linux-musl`   | `ubuntu-24.04`     | Yes, in an Alpine container |
| `aarch64-linux-musl`  | `ubuntu-24.04-arm` | Yes, in an Alpine container |
| `x86_64-macos`        | `macos-14`         | Yes                         |
| `aarch64-macos`       | `macos-14`         | Yes                         |
| `x86_64-windows-msvc` | `windows-2025`     | Yes                         |

Each job runs the full vitest suite against the built addon, not a stub. A job
that cannot load its own artifact fails the workflow.

## `ws` behavioral conformance

The compatibility job installs the pinned `ws` version as a dev dependency and
executes the shared conformance suite twice: once against `ws` and once against
ventijs. The suite covers:

- server construction options and defaults;
- upgrade handling, accepted and rejected handshakes;
- text, binary, and fragmented messages, including empty payloads;
- `ping`/`pong` and automatic pong replies;
- close codes, reasons, and exactly-once `close` emission;
- `maxPayload` enforcement and `1009` behavior;
- `bufferedAmount` and `send` return values under backpressure;
- per-message deflate negotiation, including declined and malformed offers.

Both runs must produce the same normalized event transcript. A divergence is a
failure; an intentional divergence requires an explicit exclusion entry with a
linked issue and cannot be merged silently.

## Autobahn RFC 6455 compliance

The harness is `node tests/autobahn/run.ts`, or `pnpm test:autobahn`. It
deliberately does not run on Deno, which is worth recording because the idea is
reasonable and was measured.

Deno is the better fit in principle: this harness spawns a WebSocket server,
spawns Docker, reads and writes a report directory, and reads two environment
variables, so it would run under exactly
`--allow-run --allow-read --allow-write --allow-env` instead of with the whole
filesystem, and `denoland/setup-deno` would install it in the workflow without
taxing the dev shell, which has never had Docker either.

The engine does not run under Deno. Measured in `autobahn.yml`:

- the addon loads: a preflight that only `require`s it and prints the engine
  version succeeds under Deno 2.x, so `dlopen` and the N-API surface are fine;
- the threadsafe function works: the `listening` event arrives in JavaScript, so
  the engine thread started, bound the listener, and the cross-thread callback
  path is intact;
- the connection then never completes. The probe records `handshake: false` and
  a 1006 close, meaning the listener socket existed but nothing ever served the
  connection, and even the over-limit probe that the engine answers with 1009 on
  Node gets 1006.

So the bridge works and the engine's event loop does not. Deno publishes no musl
build, which also means this cannot be diagnosed on a musl host at all, since a
locally built addon is musl and the only available Deno is glibc. The port was
reverted and the harness stays on Node, which keeps it on the same addon-loading
path `tests/binding/**` already exercises.

A preflight step runs first: `tests/autobahn/preflight.ts` loads the addon and
prints the engine version. It costs about five seconds and it is the only
pre-suite failure mode that would otherwise be discovered after 21 minutes of
suite time.

The reference is digest-only. The `crossbario/autobahn-testsuite` repository
publishes exactly two tags, `latest` and `25.10.1`, and both resolve to that
digest; there is no `0.8.2` tag, so a tag-and-digest reference is unpullable and
the job would fail at `docker run` rather than at a protocol assertion. Dropping
the tag loses no information, because the two published tags are the same
manifest.

The configuration selects groups 1-7 and 9-13 with no case exclusions, which is
517 cases. The gate holds the run to that total, to the capacity-blocked count, to
the evaluated count, and to a recognised `behaviorClose` vocabulary, so a
truncated or foreign report fails rather than passing quietly. Any failed,
missing, additional, or reclassified case outside `tests/autobahn/baseline.json`
fails the job. `NON-STRICT` is tolerated, and that is the rule the reference
implementation forces: the 517-case `ws` report classifies 6.4.1 through 6.4.4 as
`NON-STRICT`, because the specification is genuinely ambiguous for a UTF-8
handling edge there. A gate that fails on `NON-STRICT` therefore fails `ws`
itself, which cannot be the contract.

### What the job costs, and what was cut

Two runs of this job, six commits apart, and the difference is the whole story.

Before the engine work, the suite step took **2100s** of a 37-minute job. The
suite was 92 per cent of it, and the conclusion recorded here was that nothing on
this side could reduce it, because the target answers a connect, echo, and close
in 0.42 ms and the four seconds per case was inside `wstest`, which is Python.

That conclusion was right about the cause and wrong about the fix. The report's
own per-case `duration` sums to **12 seconds across all 301 cases**, and it did
not come close to 2100s before either. The field spans `caseStart` at `onOpen` to
`caseEnd` at `connectionLost`, so it excludes the TCP connect and the opening
handshake the client does per case. What the 2100s actually was: **failing cases
waiting on the client's close-handshake timeout.** 229 of 517 were failing, and a
case that waits for a timeout costs a timeout.

So the order of the two fixes is the opposite of what this section previously
claimed. The engine fixes took 97 of the 257 evaluated framing cases from failing
to passing, which removed the timeouts that were the cost, and the suite step
fell to **14s**. Sharding is real and it is kept, but on this evidence it is the
smaller of the two: 301 cases as four concurrent clients finish in 14s, so the
same work unsplit is on the order of a minute, and sharding is worth tens of
seconds rather than the twenty minutes the previous revision of this file
claimed.

Measured step timings now: setup 21s, Zig cache restore 8s, install 2s, **addon
build 175s**, image pull 18s, **suite 14s**. The build is the bottleneck and the
suite is a rounding error, which inverts the only remaining lever worth
discussing. The build is ~175s because the runner restored a cache whose key no
longer matched and rebuilt; `zig build` against a warm `.zig-cache` is seconds.
A two-tier cache that stores only `zig-out/lib/ventijs.node` under a key hashing
every Zig source would skip both the 10s restore and the build on a hit, and
`src/binding/load.ts` looks for that file first, so the path is real. It was
dismissed earlier in this file as near-inert, on the reasoning that a key hashing
the Zig sources can only hit when no Zig file changed, and the job only runs when
one did. That reasoning was about the suite's share of the job; with the suite at
14s the build is 77 per cent of it, and the same argument no longer decides
anything. Worth doing, and deliberately not done in the same change as a protocol
fix that needs a recorded run.

So the suite cost, in order of effect:

1. **Stop failing.** A case that fails waits for a timeout; a case that passes
   does not. This is why the previous section's arithmetic -- 2086s for 301
   framing cases, 2100s for all 517, therefore 6.93s per framing case -- produced
   a number that turned out to be wrong by a factor of 36. It was derived from two
   runs in which most cases failed, so it measured the timeout, not the case.
2. **Shard inside one job.** Four concurrent fuzzing clients against four targets,
   paying setup, the build, and the pull once. A matrix of N _jobs_ would cut the
   same wall clock at the cost of building the addon N times, so it was rejected on
   total runner minutes. On this evidence the saving is tens of seconds, and the
   real reason to keep sharding is that it is already written, already tested, and
   scales with the suite if the case count grows.
3. **Skip a push that cannot change the answer.** The `gate` job below. This is
   the largest remaining win by a wide margin, and it is free.

The partition is safe by construction rather than by tuning. A shard owns **whole
groups** and selects `N.*`, so the union of every shard is provably the same case
set one unsplit configuration selects, and the union is a concatenation rather
than a merge by case id, so an overlapping shard surfaces as a `count-total`
violation instead of being deduplicated into a pass. A mispriced weight therefore
costs wall clock and nothing else, because the gate still holds the run to the
mode's totals: 301/44/257 in `framing`, 517/128/389 in `full`.

The ceiling is group 6, which is 145 of the 301 framing cases. At any shard count
up to ten it lands whole on one shard, so the critical path cannot go below about
48 per cent of the selection and four shards buy roughly 2x rather than 4x. The
`cases` patterns are whole groups precisely so coverage stays provable, so beating
this needs the suite's per-sub-group case counts, which are not in this
repository. `tests/autobahn/cost-rollup.ts` publishes the measured per-group case
count and duration on every run, so those counts are now data rather than a
derivation -- and the first run showed the derivation was wrong: group 6 is 145
cases, not the 91 the case expansion suggests, and group 9 is 54, not 108. Only
the totals had matched.

Two things tried and rejected:

- **Reducing the client's timeouts.** `openHandshakeTimeout` and
  `closeHandshakeTimeout` are settable through the spec's `options` block, and
  lowering them is exactly the lever the measurements above say the old cost came
  from. It is also the one change here that would corrupt the signal: those timers
  are what turn a non-conformant close into a `FAILED` rather than a silent pass.
  Making the suite fast by shortening the detection of failure is not a speedup.
  Rejected.
- **Excluding the capacity-blocked cases.** Tempting, since they are a large share
  of the selection, and wrong twice over. The gate requires `counts.capacity` to
  be 44 in `framing`, and the blocked set is decided by case id alone, so dropping
  them would break the count contract and hide exactly the frame-and-payload-limit
  gap the baseline records for group 1. Rejected.

### Skipping a push that cannot change the answer

`paths` is necessary and not sufficient. For a `pull_request` GitHub evaluates it
against the **whole pull request diff**, not the incremental push, so a branch that
already touched the engine re-runs the job on every later commit however
unrelated that commit is, and the `concurrency` block above only bounds the waste
by cancelling the loser.

The `gate` job closes that. It checks out full history, reads the commit the suite
last ran on the same ref out of a cache, and diffs against it. Nothing
engine-relevant in that delta, and the suite is skipped. The decision is a
separate job rather than a conditional step on purpose: a skipped _step_ inside
the suite job renders that job green, indistinguishable from a pass, while a
skipped _job_ renders grey with the reason in the checks UI and the required check
is still satisfied.

It fails toward running on every uncertainty. No watermark, an unreadable history,
a `schedule` or `workflow_dispatch` event, and a watermark that is no longer an
ancestor of HEAD all measure. The job also seeds `run=true` into `$GITHUB_OUTPUT`
before the script runs, because a _failing_ dependency reports as skipped rather
than failed, which is indistinguishable from a deliberate skip, and the seed is
the only thing that distinguishes them. The watermark is written on success only,
so a red run is retried on the next push rather than recorded as tested.

The cost is about 25 seconds and no toolchain beyond Node: a checkout with full
history and a `git diff`. On a live engine branch every later facade-only or
docs-only push drops from about 15 minutes to about 25 seconds.

### Harness fixes this needed along the way

- `startTarget` read its port from a process-global environment and tracked one
  child in a module singleton, so it could not be called once per shard. It is now
  a factory over an explicit address, and the environment override applies only to
  the default address, because honouring one global override would have started
  every shard on the same port.
- An interrupted run orphaned the `wstest` container. `--rm` only fires when a
  container _stops_, so a SIGINT or the job timeout left it running and writing
  into a report directory the next run deletes. Containers are named and force
  removed. The SIGINT path is a race rather than a guarantee: `process.exit` runs
  from the target module's handler and the `docker rm` spawns are not awaited, so
  the removal is left to complete as an orphan, which it does in practice.
- The shards settle rather than race. One unreadable report used to discard the
  other three through `Promise.all`; it is `allSettled`, and a rejected read
  becomes a named failed shard.
- `classifyCase`'s comment claimed the opposite of what the code did, which
  mattered more once a run could be short by a whole shard.
- `AUTOBAHN_SHARDS` was validated in three places with three rules, and the
  step whose job is to validate the plan had the weakest: 99 printed a four-shard
  plan and exited zero, and the suite then died. One resolver now bounds it by the
  mode's own group count, because a shard with no groups runs no cases and can
  never satisfy the count check.
- The `gate` job's shard-count ceiling and the workflow's `paths` filter are held
  to each other by `tests/autobahn/diff-gate.test.ts`, so a path added to one and
  not the other fails rather than silently skipping a push the filter runs.

The other two things that were tried and rejected:

- **Reducing the client's timeouts.** `openHandshakeTimeout` and
  `closeHandshakeTimeout` are settable through the spec's `options` block, and
  lowering them would cut the suite substantially. That is the one place where a
  speedup would corrupt the signal: those timers are what turn a non-conformant
  close into a `FAILED` rather than a silent pass. Rejected.
- **Excluding the 128 capacity-blocked cases.** Tempting, since they are most of
  the runtime, and wrong twice over. The gate requires `counts.capacity` to be 44
  in `framing`, and the blocked set is decided by case id alone, so dropping them
  would break the count contract and hide exactly the frame-and-payload-limit gap
  the baseline records for group 9. Rejected.

The addon build is about two to four minutes against a warm cache and is close to
irreducible for a genuine Zig change: the change ripples through the engine module
graph and relinks a 10 MB binary against BoringSSL, lsquic, libdeflate, and zlib,
and `--release=safe` is the conformance contract. The job's `timeout-minutes` is
45 for the cold path rather than the warm one, because the Zig cache key hashes
`build.zig`, `build.zig.zon`, and `src/builds/**`, and a change to any of them with
no prefix fallback available compiles all four vendored archives from source.

### The known-failure baseline

The first full run, on commit `47bfc68`, produced: **517 cases, 128
capacity-blocked, 160 of 389 evaluated cases passed, 229 failed.** Those 229 are
committed to `tests/autobahn/baseline.json`, grouped by cause:

| Group | Cases | Cause                                                              |
| ----- | ----- | ------------------------------------------------------------------ |
| 13    | 77    | `permessage-deflate` is normalised but never negotiated            |
| 12    | 55    | `permessage-deflate` is normalised but never negotiated            |
| 6     | 70    | UTF-8 handling across the incremental decoder                      |
| 9     | 12    | Frame and payload limits are not enforced as the suite expects     |
| 5     | 8     | Fragmented messages are not reassembled                            |
| 1     | 6     | Invalid or partial UTF-8 in a text frame is not rejected with 1007 |
| 7     | 1     | A close-handshake edge is not conformant                           |

This is a regression gate, not an exclusion list, and the distinction matters. A
failure outside the baseline fails the run, so nothing can regress into silence.
A baseline entry that starts passing is reported and fails the run until it is
removed, so the list can only shrink. Every case is still classified, counted, and
written to the report; nothing is hidden from the arithmetic. What the baseline
records is "the engine does not do this yet", with a reason per group, in a file
that a reviewer can read and a contributor can shrink.

The alternative was either a job that is red on arrival and stays red, which
teaches contributors to ignore it, or a narrowed case selection that would hide
exactly the gaps this suite exists to find.

`CLOSURE_OK_CASES` and `CLOSURE_INFORMATIONAL_CASES` were removed as gate
conditions for the same reason. Those 514 and 3 are the `behaviorClose` split of
the fully conformant `ws` reference; holding ventijs to them asserts that all 389
evaluated cases pass, which is the per-case gate's job rather than a property of
the report's shape. The reference numbers are still printed in the run summary as
context.

Of the 517 cases, 128 are capacity-blocked and 389 are evaluated. The engine is
compiled with a 32 KiB `message_capacity` in `src/engine/server/capacities.zig`, a
`comptime` constant no harness can raise, so the blocked set is 7.1.6, 9.1
through 9.6, 10.1.1, and the seven oversized payload rows of each of groups 12
and 13. Each blocked case is reported as a distinct `skipped-capacity` outcome
with its byte size, not as a pass and not as a failure. Groups 5 and 6 use small
fragments and are not capacity-blocked. HTML and JSON reports are uploaded even
when the gate fails.

## Benchmark

The harness is `pnpm bench`, which runs `node bench/index.ts`. It drives `ws` and
the ventijs native engine through one shared echo path, so the server is the only
variable between the two rows of the report. The ventijs leg is the native
engine rather than the `ws`-shaped facade, because the facade's HTTP upgrade path
does no RFC 6455 framing yet and would measure a handshake that never becomes a
message. The `ws` client drives both legs, because ventijs client construction
still throws `ERR_INVALID_STATE`.

1. Start a `ws` echo server and the equivalent ventijs echo server.
2. Run the same bounded client workload against each: one connection, fixed
   message size, fixed round-trip count, measured with `node:perf_hooks`.
3. Repeat three times by default, discard the warm-up, and compare medians.
4. Write a JSON report carrying commit, Node.js, pnpm, Zig, lockfile, CPU and
   memory provenance, plus the raw samples behind every median.

`--gate` fails the run when ventijs's median falls below 90 percent of the `ws`
median, and also when a configuration could not be measured, so an unverified row
cannot read as a pass. The ten percent tolerance accounts for shared-runner
variance.

**The CI job does not pass `--gate` yet.** The first measurement with a working
engine drain put ventijs between 0.14 and 0.38 of `ws` on a shared
`ubuntu-24.04` runner, and between 0.57 and 0.66 of `ws` on an idle workstation.
The shared runner is several times slower for both legs, which is why the ratio
is the comparable figure and the absolute round-trip counts are not. Gating on that would report the project's
honest starting point as a regression against itself on every pull request, and
would train contributors to ignore the job. The job therefore uploads the raw
report as an artifact on every run, including failures, and the comparison is read
from the run rather than from a status. Enabling the gate is one flag on the
`Measure` step in `.github/workflows/perf.yml`, and it belongs there when the
engine reaches parity.

The payload matrix is capped at 32 KiB by the engine's compiled
`message_capacity`, and the harness rejects a larger `--sizes` entry rather than
comparing a missing capability against a speed. `ws` accepts far more, so a row
above the ceiling would not be a slower ventijs but an absent one.

Raw reports are uploaded as workflow artifacts; scheduled mainline runs append
canonical JSON plus raw evidence to the `benchmark-data` branch. Claims in
documentation may cite only retained runs and must state the runner and
toolchain.

## Publishing

A `v*` tag gates the release:

1. The tag must be valid Semantic Versioning and match `package.json`, the
   lockfile, and the latest changelog heading.
2. Lint, typecheck, unit, native matrix, and conformance workflows run against
   the exact tagged commit. Release creation waits for all of them.
3. Each native target is packaged with its prebuilt `.node` artifact. The npm
   tarball contains `dist/`, the platform addons, `LICENSE`,
   `THIRD_PARTY_NOTICES.md`, and the license texts for shipped native
   dependencies.
4. The release job requires every expected platform artifact, writes
   `SHA256SUMS`, and publishes with npm provenance from the tagged commit.
5. Versions containing a hyphen are published as prereleases; stable versions
   are tagged latest.

Releases are idempotent: rerunning the tag workflow replaces assets with the
same names and updates notes.

## Release checklist

- Bump via `pnpm release` and confirm every versioned surface agrees.
- Run lint, format, typecheck, unit, and build on the release commit.
- Run the native matrix and load every built addon on a real runner.
- Run the `ws` conformance suite and Autobahn with no exclusions.
- Run the benchmark and retain the report.
- Verify dependency revisions and `THIRD_PARTY_NOTICES.md` against shipped
  artifacts.
- Create and push `v<version>` only after the release commit is final.
- Inspect the packed tarball and generated checksums before announcing.
