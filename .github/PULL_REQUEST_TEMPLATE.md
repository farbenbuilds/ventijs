## Description

Describe the change and why it belongs in ventiws. Link the issue it closes.

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (a `ws` behavior or public type changes)
- [ ] Performance improvement (with measured numbers)
- [ ] Refactoring (no functional change)
- [ ] Documentation update
- [ ] Build or CI change

## Release

Every merge releases unless this pull request is labeled `release:skip`. Label
it with a `release:<kind>` label (`stable`, `patch`, `minor`, `major`, `alpha`,
`beta`, or `rc`) to direct the version step; an unlabeled merge advances the
current train, or starts the next patch's train after a stable version. See
[CONTRIBUTE.md](../CONTRIBUTE.md#releasing).

## Compatibility

- [ ] This change preserves `ws` behavior for the affected surface.
- [ ] Any intentional divergence from `ws` is documented here with a linked
      issue and rationale.
- [ ] No new runtime dependency was added beyond `napi-zig` and `uWebZockets`.

## Checklist

- [ ] I have read [CONTRIBUTE.md](../CONTRIBUTE.md) and
      [CODING_CONVENTION.md](../CODING_CONVENTION.md).
- [ ] No classes, `this`, `extends`, or prototype mutation were introduced.
- [ ] Every touched source file stays near or below 150 lines.
- [ ] Control flow uses guard clauses; no nested `if`/`else` ladders.
- [ ] `pnpm lint` passes.
- [ ] `pnpm format:check` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm exec lefthook run pre-commit --all-files` passes.
- [ ] `pnpm build` produces the bundle and declarations.
- [ ] `zig fmt --check --exclude zig-pkg src build.zig` passes for Zig changes.
- [ ] Boundary changes cover payload retention, buffer copying, exactly-once
      `close`, stale handles, and capacity exhaustion.
- [ ] `ws` conformance tests pass for compatibility changes.
- [ ] Autobahn passes with no exclusions for framing or compression changes.
- [ ] `pnpm bench` includes the `ws` baseline and the numbers are in the
      description for performance changes.
- [ ] Public type changes are reflected in the generated declarations.
- [ ] Documentation and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)
      are updated for surface, limit, or dependency changes.
