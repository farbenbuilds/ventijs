# AGENTS.md

ventiws is a pre-alpha Node.js native addon: a drop-in `ws` replacement whose
protocol engine is µWebZockets, a first-party Zig engine built for this project,
reached through `napi-zig`. TypeScript owns the public surface and types; Zig
will own parsing, buffers, and backpressure.

## Current state: docs describe the target, not the tree

- `build.zig` delegates to `src/builds/orchestrator.zig`, which wires the addon
  through `napi_zig.addLib` and imports the full `uWebZockets` engine module;
  `src/lib.zig` exposes `engineVersion()`, `http3Available()`, the server
  lifecycle functions, and the per-connection socket operations, following the
  `napi-zig` layout: the Zig root module lives in `src/` next to the TypeScript
  sources. `src/binding/load.ts` resolves and loads the built `.node`;
  `src/binding/{native,handle,server,socket}.ts` declare the addon ABI and wrap
  the lifecycle and socket calls; `src/types/ws.d.ts` vendors the DefinitelyTyped
  `ws` declarations, and `src/index.ts` re-exports that surface as type-only ESM
  exports alongside the runtime `WebSocket`, `WebSocketServer`, and
  `createWebSocketStream` values. `src/types/{events,socket,server}.ts` hold the internal state records,
  event maps, and listener-registry types;
  `src/types/{close,errors,status,options}.ts` hold the ready-state, close-code,
  error-code, engine-status, and normalized option types. `src/compat/` splits
  by surface: `events/{registry,emitter,dom-events,dom-listeners}.ts` own the
  listener registry and DOM handlers, `options/{shared,server,client}.ts`
  normalize options, `socket/{socket,state,attach,send,payload,close-reason,lifecycle}.ts`
  own the socket facade, `server/{server,close,listeners,upgrade,handshake,negotiate,clients}.ts`
  own the server and Node HTTP upgrade path, `client/{address,protocols,request,dial,open,redirect,unexpected,extension}.ts`
  own the `http.ClientRequest` handshake and the three payload events,
  `extensions/{grammar,scan,format,params,deflate,offer,negotiated,window,threshold}.ts`
  own RFC 7692 negotiation, and `constructors.ts`, `errors.ts`, `ready-state.ts`,
  `stream.ts` sit at the root. `src/protocol/` holds the pure
  close code, framing, and backpressure helpers.
  `src/engine/` holds the native foundation grouped by plane: `channel/`
  (threadsafe transport, event vocabulary, ring), `ffi/` (the N-API entry
  points, split into the outbound `socket_pump` and the inbound
  `socket_inbound`), `server/` (lifecycle, instance table, config, route wiring,
  and the inbound message path in `inbound.zig`), and `socket/` (per-connection
  slab, ops, staging); `src/engine-tests/` mirrors
  those folders with one Zig unit suite per testable module, entered through
  `src/engine_tests.zig`; the engine-coupled
  `server`/`connections` modules are covered by the addon-backed tests. Socket
  ops stage into a bounded ring and return typed statuses; the engine-thread
  drain that frames and writes them is still missing, so the facade's native
  sockets stage without flushing and the Node upgrade path has no receiver.
  `src/lib.zig` also exports `engineLimits`, so the compiled capacities are read
  rather than restated.
  `pnpm build:binding` builds the addon in ReleaseSafe, and
  `scripts/check-conventions.mjs` (run by `pnpm lint` and a `lefthook` job)
  enforces the line budget, Zig naming, filename case, and the emoji ban. The
  pinned `ws`/`@types/ws` devDependencies back the first conformance leg in
  `tests/conformance/`.
- Root documents (`CODEBASE.md`, `CONTRIBUTE.md`, `CI_CD_PIPELINE.md`,
  `SKILL.md`) specify the intended architecture. When they disagree with
  `package.json`, `tsconfig.json`, `flake.nix`, or `src/`, trust the config
  and code.
- Every script is wired: `build`, `build:binding`, `build:bindings`,
  `stage:publish`, `dev`, `format`,
  `format:check`, `lint`, `lint:fix`, `test`, `test:compat`, `test:watch`,
  `test:autobahn`, `bench`, `typecheck`, `typecheck:dist`, `release`, and
  `prepublishOnly`. `pnpm typecheck` checks `src`, `tests/types`, and
  the vitest suites through `tsconfig.test.json`; `pnpm build` ends with
  `typecheck:dist`, which checks the built
  declarations through the package `exports` map.
- Git hooks are installed by `lefthook` during `pnpm install` (allowed through
  `pnpm-workspace.yaml`); `pnpm-lock.yaml` is committed.

## Commands

Use pnpm; do not invoke package binaries directly. The shell normally runs
inside `nix develop` (Node 24, pnpm 12, Zig 0.16.0, zls).

| Task                          | Command                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Environment                   | `nix develop` (musl hosts: `nix develop .#musl`; `.envrc` selects it under direnv) |
| Install                       | `pnpm install`                                                                     |
| Build native addon and bundle | `pnpm build`                                                                       |
| Build native addon only       | `pnpm build:binding`                                                               |
| Watch bundle rebuild          | `pnpm dev`                                                                         |
| Lint                          | `pnpm lint` (`pnpm lint:fix` to apply fixes)                                       |
| Check formatting              | `pnpm format:check` (`pnpm format` to write)                                       |
| All tests (one-shot)          | `pnpm test` (rebuilds the binding first)                                           |
| Watch tests                   | `pnpm test:watch`                                                                  |
| All hooks                     | `pnpm exec lefthook run pre-commit --all-files`                                    |
| Single test                   | `pnpm exec vitest run tests/binding/addon.test.ts`                                 |
| Typecheck                     | `pnpm typecheck`                                                                   |
| Zig unit tests                | `zig build test` (runs `src/engine-tests/`)                                        |
| Zig formatting                | `zig fmt --check --exclude zig-pkg src build.zig`                                  |
| Version bump                  | `pnpm release`                                                                     |

The first `pnpm build:binding` compiles BoringSSL, lsquic, libdeflate, and
zlib from pinned package dependencies into `.zig-cache/` (roughly a gigabyte);
later builds are incremental. Since uWebZockets v1.2.0 the engine builds them
itself with `zig cc` and `zig c++`, so no CMake, Ninja, Perl, patch, or system
zlib is involved. `nix develop` pins `UWEBZOCKETS_DEFAULT_TARGET` so the build
finds the right libc. Do not delete `.zig-cache` or `zig-pkg` casually. The
vendor archives link into the shared addon, so
`src/builds/targets/native.zig` forces `-fPIC` on them through the build
graph; on musl hosts `.envrc` selects `.#musl`. Cross-compile with
`zig build -Dtarget=<triple>`.

`pnpm typecheck` runs `tsconfig.json` (`include: ["src", "tests/types"]`) and
then `tsconfig.test.json` (`include: ["tests"]`, minus `tests/declarations`),
so the vitest suites are typechecked even though vitest strips types.
`pnpm typecheck:dist` checks `tests/declarations` against the built
declarations through the package `exports` map; it needs `tsdown` output.

## Non-negotiable rules

- Zero OOP in both languages: no `class`, `this`, `extends`, or prototype
  mutation. Constructor-shaped exports are plain functions returning explicit
  state records.
- Guard clauses and early returns; `switch` over nested `if`/`else` ladders.
- Split by responsibility; keep source files near or below 150 lines.
- Comments say why, in one or two sentences: an RFC section, a byte value and
  its reason, a capacity, a deliberate divergence from `ws`, an invariant. No
  restating the identifier, no narration, no module essays, no post-mortems of
  fixed bugs, no `//!` in TypeScript. `scripts/check-conventions.mjs` enforces
  the ratio and the run length.
- Naming: TS files `kebab-case`, TS identifiers `camelCase`; Zig files,
  functions, and variables `snake_case`; Zig types `PascalCase`. Zig is
  formatted by `zig fmt` (4 spaces).
- The published package may depend only on `napi-zig` and `uWebZockets`, the
  first-party engine;
  everything else belongs in `devDependencies`.
- Hot paths allocate nothing. Capacities are fixed or `comptime`, and every
  peer-controlled length is capped.
- Types stay readable: explicit unions over derived `Exclude`/`Extract`
  chains, a named alias for every non-trivial inline shape, and generics no
  deeper than one parameter and one constraint. No conditional, recursive, or
  `infer`-driven type computations.
- Generated `.d.ts` files are build output; never hand-edit them.
- No emojis in code, docs, issue forms, or commit messages.

## Read before changing a subsystem

- Ownership, target layout, boundary contracts: `CODEBASE.md`
- Why Node owns the socket and Zig owns the framing: `docs/adr/0001-transport-and-framing-ownership.md`
- Style depth and anti-OOP patterns: `CODING_CONVENTION.md`
- Script contract, testing, PRs, release: `CONTRIBUTE.md`
- Target workflows and native matrix: `CI_CD_PIPELINE.md`
- Threat model and private reporting: `SECURITY.md`
- License obligations kept in sync with dependencies: `THIRD_PARTY_NOTICES.md`

## Agent skills and plugins

- `.agents/skills/**` is the local skill pack pinned by `skills-lock.json`;
  never hand-edit installed skills, and commit the lockfile and skill tree
  together. `using-agent-skills` is the discovery meta-skill: route a task to
  its workflow skill before starting. `SKILL.md` maps the pack to this repo.
- The `addyosmani/agent-skills` lifecycle pack supplies `interview-me`,
  `idea-refine`, `spec-driven-development`, `constraint-driven-development`,
  `planning-and-task-breakdown`, `context-engineering`,
  `source-driven-development`, `incremental-implementation`,
  `doubt-driven-development`, `test-driven-development`,
  `debugging-and-error-recovery`, `code-review-and-quality`,
  `code-simplification`, `security-and-hardening`,
  `performance-optimization`, `api-and-interface-design`,
  `observability-and-instrumentation`, `git-workflow-and-versioning`,
  `ci-cd-and-automation`, `documentation-and-adrs`,
  `deprecation-and-migration`, and `shipping-and-launch`. UI and browser
  skills are not part of this pack; ventiws is a Node.js package, not a UI
  project. `using-agent-skills` and `test-driven-development` carry local edits
  that strip their browser routing; a `skills update` may restore it, so
  re-remove any UI guidance it brings back.
- graphify is installed as a global opencode plugin. When
  `graphify-out/graph.json` exists, treat codebase and architecture questions
  as graph queries first: `graphify query "<question>"`, `graphify path A B`,
  `graphify explain X`; refresh with `/graphify --update`. `graphify-out/` is
  generated output, gitignored, and never edited or committed by hand.
- `.opencode/agents/**` is the sub-agent roster: compatibility conformance,
  data-oriented performance, native bridge, read-only refactor auditor,
  TypeScript API, and Zig protocol. Each agent inherits the rules here and
  loads the skills relevant to its ownership area.

## Workflow notes

- Commits follow Conventional Commits (`.github/COMMIT_CONVENTION.md`).
  Scopes in use: `compat`, `binding`, `types`, `codec`, `protocol`, `engine`,
  `build`, `deps`, `docs`, `ci`, `autobahn`, `lint`, `format`, `style`.
- Before every commit, run `pnpm lint`, `pnpm format:check`, and
  `pnpm exec lefthook run pre-commit --all-files`; fix violations with
  `pnpm lint:fix` and `pnpm format`. Never bypass hooks with `--no-verify`.
- `ws` behavior is the compatibility contract. When adding a surface, check
  what `ws` does and test both implementations once the conformance harness
  exists. `ws` may be a devDependency only, never a runtime dependency.
- `package.json` `files` ships only `dist/`; the addon itself ships as the
  `@ventiws/binding-*` package for the reader's platform, selected by npm from
  the `os`, `cpu`, and `libc` fields the build graph writes.
  `src/builds/platforms.zig` is the one list of published platforms, and
  `src/binding/target.ts` is the loader's copy of it;
  `tests/tooling/publish-platforms.test.ts` holds the two together. Windows is
  absent from both on purpose, because the pinned `napi-zig` cannot link a
  Windows target, and that file says so.
  `tsdown` copies the host `.node` into `dist/` only when a build produced one,
  so a checkout is runnable and a release is not carrying a foreign binary.
  `.github/workflows/publish.yml` builds every published platform on a runner
  that is native for it and publishes six packages with `NPM_TOKEN`, not
  trusted publishing: npm can only configure that for a package that already
  exists, and the five binding packages do not yet.
