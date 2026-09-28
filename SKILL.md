---
name: ventijs
description: Work on ventijs, a pre-alpha TypeScript and Zig Node.js native addon that replaces the ws server API using the µWebZockets engine through napi-zig. Use for binding functions, the ws compatibility surface, Zig engine modules, tests, benchmarks, docs, and CI in this repository.
---

# ventijs Skill Map

This file is the map from work in this repository to the installed skill pack.
It carries nothing else: [AGENTS.md](AGENTS.md) holds the current branch state
and the commands, and the documents below own every fact about the tree.

Load `.agents/skills/using-agent-skills/SKILL.md` first; it routes to the
lifecycle skill, and this file routes to the domain ones.
`.agents/skills/**` is pinned by `skills-lock.json`; never hand-edit an
installed skill, and commit the lockfile and the skill tree together.

## Where the facts live

| Question                                                   | Owner                                        |
| ---------------------------------------------------------- | -------------------------------------------- |
| What the tree looks like and how data crosses the boundary | [CODEBASE.md](CODEBASE.md)                   |
| What is implemented, what is missing, what proves it       | [COMPATIBILITY.md](COMPATIBILITY.md)         |
| Which `ws` API item maps to which module                   | [docs/compliance.md](docs/compliance.md)     |
| What style is enforced and by which tool                   | [CODING_CONVENTION.md](CODING_CONVENTION.md) |
| What to run                                                | [CONTRIBUTE.md](CONTRIBUTE.md)               |
| What CI runs and what each job gates on                    | [CI_CD_PIPELINE.md](CI_CD_PIPELINE.md)       |
| Why a decision was made                                    | [docs/adr/](docs/adr)                        |

Where prose and the tree disagree, `package.json`, `tsconfig.json`,
`flake.nix`, and `src/` are right. `ws` is the compatibility contract: read its
source or its tests before choosing a shape, and mirror what you find.

## Lifecycle skills

| Work                              | Load                                                     |
| --------------------------------- | -------------------------------------------------------- |
| Ambiguous ask or vague idea       | `interview-me`, `idea-refine`                            |
| New feature or protocol surface   | `spec-driven-development`, `planning-and-task-breakdown` |
| Quality bar not written down      | `constraint-driven-development`                          |
| Multi-file implementation         | `incremental-implementation`                             |
| API or FFI shape decisions        | `api-and-interface-design`                               |
| Verify against official sources   | `source-driven-development`, `context7`                  |
| Test-first changes                | `test-driven-development`                                |
| Divergence or failing case        | `debugging-and-error-recovery`                           |
| Non-trivial or irreversible call  | `doubt-driven-development`                               |
| Pre-merge review                  | `code-review-and-quality`, `code-simplification`         |
| Untrusted input and lifetime risk | `security-and-hardening`                                 |
| Measured performance work         | `performance-optimization`                               |
| Logs, metrics, alerts             | `observability-and-instrumentation`                      |
| Commits, PRs, releases            | `git-workflow-and-versioning`, `shipping-and-launch`     |
| CI workflow changes               | `ci-cd-and-automation`                                   |
| Docs and ADRs                     | `documentation-and-adrs`, `documentation-writer`         |
| Retiring an export or option      | `deprecation-and-migration`                              |

## Domain skills

| Work                            | Load                                                                      |
| ------------------------------- | ------------------------------------------------------------------------- |
| Public types, strict API design | `typescript-expert`, `typescript-advanced-types`                          |
| Bundle shape, declarations      | `tsdown`                                                                  |
| Slabs, SoA, SIMD, cache layout  | `dod`                                                                     |
| Pure functions, explicit state  | `functional-programming-fundamentals`, `pragmatic-functional-programming` |
| Module splitting, review        | `separation-of-concerns`, `clean-code`                                    |
| Zig language and API changes    | `zig-0.16`, `zig-best-practices`                                          |
| Zig build graph                 | `zig-build-system`                                                        |
| Capacities and specialization   | `zig-comptime`                                                            |
| C interop at the FFI edge       | `zig-cinterop`                                                            |
| Native build matrix             | `zig-cross`, `nix-best-practices`                                         |
| Zig tests, fuzz corpora         | `zig-testing`                                                             |
| Zig failures                    | `zig-debugging`, `zig-compiler`                                           |
| Minimal correct solution        | `ponytail`                                                                |
| Dense commit and PR text        | `caveman`                                                                 |
| API lookups                     | `context7`                                                                |

## Two things to do first

Answer architecture questions from the graph when one exists. `graphify query`,
`graphify path`, and `graphify explain` read `graphify-out/graph.json`, and
`/graphify --update` refreshes a stale one. `graphify-out/` is generated
output: never commit it or edit it by hand.

Read `ws` before changing the surface. `ws` 8.21.3 and `@types/ws` 8.18.1 are
pinned devDependencies, the declarations are vendored at
`src/types/ws.d.ts`, and the upstream API reference is vendored at
[docs/ventijs.md](docs/ventijs.md). Where `ws` is ambiguous, write the decision
into the pull request; a silent divergence is a defect.
