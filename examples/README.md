# ventiws examples

Runnable quickstarts that install the published `ventiws`. The three runtime
examples share one `index.ts` to show that the `ws` API does not change with
the host; `effect-rpc-ventiws` shows ventiws behind Effect RPC. Each directory
is a standalone project, not part of the repository's pnpm workspace.

| Example                                    | Stack                 | Run                               |
| ------------------------------------------ | --------------------- | --------------------------------- |
| [`vanilla-ventiws`](vanilla-ventiws)       | Node.js 22.18+        | `pnpm install && pnpm start`      |
| [`bun-ventiws`](bun-ventiws)               | Bun                   | `bun install && bun run start`    |
| [`deno-ventiws`](deno-ventiws)             | Deno 2                | `deno install && deno task start` |
| [`effect-rpc-ventiws`](effect-rpc-ventiws) | Node.js, Effect RPC 4 | `pnpm install && pnpm start`      |

The Node.js projects carry their own `pnpm-workspace.yaml` so they are their own
workspace roots: without it, a `pnpm install` run inside the example resolves
the repository workspace above. Their excludes admit the newest published
dependencies through pnpm's 24-hour supply-chain window, because tracking the
latest release is the example's job. Bun and Deno look no further than the
example's own `package.json`.

Every manifest asks for the `latest` dist-tag, so the examples exercise the
newest published release and never state a version a release leaves behind.

Each project runs TypeScript directly: Node.js strips types since 22.18, and
Bun and Deno execute it natively. Only the Node.js projects need `@types/node`;
Bun uses `@types/bun`, and Deno's own `deno check` covers the example without
an extra package.

The three runtime copies share one `index.ts`. It starts a `WebSocketServer` on
an ephemeral port, connects a `WebSocket` client once the server is listening,
sends one text frame, prints the echo, and closes; the run ends by itself.

`effect-rpc-ventiws` is a four-file project instead: `rpc.ts` defines the RPC
group and handlers, `server.ts` implements Effect's `SocketServer` over a
ventiws server, `client.ts` dials with Node's global `WebSocket`, and `index.ts`
wires them. It calls an `Echo` RPC and collects a three-element `Tick` stream.
The server setup follows
[maxostarr/express-effect-rpc](https://github.com/maxostarr/express-effect-rpc)
with ventiws in place of `ws`; Effect 4 ships `effect/socket` and `effect/rpc`,
where Effect 3 used `@effect/platform` and `@effect/rpc`.

The Deno run needs `--allow-net` for the sockets, `--allow-env` because
importing ventiws reads `VENTIWS_LOG`, and `--allow-ffi` for the native addon.
`--allow-read` covers the addon loader's filesystem fallbacks; an installed
`@ventiws/binding-*` resolves without it. `deno.json` carries all four, and
exempts ventiws from Deno's own 24-hour minimum dependency age so the example
can track the newest release.

`pnpm typecheck`, `bun run typecheck`, `deno task typecheck`, and the Effect
example's `pnpm typecheck` check each example without running it.
