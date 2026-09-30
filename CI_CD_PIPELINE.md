# ventiws CI/CD Pipeline

Nine workflows touch the repository. Seven gate a change, `bump.yml` advances
the version and pushes the release tag on a merge, and `publish.yml` publishes
a release. A passing pipeline is evidence for the configurations it exercised;
it is not proof that no memory or security defect remains.

## Job matrix

| Workflow       | Jobs                                       | Triggers                                                                             | Gates on                                                   |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `ts-lint.yml`  | TypeScript and formatting                  | push and pull request to `main` on a JS/TS or config path, manual                    | `pnpm lint`, `pnpm format:check`, `pnpm typecheck`         |
| `zig-lint.yml` | Zig formatting                             | push and pull request on `**.zig`, `build.zig`, `build.zig.zon`, manual              | `zig fmt --check`                                          |
| `nix-lint.yml` | Nix formatting                             | push and pull request on `**.nix` or `flake.lock`, manual                            | `nix fmt -- --check` over tracked `.nix` files             |
| `ts-test.yml`  | Unit and boundary tests                    | push and pull request on a JS/TS or config path, manual                              | `tests/protocol` and `tests/compat/options`                |
| `zig-test.yml` | Zig unit tests, Binding lifecycle tests    | push and pull request on a Zig, `src/`, `tests/`, `scripts/`, or config path, manual | `zig build test`, `typecheck:dist`, the whole vitest suite |
| `autobahn.yml` | Autobahn engine gate, RFC 6455 conformance | push and pull request on a Zig, manifest, or harness path, weekly, manual            | the committed known-failure baseline                       |
| `perf.yml`     | Echo throughput against `ws`               | push and pull request on a Zig, manifest, or `bench/` path, manual                   | the benchmark report, uploaded as an artifact              |
| `bump.yml`     | Advance the version, push the tag          | push to `main`, manual                                                               | nothing: it commits the version and starts the publish     |
| `publish.yml`  | Platform build matrix, publish to npm      | a `v*` tag pushed by a maintainer                                                    | every platform builds and its addon loads and echoes       |

Every gating workflow runs on `ubuntu-24.04`. Node is `node@24` and pnpm
`12.4.2` through `pnpm/setup@v2`, Zig is `0.16.0` through
`mlugg/setup-zig@v2`, and `nix-lint.yml` installs neither. The pnpm store is
cached; the jobs that build the addon cache `.zig-cache` and `zig-pkg` under a key
hashing `build.zig`, `build.zig.zon`, and `src/builds/**`, so a change to any of
those is a cold build.

The seven gating workflows are Linux-only. `publish.yml` is the exception, and
it is the only job that builds a second platform: it exists to produce artifacts
rather than to gate a change, so its matrix is the published set.

## Release and native matrix

`publish.yml` runs on the `v*` tag `bump.yml` pushes, or one pushed by hand. It
is the only workflow that builds anything but Linux, and the reason is that a
published addon has to exist
for every platform the package claims to support.

| Job             | Runner             | Platform built                                        |
| --------------- | ------------------ | ----------------------------------------------------- |
| `bindings`      | `ubuntu-24.04`     | `linux-x64-gnu`                                       |
| `bindings`      | `ubuntu-24.04-arm` | `linux-arm64-gnu`                                     |
| `bindings`      | `macos-15-intel`   | `darwin-x64`                                          |
| `bindings`      | `macos-15`         | `darwin-arm64`                                        |
| `bindings-musl` | `node:24-alpine`   | `linux-x64-musl`                                      |
| `publish`       | `ubuntu-24.04`     | the bundle, the staged manifests, and the npm publish |

One runner per platform, each native for the platform it builds. That is a
constraint rather than a preference. Zig's distribution carries no Apple SDK, so
a `darwin` target built anywhere else fails at link; and the engine builds its
vendored BoringSSL, lsquic, libdeflate, and zlib for the host target, which the
release path then links into a cross-compiled addon. A cross build therefore
carries an x64 glibc BoringSSL inside an arm64 or Alpine binary: it links, it
loads, and it misbehaves later, which is the one failure a green pipeline cannot
catch. `-Dnpm-platform` narrows the graph to the one target the runner owns.

`ubuntu-24.04-arm` is free on a public repository and hard-fails the workflow on
a private one, so going private silently loses a published platform.
`node:24-alpine` is a musl host that already carries a Node the JavaScript
actions can run, which a bare `alpine` image does not.

There is no `win32-x64` row. `napi_zig` 0.2.8 asks for `x86_64-windows-none`, an
ABI-less target with no `ws2_32` to link, so no Windows addon can be built on any
runner. It returns either with an in-repo compile step that asks for
`x86_64-windows-gnu` or with a fixed upstream release, and
`src/builds/platforms.zig` is where the reason is recorded.

Each shard runs `tests/binding/addon.test.ts` and `tests/binding/codec` against
the addon it just built, so no platform is published on the evidence that it
compiled. That loads the artifact, reads its compiled capacities, and round-trips
frames through the native codec. It deliberately does not open a loopback
connection: a release gate that also depends on the runner's network
configuration would block a release for a reason that has nothing to do with the
artifact, and the socket suites already run in `zig-test.yml`.

`publish.yml` does not gate a pull request. A pull request that changes the
engine, the addon ABI, or the loader can be merged and still ship a broken
release, because nothing in the gating matrix runs a second platform.

It also cannot publish a Windows package, for the same reason it has no `win32-x64`
row. That is a packaging gap on top of a runtime one: the vendored `xev` event
loop fails `accept` and `read` with `error.Unexpected` on Windows, so the engine
binds and then cannot serve. Everything that does not open a socket passes
there, which is what the release smoke test is scoped to.

## Publishing

`publish.yml` holds no npm secret. `id-token: write` is the whole credential:
npm exchanges the run's OIDC token for a short-lived publish token, and the same
token signs the provenance attestation. Each of the six packages has a trusted
publisher on npm naming `publish.yml` and the `npm` environment, so a different
workflow cannot publish even with a valid OIDC token.

Configuring that is a maintainer step, not a workflow one. npm requires an
interactive 2FA challenge for it and refuses a bypass-2FA token outright, so it
cannot run in CI:

```sh
for p in ventiws @ventiws/binding-linux-x64-gnu @ventiws/binding-linux-arm64-gnu \
         @ventiws/binding-linux-x64-musl @ventiws/binding-darwin-x64 @ventiws/binding-darwin-arm64; do
  npm trust github "$p" --file publish.yml --repo farbenbuilds/ventiws --env npm --allow-publish --yes
done
```

All six packages need the record, the five binding packages included. A missing
one fails the publish at that package with `ENEEDAUTH`, which names neither the
package nor the missing configuration, so the failure reads as a credential
problem rather than one absent record.

npm allows several trusted publishers per package, and one can only be attached
to a package that already exists, which is why the first release necessarily used
a token.

`publish.yml` publishes the per-platform packages before the main package, so a
main package is never on the registry pointing at bindings that are not there
yet. It checks the tag against `package.json` first, so a tag pushed by hand
cannot publish a version nobody released. The tag is the only way to start it:
`bump.yml` pushes it with the release app's installation token
(`RELEASE_APP_CLIENT_ID` and `RELEASE_APP_PRIVATE_KEY`), because a tag pushed
with `GITHUB_TOKEN` starts no run.

Which version a merge advances follows its `release:<kind>` labels, or the
dispatch's `base` and `preid` inputs: by default a prerelease advances its
counter, or a stable version starts the next patch's train; `release:stable`
promotes the train, and `release:major|minor|patch` bump the base.
`scripts/next-version.mjs` is the table and `tests/tooling/version.test.ts`
holds it.

The publish is not transactional: a failure part way leaves the earlier packages
on the registry. `napi-zig publish` treats an already-published version as a
skip rather than an error, so a re-run of the same tag is safe, but a release
that half-succeeded is repaired by re-running it rather than by hand.

## Lint and type gates

`oxlint` carries the rules a machine can check: no `class`, `this`, `extends`,
prototype mutation, `enum`, `any`, or emoji, and no import outside `napi-zig`
and `uWebZockets`. `oxfmt` formats TypeScript, JSON, and Markdown.
`scripts/check-conventions.mjs` runs inside `pnpm lint` and as a `lefthook` job
and adds what a linter cannot: the 150-line module budget, the comment budget,
`snake_case` Zig function names, and `kebab-case` TypeScript filenames. The
vendored `src/types/ws.d.ts` is exempt.

`tsc --noEmit` runs `tsconfig.json` and then `tsconfig.test.json`, so the vitest
suites are typechecked even though vitest strips types. Weakening a compiler
option is a review-blocking change, not a lint fix.

## Tests

`ts-test.yml` builds the addon, then runs `tests/protocol` and
`tests/compat/options` and nothing else. The addon is present because
`normalizeServerOptions` reads the codec's compiled ceilings to refuse a
`maxPayload` above what the build supports, and that read loads the addon. The
list is an inclusion list for fast feedback on a pull request that touched
neither Zig nor the addon; coverage is `zig-test.yml`'s job.

`zig-test.yml` splits into two:

- `unit` runs `zig build test --summary all`, which compiles
  `src/engine_tests.zig` and the per-module suites under `src/engine-tests/`.
- `binding` runs `pnpm build:binding`, then `pnpm exec tsdown && pnpm run
typecheck:dist` to check the built declarations through the `exports` map, then
  `pnpm exec vitest run --no-file-parallelism` for the whole suite. The suites
  run serially because each file builds and tears down a real engine server, and
  parallel invocation fails engine server creation intermittently on this
  runner.

## `ws` conformance

There is no workflow for this. The suite is `tests/conformance/`, it runs as
part of `zig-test.yml`'s whole-suite pass, and `pnpm test:compat` runs it alone.
Each scenario executes twice, once against the pinned `ws` 8.21.3 devDependency
and once against ventiws, and the two normalized event transcripts are compared.
It covers server construction options and defaults, the upgrade path with
accepted and rejected handshakes, text, binary, and fragmented messages
including empty payloads, `ping`/`pong` and the automatic reply, close codes and
reasons with exactly-once `close`, `maxPayload` enforcement and `1009`,
`bufferedAmount` and `send` under backpressure, and per-message deflate
negotiation including declined and malformed offers.

A divergence fails the run. An intentional divergence needs an explicit
exclusion entry with a linked issue, so it cannot be merged silently; the
divergences that already exist are written up in
[COMPATIBILITY.md](COMPATIBILITY.md#error-shape-policy).

## Autobahn

`autobahn.yml` has two jobs. `gate` costs about 25 seconds and needs no
toolchain beyond Node: it checks out full history, restores the commit the suite
last passed on this ref out of a cache, and diffs against it. Nothing
engine-relevant in the delta skips `fuzzing-client`. The two are separate jobs
because a skipped job renders grey with a reason and still satisfies a required
check, where a skipped step renders green and reads as a pass. Add `Autobahn
engine gate` to branch protection alongside the suite, or a failing gate leaves
the suite skipped rather than failed.

`fuzzing-client` builds the addon, runs `tests/autobahn/preflight.ts` to prove
the addon loads, pulls the fuzzing client by digest, and runs
`node tests/autobahn/run.ts` with `AUTOBAHN_SHARDS=4`. A pull request runs the
framing selection, 301 cases;
`schedule` and `workflow_dispatch` pass `--full` for all 517, which is the weekly
refresh. A run that passes writes its commit to the watermark cache, so a red run
is retried on the next push rather than recorded as tested. The report is
uploaded on every outcome, including failure.

The gate is a regression gate, not an exclusion list. Any failure outside
`tests/autobahn/baseline.json` fails the run, and a baseline entry that starts
passing fails the run until the list is shortened, so the list can only shrink.
Every case is still classified and counted, a case above the engine's compiled
message capacity is reported as `skipped-capacity` rather than as a pass or a
failure, and a truncated or foreign report fails on its totals. `NON-STRICT` is
tolerated because the fully conformant `ws` reference report carries it.

A shard owns whole case groups rather than a slice of them, so the union of four
shards is provably the case set one unsplit selection would pick, and the gate
still holds each shard to the mode's own totals.
`tests/autobahn/shard-weights.test.ts` cross-checks the weight table against those
totals in the unit suite, and `tests/autobahn/diff-gate.test.ts` holds the gate's
path filter and the workflow's to each other.

The recorded run, the per-group causes, and the procedure for re-recording the
baseline are in [COMPATIBILITY.md](COMPATIBILITY.md#rfc-6455-conformance) and
[docs/compliance.md](docs/compliance.md#re-recording-the-autobahn-baseline).

## Benchmark

`perf.yml` runs `pnpm build` and then `pnpm run bench`, which drives `ws` and
the native engine through one shared echo path and writes a JSON report with
provenance and the raw samples behind every median. The report is uploaded on
every run, including failures.

It deliberately does not pass `--gate`. The gate fails when ventiws's median falls
more than ten percent behind `ws` on the same host, and the engine is not at
parity, so a blocking threshold would report the project's starting point as a
regression against itself. The switch is the `--gate` flag on its `Measure` step,
and `pnpm bench -- --gate` gives the same verdict locally. A payload above the
engine's compiled message capacity is refused by the harness rather than
compared against an absent row.

## Cost per job

Every job that builds the addon is dominated by that build, not by the tests it
runs. The Zig cache key hashes `build.zig`, `build.zig.zon`, and `src/builds/**`,
so a change to any of those with no usable prefix restore compiles BoringSSL,
lsquic, libdeflate, and zlib from source, which is minutes on its own. Against a
warm cache the build is seconds.

| Job            | Most expensive step                                     |
| -------------- | ------------------------------------------------------- |
| `ts-lint.yml`  | `pnpm typecheck`, two full `tsc` programs               |
| `ts-test.yml`  | the addon build, on a cold Zig cache                    |
| `zig-test.yml` | the addon build, on a cold Zig cache                    |
| `autobahn.yml` | the addon build; the suite itself is seconds            |
| `perf.yml`     | `pnpm build`, addon plus bundle plus dts                |
| `zig-lint.yml` | `zig fmt --check` over `src`                            |
| `nix-lint.yml` | the Nix install, once per runner                        |
| `publish.yml`  | the cross-compiles, one per target, on a cold Zig cache |

`autobahn.yml` sets `timeout-minutes: 60` on the suite job and `5` on the gate
for the cold path, not the warm one; `perf.yml` sets `45`. The rest use the
default and finish in a couple of minutes.

## Running a gate locally

| Workflow       | Local equivalent                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ts-lint.yml`  | `pnpm lint && pnpm format:check && pnpm typecheck`                                                                                                           |
| `zig-lint.yml` | `zig fmt --check --exclude zig-pkg src build.zig`                                                                                                            |
| `nix-lint.yml` | `nix fmt -- --check $(git ls-files '*.nix' \| grep -v '\.zon\.nix$')`                                                                                        |
| `ts-test.yml`  | `pnpm exec vitest run tests/protocol tests/compat/options`                                                                                                   |
| `zig-test.yml` | `zig build test` and `pnpm test`                                                                                                                             |
| `autobahn.yml` | `pnpm test:autobahn`, or `-- --full`; needs Docker                                                                                                           |
| `perf.yml`     | `pnpm bench`, or `pnpm bench -- --gate` for the verdict                                                                                                      |
| `publish.yml`  | `pnpm run build:bindings -- --platform=<one of the five>`, then `pnpm exec vitest run --no-file-parallelism tests/binding/addon.test.ts tests/binding/codec` |

`pnpm lint` already runs `scripts/check-conventions.mjs`, so a full-tree
`pnpm exec lefthook run pre-commit --all-files` adds what `pnpm lint` does not:
`scripts/check-staged.sh`, the `scripts/zon2nix.sh` mirror of `build.zig.zon`,
`zig fmt` on staged Zig files, and a `pnpm typecheck` and `pnpm test` over the
tree.

## What a run does not cover

- Any gating workflow on a platform other than `ubuntu-24.04`.
  `publish.yml` builds and smoke-tests a second platform, but only on its own
  schedule: a pull request is gated on Linux alone.
- WebSocket traffic on Windows, and therefore sixteen suite files there. The vendored
  `xev` event loop completes `accept` and `read` with `error.Unexpected` on Windows, so
  the engine binds and then resets the peer. This is true of `main` as well, so a Windows
  checkout cannot run `pnpm test` green; `zig build test` and the suites that do not open
  a socket do pass there.
- `linux-arm64-musl`, `linux-arm-gnu`, `linux-arm-musl`, `freebsd-x64`,
  `android-arm64`, and every Windows triple. A published ventiws ships five
  platform packages and the loader names those five, so a host outside them
  installs cleanly and is told what exists rather than reaching a missing file.
  Windows is a deliberate gap, not an oversight: see the release matrix above.
- Any `ws` conformance scenario that the vendored `ws` 8.21.3 devDependency
  cannot itself satisfy; the two implementations are compared, so a `ws` defect
  is a shared blind spot.
- Fuzzing of the header parser, the mask/unmask path, or the fragment
  reassembler. Autobahn drives the protocol; it is not a fuzzer of the native
  layer.
- Load, soak, and leak testing at production concurrency.
  `tests/compat/client/soak*.test.ts` covers repetition and a slow peer, not a
  loaded fleet.

Releasing is covered in [CONTRIBUTE.md](CONTRIBUTE.md#releasing).
