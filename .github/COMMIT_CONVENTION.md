# Git Commit Message Convention

[Conventional Commits](https://www.conventionalcommits.org/), adapted from
[Angular's convention](https://github.com/conventional-changelog/conventional-changelog/tree/master/packages/conventional-changelog-angular).
It keeps the changelog and the release notes mechanical: `CHANGELOG.md` is
written from the same subjects `git log` filters on.

## Format

```text
<type>(<scope>): <subject>

<body>

<footer>
```

The header is mandatory. The scope is optional. Body and footer are optional,
but a breaking change requires a footer.

## Types

| Type       | Use for                                                   |
| ---------- | --------------------------------------------------------- |
| `feat`     | A new user-visible capability                             |
| `fix`      | A behavior fix, including a `ws` compatibility correction |
| `perf`     | A measured performance change                             |
| `refactor` | A restructure with no behavior change                     |
| `test`     | Test additions or corrections                             |
| `docs`     | Documentation only                                        |
| `build`    | Build graph, packaging, dependency pins, native artifacts |
| `ci`       | Workflow and pipeline changes                             |
| `style`    | Formatting with no behavior change                        |
| `chore`    | Maintenance that fits no other type                       |

`feat`, `fix`, and `perf` reach the changelog. A commit containing
`BREAKING CHANGE:` reaches it regardless of type.

## Scopes

The module or boundary being changed. These are the scopes the repository has
used, with the counts from the first commit to the last:

| Scope      | Covers                                                           | Uses |
| ---------- | ---------------------------------------------------------------- | ---- |
| `compat`   | The `ws`-shaped surface in `src/compat/`                         | 7    |
| `engine`   | Zig-side protocol work in `src/engine/`                          | 7    |
| `types`    | The public type surface                                          | 3    |
| `build`    | `build.zig`, `build.zig.zon`, `src/builds/`, packaging           | 3    |
| `format`   | A formatting-only change                                         | 2    |
| `lint`     | A linter rule or its configuration                               | 2    |
| `protocol` | Pure helpers such as `src/protocol/close-codes.ts`               | 1    |
| `deps`     | A dependency pin, with the matching `THIRD_PARTY_NOTICES.md` row | 1    |
| `codec`    | The Zig frame codec in `src/engine/codec/`                       | 1    |
| `binding`  | The typed addon ABI in `src/binding/`                            | 1    |
| `ci`       | Pipeline changes under `.github/workflows/`                      | 1    |
| `autobahn` | The RFC 6455 harness and its job                                 | 1    |

A commit that spans boundaries takes the one that carries the change, or none.

## Subject, body, footer

Imperative, present tense: `add`, not `added` or `adds`. No leading capital, no
trailing period, under 72 characters. Name the defect rather than the activity:
`finishRequest and generateMask, two options that did nothing` beats `fix request
handling`.

The body is imperative too. Motivation first, then what changed and why the old
behavior was wrong; the history belongs here and not in a second retelling. A
`perf` commit carries the measured number and names the benchmark and the host.

The footer carries `BREAKING CHANGE:` with the impact and the required migration,
`Closes #<number>` for a closed issue, and any known limitation that matters to
a consumer rather than omitting it.

## Examples

Both abbreviated from real commits, `76d3257` and `a2217a8`:

```text
fix(compat): finishRequest and generateMask, two options that did nothing

Both are declared by @types/ws, so a caller reached them in typed code and got
silence. finishRequest was accepted, carried through normalization, and then
ignored: both the first dial and every redirect hop called request.end()
unconditionally, so a caller adding a last-moment signature header got no header
and no error.
```

```text
perf(engine): mask and deflate through the engine, not around it

The codec route masked with zslay.frame.mask, a word-at-a-time loop, while
uWebZockets.websocket_mask -- the mask the engine route itself uses -- is
exported from the same engine and picks a 16-byte vector path on x86 and NEON.
```

The contribution process is in [CONTRIBUTE.md](../CONTRIBUTE.md).
