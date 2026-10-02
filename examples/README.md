# ventiws examples

The same echo server and client, once per runtime, to show that the `ws` API
does not change with the host. Each directory is a standalone project that
installs `ventiws` from npm; none of them is part of the repository's pnpm
workspace, so they resolve the published package rather than the checkout.

| Example                              | Runtime        | Run                               |
| ------------------------------------ | -------------- | --------------------------------- |
| [`vanilla-ventiws`](vanilla-ventiws) | Node.js 22.18+ | `pnpm install && pnpm start`      |
| [`bun-ventiws`](bun-ventiws)         | Bun            | `bun install && bun run start`    |
| [`deno-ventiws`](deno-ventiws)       | Deno 2         | `deno install && deno task start` |

The Node.js project carries its own `pnpm-workspace.yaml` so it is its own
workspace root: without it, a `pnpm install` run inside the example resolves the
repository workspace above. Its excludes admit the newest `ventiws`, its
binding, and `@types/node` through pnpm's 24-hour supply-chain window. Bun and
Deno look no further than the example's own `package.json`.

Every manifest asks for the `latest` dist-tag, so the examples exercise the
newest published release and never state a version a release leaves behind.

Each project runs `index.ts` directly: Node.js strips types since 22.18, and
Bun and Deno execute TypeScript natively. Only the Node.js project needs
`@types/node`; Bun uses `@types/bun`, and Deno's own `deno check` covers the
example without an extra package.

Every `index.ts` is the same file. It starts a `WebSocketServer` on an
ephemeral port, connects a `WebSocket` client once the server is listening,
sends one text frame, prints the echo, and closes; the run ends by itself.

The Deno run needs `--allow-net` for the sockets, `--allow-env` because
importing ventiws reads `VENTIWS_LOG`, and `--allow-ffi` for the native addon.
`--allow-read` covers the addon loader's filesystem fallbacks; an installed
`@ventiws/binding-*` resolves without it. `deno.json` carries all four, and
exempts ventiws from Deno's own 24-hour minimum dependency age so the example
can track the newest release.

`pnpm typecheck`, `bun run typecheck`, and `deno task typecheck` check the
example without running it.
