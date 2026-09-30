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
| `pnpm bump`             | node     | Advance the version by a `--release <kind>` directive         |
| `pnpm release`          | node     | Tag the version the tree carries by hand, for recovery        |
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

1. Merge the work. `bump.yml` does the rest: it advances the version, writing
   `package.json`, `build.zig.zon`, `README.md`, and the `CHANGELOG.md` section
   for that merge's commits; commits it; and pushes the `v<version>` tag.
   `.github/workflows/publish.yml` then builds the six platform packages across
   five runners, checks the tag against `package.json`, assembles `npm/`,
   publishes, and writes the GitHub Release.
2. Pass lint, format, typecheck, unit, and build, then run the `ws` conformance
   suite and Autobahn and retain the benchmark report.
3. Verify [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) against the shipped
   artifacts.

The tag is pushed with the release app's installation token rather than
`GITHUB_TOKEN`, because a `GITHUB_TOKEN` push starts no workflow run and
`publish.yml` takes no dispatch. The app is a one-time maintainer step: create a
GitHub App with `Contents: Read and write` and no webhook, install it on this
repository only, then store its Client ID as the `RELEASE_APP_CLIENT_ID`
repository variable and its private key as the `RELEASE_APP_PRIVATE_KEY` secret.
`pnpm release` (`scripts/tag-release.mjs`) pushes the tag by hand and remains the
recovery path for a run that failed before its tag.

### What the next version is

With no directive a prerelease advances its counter (`1.0.0-alpha.12` ->
`1.0.0-alpha.13`), and a stable version starts the next patch's train
(`1.0.0` -> `1.0.1-alpha.0`). A pull request directs the step with
`release:<kind>` labels, and a base label combines with a prerelease label:

| Label                                               | Result                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `release:alpha` / `release:beta` / `release:rc`     | Continue that train, or switch to it: `1.0.0-alpha.12` + `release:beta` -> `1.0.0-beta.0` |
| `release:stable`                                    | Drop the prerelease: `1.0.0-beta.3` -> `1.0.0`, published on `latest`                     |
| `release:patch` / `release:minor` / `release:major` | Bump the base from a stable version: `1.0.0` -> `1.0.1`, `1.1.0`, `2.0.0`                 |
| a base label plus a prerelease label                | Start the new base in that train: `release:major` + `release:beta` -> `2.0.0-beta.0`      |

A base bump from inside a train stays in that train unless `release:stable` is
also set; a prerelease label on a stable version targets the next patch. Without
a pull request -- a direct push, or a run by hand -- the same directive is a pair
of dispatch inputs:

```sh
gh workflow run bump.yml -f base=minor -f preid=stable
```

`node scripts/next-version.mjs <version> <kind...>` prints any transition, and
`tests/tooling/version.test.ts` holds the table and the three versioned surfaces
together.

The publish job holds no npm secret. `id-token: write` is the whole credential,
because each of the six packages has a trusted publisher on npm naming
`publish.yml` and the `npm` environment. All six need the record, the five
binding packages included: a missing one fails the publish at that package with
`ENEEDAUTH`, before the main package is reached. npm requires an interactive 2FA
challenge to configure one and refuses a bypass-2FA token, so it is a maintainer
step:

```sh
for p in ventiws @ventiws/binding-linux-x64-gnu @ventiws/binding-linux-arm64-gnu \
         @ventiws/binding-linux-x64-musl @ventiws/binding-darwin-x64 @ventiws/binding-darwin-arm64; do
  npm trust github "$p" --file publish.yml --repo farbenbuilds/ventiws --env npm --allow-publish --yes
done
```

npm allows several trusted publishers per package and can only attach one to a
package that already exists, which is why the first release had to use a token.

A release publishes six packages: `ventiws` plus one per platform. A platform
that fails to build fails the release rather than shipping a version that cannot
be installed on it, which is what `pnpm stage:publish` checks for and what makes
the per-shard upload a gate rather than a convenience.

The same run then creates the GitHub Release, with the changelog sections between
this tag and the previous one as its notes, marked a prerelease while the version
carries a prerelease component. It is a separate job that needs the publish
result: a release page for a version that is not on the registry advertises an
install that fails, which is worse than no page.

The registry takes about three minutes to make a newly published version
readable. Verifying with `npm view` in that window reports the previous version
and reads as a failed publish, so check with `npm view <pkg> versions
--prefer-online` and do not treat a 404 on a new version as a failure.
