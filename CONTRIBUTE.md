# Contributing to ventijs

ventijs accepts focused changes that preserve `ws`-compatible behavior,
end-to-end type safety, bounded memory use, and the anti-OOP architecture
described in [CODING_CONVENTION.md](CODING_CONVENTION.md).

Read [CODEBASE.md](CODEBASE.md), [CODING_CONVENTION.md](CODING_CONVENTION.md),
and [CI_CD_PIPELINE.md](CI_CD_PIPELINE.md) before touching the binding, the
compatibility layer, or the Zig engine. Report security defects privately as
described in [SECURITY.md](SECURITY.md).

## Development environment

The pinned Nix shell provides Node.js, pnpm, Zig 0.16.0, zls, and the
TypeScript tooling:

```sh
git clone git@github.com:farbenbuilds/ventijs.git
cd ventijs
nix develop
pnpm install
```

On musl hosts, use `nix develop .#musl` (the checked-in `.envrc` selects it
automatically under `direnv`). Without Nix, install Node.js 22 or newer, pnpm,
and Zig 0.16.0 manually. No other system tooling is required for the
TypeScript layer; the native binding is built by Zig.

The first `pnpm build:binding` compiles the engine's vendored C dependencies
(BoringSSL, lsquic, libdeflate, zlib) into `.zig-cache/`. That takes minutes
and about a gigabyte; later builds are incremental. The engine builds them
itself from pinned package sources, so the dev shell only pins the default Zig
target. Do not delete `.zig-cache` or `zig-pkg` casually. Cross-compiling to
another architecture is `zig build -Dtarget=<triple>`.

## Script contract

Run every command through pnpm; do not invoke package binaries directly.

| Command               | Tool     | Purpose                                                             | State on this branch |
| --------------------- | -------- | ------------------------------------------------------------------- | -------------------- |
| `pnpm install`        | pnpm     | Install development dependencies                                    | Wired                |
| `pnpm dev`            | tsdown   | Rebuild the TypeScript bundle in watch mode                         | Wired                |
| `pnpm build`          | napi-zig | Build the native addon, bundle `dist/`, check declarations          | Wired                |
| `pnpm build:binding`  | napi-zig | Build the native addon only                                         | Wired                |
| `pnpm test`           | vitest   | Unit, integration, and boundary tests                               | Wired                |
| `pnpm test:watch`     | vitest   | Rerun tests on change                                               | Wired                |
| `pnpm test:compat`    | vitest   | Run the `ws` behavioral conformance suite                           | Wired                |
| `pnpm test:autobahn`  | node     | Run the Autobahn suite; add `-- --full` for all 517 cases           | Wired                |
| `pnpm bench`          | node     | Compare against `ws` on the same host: `node bench/index.ts --gate` | Wired                |
| `pnpm typecheck`      | tsc      | Strict check of `src` and `tests`, no emit                          | Wired                |
| `pnpm typecheck:dist` | tsc      | `tsc -p tsconfig.dist-types.json`; needs `tsdown` output first      | Wired                |
| `pnpm lint`           | oxlint   | Lint, then the convention checks in `scripts/`                      | Wired                |
| `pnpm lint:fix`       | oxlint   | Apply the safe lint fixes                                           | Wired                |
| `pnpm format`         | oxfmt    | Format TypeScript, JSON, and Markdown                               | Wired                |
| `pnpm format:check`   | oxfmt    | Verify formatting without writing files                             | Wired                |
| `pnpm release`        | bumpp    | Bump the version across the versioned surfaces                      | Wired                |
| `pnpm prepublishOnly` | pnpm     | Build before publish                                                | Wired                |

`pnpm typecheck:dist` resolves the built declarations through the package
`exports` map, so `tsdown` has to have run first. `pnpm build` does both in
order; `zig-test.yml` runs them as `pnpm exec tsdown && pnpm run typecheck:dist`
after `pnpm build:binding`.

The two harnesses are entry points rather than part of the vitest suite, and
they run under plain `node` on `.ts` files through Node's native type stripping,
with no loader shim. That is why `tsconfig.json` sets
`allowImportingTsExtensions`: the harness imports sibling modules with `.ts`
specifiers, which `tsc` otherwise rejects. The Autobahn runner needs Docker, and
the benchmark needs `pnpm build` first because it loads the bundle from `dist/`.

`pnpm install` also installs the `lefthook` Git hooks. Run every hook against
the whole tree with `pnpm exec lefthook run pre-commit --all-files`; a normal
`git commit` runs them against the staged files.

Before every commit, run `pnpm lint`, `pnpm format:check`, and
`pnpm exec lefthook run pre-commit --all-files`. Apply fixes with
`pnpm lint:fix` and `pnpm format`. Never bypass the hooks with `--no-verify`.

`pnpm build` and `pnpm test` rebuild the native binding first, so a clean
checkout needs nothing beyond `nix develop` and `pnpm install`. `src/index.ts`
re-exports the vendored `ws` type surface and the runtime `WebSocket`,
`WebSocketServer`, and `createWebSocketStream` values;
`tests/binding/addon.test.ts` only proves the native pipeline, so replace it as
the `ws` surface lands, do not extend it.

## Engineering requirements

- Zero object-oriented code. No classes, `this`, `extends`, or prototype
  mutation. Use constructor-shaped factory functions that return explicit state
  records, as described in [CODING_CONVENTION.md](CODING_CONVENTION.md).
- Keep every source file near or below 150 lines. Split by responsibility at
  the first sign of a second concern.
- Use guard clauses and early returns. No nested conditionals where a `switch`
  or an inverted guard is clearer.
- Do not allocate on hot paths. Parsing, framing, masking, routing, and write
  callbacks operate on caller-owned or engine-owned fixed storage.
- Cap every peer-controlled length, count, and queue. Exhaustion produces a
  typed error or backpressure, never unbounded growth.
- Add no runtime dependencies beyond `napi-zig` and `uWebZockets`. Tooling
  belongs in `devDependencies`.
- Keep the public type surface declared once. Never hand-edit `.d.ts` output.
- Update [COMPATIBILITY.md](COMPATIBILITY.md) in the same pull request whenever
  a public surface item or its status changes.
- Copy peer-controlled data into Node-owned buffers before it can be retained
  by JavaScript. Engine slabs never escape a native call.
- Use `kebab-case` file names and `camelCase` identifiers in TypeScript;
  `snake_case` files, functions, and variables with `PascalCase` types in Zig.
- Update `.github/COMMIT_CONVENTION.md`-compliant commits and keep pull
  requests scoped to one concern.

## Type safety requirements

- `tsconfig.json` runs in `strict` mode. Do not weaken compiler options to land
  a change.
- Consumer-facing type changes must keep `tests/types/consumer.ts` compiling;
  after `tsdown`, `pnpm typecheck:dist` proves the package `exports` map
  resolves the built declaration bundle via `tests/declarations/consumer.ts`.
- Public option and event types must match the `ws` names and shapes. Where
  `ws` types are ambiguous, document the decision in the pull request.
- Use discriminated unions for message and state variants. Do not model
  variants with optional-field soup or sentinel strings.
- Numeric codes from the engine are mapped to exported `as const` unions before
  they reach consumers.
- Types prioritize readability: explicit unions over conditional or derived
  types, named aliases instead of inline shapes, and generics shallow enough
  to read at a glance. No recursive, conditional, or `infer`-driven type
  computation.

## Testing requirements

- Every behavioral change ships with a vitest test. Bug fixes ship with a
  regression test that fails before the fix.
- Boundary changes must cover: retained inbound payloads, borrowed outbound
  buffers, exactly-once `close`, stale handle access, and capacity exhaustion.
- `ws` compatibility tests run the same scenario against both libraries and
  compare observable behavior. Import the real `ws` package as a dev
  dependency only; never ship it.
- Protocol changes must pass the RFC 6455 Autobahn suite, which is the
  `autobahn.yml` job. The contract is in
  [CI_CD_PIPELINE.md](CI_CD_PIPELINE.md). The job only starts for a change to a
  Zig source, `build.zig.zon`, the harness, the lockfile, or the workflow, so an
  engine change gets it automatically. To run it by hand needs Docker;
  `pnpm test:autobahn` is the alias.
- Zig unit tests live in `src/engine-tests/`, one `<module>_test.zig` per
  testable source module, aggregated by `root.zig` and entered through
  `src/engine_tests.zig`. Run them with `zig build test`; `zig-test.yml` runs
  that command and the addon-backed binding tests in CI on every Zig or binding
  change, reporting through the `Zig Test` and `Binding Test` environments.
- Zig unit tests use caller-owned fixed storage for hot paths. When the unit
  under test allocates, use a leak-detecting allocator and prove every success
  and error path releases ownership.
- Performance work cites measured numbers from `pnpm bench` on a quiet host,
  including the `ws` baseline from the same run. Estimates are labeled as
  estimates.

## Pull requests

- Explain the compatibility, ownership, or performance invariant being changed.
- Include the commands you ran and their results.
- Separate measured performance results from expectations.
- Note any deviation from `ws` behavior explicitly; silent divergence is a
  defect.
- Keep commits concise and follow
  [.github/COMMIT_CONVENTION.md](.github/COMMIT_CONVENTION.md).
- Fill out [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md).

## Dependency updates

Runtime dependencies are pinned exactly and updated deliberately:

- Update the pinned revision in `build.zig.zon` and the matching entry in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) in the same change.
- Rebuild the addon from a clean cache so a stale artifact cannot hide an ABI
  or behavior change.
- Run the full `ws` conformance suite plus Autobahn after every engine update.
- Development dependencies follow the pnpm lockfile. Do not add a dependency
  for a problem the standard library already solves.

## Releasing

1. Bump the version with `pnpm release` (`bumpp`) and confirm all versioned
   surfaces agree.
2. Add `CHANGELOG.md` with a dated section that lists breaking changes and
   known limitations before the first tagged release. Do not leave an
   `Unreleased` heading in a release commit.
3. Verify [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) against the shipped
   native artifacts.
4. Pass lint, format, typecheck, unit, compatibility, and Autobahn checks on
   the release commit.
5. Build the native addon for every supported target in the CI publish matrix.
6. Tag the commit as `v<version>`, publish with provenance, and review the
   packed tarball before announcing.
