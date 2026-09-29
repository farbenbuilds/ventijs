# ventiws Coding Conventions

These conventions bind both languages in this repository. They adapt the spirit
of the Linux kernel coding style to strict TypeScript and Zig 0.16.0, and they
exist to keep the codebase pure functional, data-oriented, and predictable.

## 1. Universal rules

- **Zero object-oriented programming.** No classes, no `this`, no `extends`,
  no prototype mutation, no stateful objects that own behavior. See section 3
  for the sanctioned TypeScript patterns.
- **Guard clauses first.** Validate and return early. The happy path stays at
  the lowest indentation level. Never build nested `if`/`else` ladders.
- **One responsibility per module.** Split by concern before a file grows a
  second reason to change. No source file exceeds roughly 150 lines.
- **Pure functions where practical.** Pass state explicitly. I/O state is
  confined to the transport boundary.
- **No emojis anywhere.** Not in code, comments, documentation, issue forms, or
  commit messages.
- **Comments say why, in one or two sentences.** An RFC section, a byte value
  and its reason, a capacity and why that number, a deliberate divergence from
  `ws`, an invariant that prevents a bug. Never a restatement of the identifier
  or the signature, a narration of the next line, a module essay, or a
  post-mortem of a fixed bug. `scripts/check-conventions.mjs` enforces a 0.45
  comment-to-code ratio, a 10-line maximum run, and no `//!` in TypeScript.
- **No new runtime dependencies.** The published package may import only
  `napi-zig` and `uWebZockets`. Everything else is a development tool.

## 2. Control flow

Return early, use `switch` over long conditionals, and keep loops free of mode
branches.

TypeScript:

```ts
function normalizePort(input: unknown): number {
  if (typeof input !== "number" || !Number.isInteger(input)) throw invalidPort(input);
  if (input < 0 || input > 65535) throw invalidPort(input);
  return input;
}
```

Zig:

```zig
fn normalize_port(input: i64) !u16 {
    if (input < 0) return error.InvalidPort;
    if (input > 65535) return error.InvalidPort;
    return @intCast(input);
}
```

Rejected shape:

```ts
if (condition) {
  // deep branch
} else {
  // deep branch
}
```

### Rules

- Use `switch` for exhaustive dispatch. Zig exhaustiveness is a feature.
- Declare variables as close to first use as possible.
- Do not use `else` after a block that returns.
- Bound every loop. Unbounded `while (true)` requires a documented exit
  invariant and belongs at the event-loop boundary only.
- Prefer iteration over a caller-provided slice to allocating an intermediate
  collection.

## 3. No OOP, by construction

### TypeScript patterns

`ws` compatibility demands constructor-shaped call sites. Satisfy them with
plain functions that return explicit state records. A function that returns an
object works with `new` without ever touching `this`, and still delivers a
frozen instance:

```ts
export function createSocket(options: SocketOptions): SocketHandle {
  const listeners = createListenerRegistry();
  const state = { readyState: CONNECTING, bufferedAmount: 0 };

  const send = (data: Buffer, sendOptions?: SendOptions): boolean => {
    if (state.readyState !== OPEN) return false;
    return bindingSend(options.connection, data, sendOptions);
  };

  return {
    send,
    close,
    ping,
    on,
    off,
    get bufferedAmount() {
      return state.bufferedAmount;
    },
  };
}
```

Rules:

- State lives in `const` records or closures, never on `this`.
- Behavior is composed from free functions. Reuse means calling functions, not
  extending prototypes.
- Event handling uses an explicit listener registry module. It stores handler
  functions in arrays and dispatches over a snapshot.
- Data records are plain `type` aliases. Use discriminated unions for variants,
  not subclasses.
- Prefer `readonly` fields and `ReadonlyArray` on records that cross modules.
- Do not use `enum`; use `as const` unions so values remain plain strings or
  numbers at the boundary.

### Zig

Zig has no classes. The equivalent failure modes are hidden globals and
receiver-style functions that silently mutate captured state.

- Pass the state pointer explicitly as the first parameter and name it for what
  it is (`state`, `conn`, `server`), never `self`.
- No module-level mutable variables. Compile-time constants are fine. The one
  sanctioned exception is the bounded server-instance table in
  `src/engine/server/instance.zig`: the engine callback ABI carries no user context, so that
  table is the explicit binding between context-free callbacks and state. It is
  written only by create/finalize on the Node main thread, read by engine
  callbacks through comptime slots, and reached from JavaScript only through
  generation-checked handles.
- No allocator stored inside the state it allocates for.

## 4. TypeScript conventions

- **Files:** `kebab-case` (`close-codes.ts`, `event-registry.ts`).
- **Variables and functions:** `camelCase`.
- **Types and interfaces:** `PascalCase`.
- **Constants:** `SCREAMING_SNAKE_CASE` only for true constants; prefer
  `as const` objects for groups.
- **Imports:** `import type` for type-only imports. `verbatimModuleSyntax`
  enforces this; the build fails otherwise.
- **Exports:** named exports only. No default exports. Exceptions: `src/index.ts`
  mirrors `ws` with a default export that carries both the runtime value and the
  instance type, so `import WebSocket from "ventiws"` and
  `import type WebSocket from "ventiws"` stay drop-in; `tsdown.config.ts` and
  `scripts/oxlint-plugin.mjs` are tooling entry points, exempted by the oxlint
  overrides.
- **Types over interfaces** unless declaration merging is required.
- **Semicolons:** every statement and type member ends with `;`. `oxfmt`
  enforces this, including code samples embedded in Markdown.
- **No `any`.** Use `unknown` at untrusted boundaries and narrow explicitly.
- **No non-null assertions** in binding code. Validate the handle exists.
- **Explicit return types** on every exported function.
- Public option types mirror `ws` names exactly. Internal names never leak.
- Errors are `Error` instances with a stable string `code`; never throw
  strings or bare numbers.
- Async functions do not mix `await` with callback-style native completion in
  the same module. One style per boundary.

### Type readability

Types are documentation first. Write the shape you mean; never make the
reader evaluate it in their head.

- Prefer explicit unions over derived ones. Spell out `ErrorStatus` instead of
  asking the reader to compute `Exclude<EngineStatus, ...>`.
- Name every non-trivial inline shape where it appears, then use the alias.
  Anonymous structural types nested inside signatures do not survive review.
- Keep generics shallow: one type parameter, one constraint, one alias hop. No
  recursive conditional types, no `infer`, no mapped-type puzzles.
- An alias must read like its name. When a type needs a paragraph to explain,
  split it into named pieces instead.

## 5. Zig conventions

- **Files, functions, variables:** `snake_case`, overriding standard Zig
  `camelCase` to match the Linux kernel style.
- **Types:** `PascalCase` for structs, enums, unions, and error sets.
- **Formatting:** `zig fmt` is authoritative. Do not hand-align or fight the
  formatter.
- **Errors:** native error sets (`!Type`). Never swallow an error silently;
  document any intentionally ignored error. `catch unreachable` requires a
  written proof of impossibility.
- **Allocation:** hot paths allocate nothing. Capacity is a `comptime`
  constant derived from named limits, never a runtime guess.
- **Slices over pointers:** prefer `[]u8` and `[]const u8` with explicit
  lengths. Raw pointers require an FFI reason.
- **`defer` and `errdefer`** own cleanup. A function that acquires a resource
  releases it on every exit path.
- **C interop:** raw `@cImport` or translated bindings stay in a dedicated
  FFI module with the original C names. Public wrappers use `snake_case` and
  Zig error sets.
- **SIMD:** masking and UTF-8 validation operate on native vectors first and
  handle the scalar tail in a separate function. The scalar tail is tested
  independently.
- **Struct layout:** order fields largest to smallest to minimize padding
  unless a C ABI layout demands otherwise. Comment any deliberate exception.

## 6. Boundary conventions

- Every N-API export is a free function. It takes primitive values, slices, or
  opaque integer handles, and returns a status code or a value type.
- No pointer from the engine may outlive the call that produced it. Payloads
  that JavaScript can retain are copied into Node-owned `Buffer` instances
  before dispatch.
- Every handle carries a generation counter. A stale generation is a typed
  error, never a use-after-free.
- Completion callbacks fire at most once. The binding latches terminal state
  before dispatch.
- Cross-thread notification uses one threadsafe-function channel per instance.
  Do not call into JavaScript from an engine thread directly.

## 7. Formatting and linting

| Scope                          | Tool                                         | Command                                           |
| ------------------------------ | -------------------------------------------- | ------------------------------------------------- |
| TypeScript and JSON formatting | `oxfmt`                                      | `pnpm format` (`pnpm format:check` to verify)     |
| TypeScript linting             | `oxlint`                                     | `pnpm lint` (`pnpm lint:fix` to apply safe fixes) |
| Type checking                  | `tsc --noEmit` (or the `tsdown` `tsgo` path) | `pnpm typecheck`                                  |
| Zig formatting                 | `zig fmt`                                    | `zig fmt --check --exclude zig-pkg src build.zig` |
| Nix formatting                 | `alejandra`                                  | `nix fmt`                                         |

`.oxfmtrc.json` is authoritative for layout: double quotes, semicolons, and
trailing commas in every multiline construct. `.oxlintrc.json` encodes the
mechanically checkable rules from this document.
The local plugin in `scripts/oxlint-plugin.mjs` bans classes, `this`, prototype
mutation, enums, and emoji; native rules cover `max-lines`, `no-else-return`,
`typescript/consistent-type-definitions`, `typescript/consistent-type-imports`,
`typescript/explicit-module-boundary-types`, `typescript/no-explicit-any`,
`typescript/no-non-null-assertion`, `import/no-default-export`, and
`unicorn/filename-case`. `lefthook.yml` runs the checks before every commit.

Run `pnpm lint`, `pnpm format:check`, and
`pnpm exec lefthook run pre-commit --all-files` before every commit. Apply
fixes with `pnpm lint:fix` and `pnpm format` instead of hand-editing around the
tools. The hooks are a local convenience, not the gate: CI runs the same
commands, and `--no-verify` is never allowed.

A pull request is not ready while any of these fail. Do not add inline
suppressions without a comment that states why the rule cannot apply.

## 8. Testing conventions

- Unit tests live in `tests/` and use `vitest` with explicit imports.
- Pure helpers are tested with table-driven cases. One `test.each` table beats
  a dozen near-identical `test` blocks.
- Boundary tests assert lifetime rules: retained payloads stay valid, send
  buffers are copied, close fires exactly once, stale handles error.
- Protocol tests feed fixed byte sequences and assert byte-exact output.
- Never mock the native binding for behavior that the binding itself defines;
  mock at the module seam and keep the seam small.
- Performance assertions belong in `bench/`, never in the unit suite.
