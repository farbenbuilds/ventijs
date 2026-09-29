# Contributing to ventiws

Focused changes that preserve `ws`-compatible behavior, end-to-end type safety,
bounded memory use, and the anti-OOP architecture in
[CODING_CONVENTION.md](CODING_CONVENTION.md). Read [CODEBASE.md](CODEBASE.md)
and [CI_CD_PIPELINE.md](CI_CD_PIPELINE.md) before touching the binding, the
compatibility layer, or the engine; report a defect per [SECURITY.md](SECURITY.md).

## Development environment

```sh
git clone git@github.com:farbenbuilds/ventiws.git
cd ventiws
nix develop
pnpm install
```

`nix develop` pins Node.js, pnpm, and Zig 0.16.0. On musl hosts use
`nix develop .#musl`; the checked-in `.envrc` selects it under `direnv`. Without
Nix, install Node.js 22.12 or newer, pnpm, and Zig 0.16.0. The first
`pnpm build:binding` compiles the engine's vendored C dependencies into
`.zig-cache/`, which takes minutes and about a gigabyte; later builds are
incremental, so leave `.zig-cache` and `zig-pkg` alone. Cross-compile with
`zig build -Dtarget=<triple>`.

## Script contract

Run every command through pnpm. This is every script `package.json` defines,
plus `pnpm install`.

| Command                 | Tool     | Purpose                                                       |
| ----------------------- | -------- | ------------------------------------------------------------- |
| `pnpm install`          | pnpm     | Install development dependencies and the `lefthook` hooks     |
| `pnpm build`            | napi-zig | Build the addon, bundle `dist/`, then check the declarations  |
| `pnpm build:binding`    | napi-zig | Build the native addon only                                   |
| `pnpm dev`              | tsdown   | Rebuild the TypeScript bundle in watch mode                   |
| `pnpm test`             | vitest   | Rebuild the addon, then every suite serially                  |
| `pnpm test:watch`       | vitest   | Rebuild the addon, then rerun on change                       |
| `pnpm test:compat`      | vitest   | The `ws` conformance suite in `tests/conformance`             |
| `pnpm test:autobahn`    | node     | The RFC 6455 suite; `-- --full` selects all 517 cases         |
| `pnpm bench`            | node     | Echo throughput against `ws`; `-- --gate` applies the verdict |
| `pnpm typecheck`        | tsc      | `tsconfig.json` then `tsconfig.test.json`, no emit            |
| `pnpm typecheck:dist`   | tsc      | Built declarations through the `exports` map; needs `tsdown`  |
| `pnpm lint`             | oxlint   | Lint, then `scripts/check-conventions.mjs`                    |
| `pnpm lint:fix`         | oxlint   | Apply the safe lint fixes                                     |
| `pnpm format`           | oxfmt    | Format TypeScript, JSON, and Markdown                         |
| `pnpm format:check`     | oxfmt    | Verify formatting without writing                             |
| `pnpm finalize:exports` | node     | Add the `types` conditions `tsdown` leaves out of `exports`   |
| `pnpm build:bindings`   | node     | Cross-compile the published platforms into `npm/`             |
| `pnpm stage:publish`    | node     | Assemble `npm/ventiws` and verify every platform is present   |
| `pnpm release`          | bumpp    | Bump the version across the versioned surfaces                |
| `pnpm prepublishOnly`   | pnpm     | `pnpm build`, run by pnpm before publishing                   |

`tsdown` rewrites the `exports` map on every build, so the `types` conditions
have to be a step rather than a hand-edit the next build would drop.
`finalize:exports` is that step, and `pnpm build` runs it before
`typecheck:dist`. `pnpm bench` needs `pnpm build:binding` first.

Before every commit run:

```sh
pnpm lint
pnpm format:check
pnpm exec lefthook run pre-commit --all-files
```

`lefthook` also runs on a normal `git commit` against the staged files. Apply
fixes with `pnpm lint:fix` and `pnpm format`, never with `--no-verify`.

## Requirements

[CODING_CONVENTION.md](CODING_CONVENTION.md) states the style in full. What a
reviewer checks:

- No classes, `this`, `extends`, or prototype mutation in either language.
  Constructor-shaped exports are functions returning explicit state records.
- Every source file near or below 150 lines, split by responsibility at the first
  sign of a second concern. Guard clauses and early returns, `switch` over nested
  conditionals, no allocation on hot paths.
- Every peer-controlled length, count, and queue capped; exhaustion is a typed
  error or backpressure, never growth. Peer data reaches JavaScript as a copy.
- No runtime dependency beyond `napi-zig` and `uWebZockets`. A public type is
  declared once and re-exported, and generated `.d.ts` output is never
  hand-edited.
- `tsconfig.json` runs in `strict`, and a compiler option is never weakened to
  land a change. Types stay readable: explicit unions, a named alias for every
  non-trivial inline shape, generics no deeper than one parameter and one
  constraint, and no conditional, recursive, or `infer`-driven computation.
  Variants are discriminated unions, never optional-field soup or sentinel
  strings, and a numeric engine status is mapped to the `as const` union in
  `src/types/status.ts` before it reaches a consumer.
- Public option, event, and method names match `ws` exactly. Where `ws` is
  ambiguous, record the decision, and update the affected row of
  [COMPATIBILITY.md](COMPATIBILITY.md), in the same pull request. A silent
  divergence is a defect.

## Testing

- Every behavior change ships with a vitest test, and a bug fix ships with a
  regression test that fails before the fix. A boundary change covers retained
  inbound payloads, borrowed outbound buffers, exactly-once `close`, stale
  handle access, and capacity exhaustion. A consumer-facing type change keeps
  `tests/types/consumer.ts` compiling and `pnpm typecheck:dist` passing, the
  latter resolving the built bundle through the package `exports` map.
- `ws` compatibility tests run the same scenario against both libraries and
  compare observable behavior; `ws` is a devDependency and is never shipped.
- A protocol change needs the Autobahn gate, which `autobahn.yml` starts for any
  `.zig`, `build.zig.zon`, or `tests/autobahn/` change, and `pnpm test:autobahn`
  runs it by hand with Docker.
- Zig unit tests live in `src/engine-tests/`, one `<module>_test.zig` per testable
  module, aggregated by `root.zig` and entered through `src/engine_tests.zig`.
  Run them with `zig build test`. When a unit under test allocates, use a
  leak-detecting allocator.
- Performance work cites measured numbers from `pnpm bench` on a quiet host with
  the `ws` baseline from the same run, and labels estimates as estimates.

## Pull requests

Explain the compatibility, ownership, or performance invariant being changed, and
give the commands you ran and their results, measured numbers separate from
expectations. Fill out [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) and keep
commits to [.github/COMMIT_CONVENTION.md](.github/COMMIT_CONVENTION.md).

## Dependency updates

Runtime dependencies are pinned by hash in `build.zig.zon`: change the pin and
the matching row of [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) in the same
commit, rebuild from a clean cache so a stale artifact cannot hide an ABI change,
and run the conformance suite plus Autobahn. Development dependencies follow the
pnpm lockfile.

## Releasing

1. Bump the version with `pnpm release` and confirm every versioned surface
   agrees.
2. Add the dated `CHANGELOG.md` section listing breaking changes and known
   limitations. A release commit carries no `Unreleased` heading.
3. Pass lint, format, typecheck, unit, and build on the release commit, then run
   the `ws` conformance suite and Autobahn and retain the benchmark report.
4. Verify [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) against the shipped
   artifacts, then tag `v<version>` and push the tag.

The tag is what publishes. `.github/workflows/publish.yml` builds the six
platform packages across four runners, checks the tag against `package.json`,
assembles `npm/`, and publishes under npm trusted publishing, which needs no
token in the repository. A run of that workflow by hand defaults to a dry run
that packs every tarball without publishing.

Each package has to be configured for trusted publishing once, by a maintainer
with npm 2FA enabled and npm 11.16 or newer:

```sh
npx napi-zig npm-init --repo farbenbuilds/ventiws --workflow publish.yml
```

That is the step with no dry run. It publishes a first version of any package
that does not exist yet and points the rest of them at the workflow, so run it
before the first release rather than during one.

A release publishes six packages: `ventiws` plus one per platform. A platform
that fails to build fails the release rather than shipping a version that
cannot be installed on it, which is what `pnpm stage:publish` checks for and
what makes the per-shard upload a gate rather than a convenience.
