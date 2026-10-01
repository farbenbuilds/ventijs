# The ventiws dev logger

ventiws writes lifecycle records to stdout as they happen. There is no callback to
subscribe and no event to wire: a server prints a Vite-like splash when it starts
listening, and every connection prints what happens to it. The logger is a
zero-dependency ANSI module, it is on by default, and one switch silences it.

It is additive to the `ws` surface. The root entry still mirrors `ws` exactly,
and the logger is reached through the `ventiws/logging` subpath; a process with
`VENTIWS_LOG=0` sees the same stdout `ws` does.

## What gets recorded

The compat layer calls the logger at its lifecycle seams, just before it
dispatches the matching event, so a record still appears when a listener throws.

| Moment                  | Record                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| server starts listening | the splash, then `ventiws {version} ready in {timeMs}` and `➜  Local: localhost:{port}/` |
| server closes           | `server : closed` (`info`)                                                               |
| server error            | `server : {message}` (`fatal`)                                                           |
| a connection opens      | `connection : open` on the server side, `client : open` on the client                    |
| a connection closes     | `connection : closed {code} {reason}` or `client : closed ...` (`warn`)                  |
| a connection errors     | `connection : {message}` or `client : {message}` (`fatal`)                               |

Message frames and `ping`/`pong` are deliberately not recorded. A stdout write
per frame would sit on the hot path and move the echo numbers, and a line per
message is not what a lifecycle view is for.

## Turning it off

Two doors, one flag:

```sh
VENTIWS_LOG=0 node server.mjs
```

```ts
import { setLoggerEnabled } from "ventiws/logging";

setLoggerEnabled(false); // or true to bring it back
```

`VENTIWS_LOG=0` is read once, when the module loads; a host that decides at
runtime uses the function. The flag is process-wide rather than per-server or
per-socket, and `setLoggerEnabled` is unguarded on purpose: a guard there would
make a disabled logger impossible to re-enable.

The test suite sets `VENTIWS_LOG=0` once in `vitest.config.ts`, and the two files
that cover the logger re-enable it themselves. The logger does not detect a TTY,
so output redirected to a file carries the escape codes: disable it for
machine-readable output, or strip `\u001B\[[0-9;]*m` at the consumer.

## The record shape

The record functions share one shape:

```
{time} | {command} : {status}
```

`time` is local wall-clock time as `HH:MM:SS`. The function is the level, so no
level word appears in the line; severity is carried by color instead. The time is
dim, `info` paints the command cyan, `warn` yellow, and `fatal` red, and every
painted field is reset.

```ts
import { info, warn, fatal } from "ventiws/logging";

info("server", "started"); // 10:04:05 | server : started
warn("client", "closed 1006");
fatal("server", "EADDRINUSE");
```

`fatal` records and returns; it does not throw or exit the process. The caller
owns its exit policy.

## The startup splash

The `listening` record is `ready(...)`, the same function the subpath exports.
It prints, in order:

1. the six-line block banner spelling VENTIWS,
2. a blank line,
3. `ventiws {version} ready in {timeMs}`,
4. a blank line,
5. `➜  Local: localhost:{port}/`,
6. a blank line.

The automatic call passes the package version, the milliseconds since process
start, and the port the listener actually bound. A listener bound to a path
rather than a port, such as an external server on a Unix socket, records
`server : listening on {path}` instead, because the `Local:` line is a TCP
address. A host that wants the splash on its own schedule calls it directly with
its own numbers:

```ts
import { ready } from "ventiws/logging";

ready("1.0.0-beta", 42, 8080);
```

## A full example

No logger import, no logger call: the records arrive on their own.

```ts
import { WebSocket, WebSocketServer } from "ventiws";

const server = new WebSocketServer({ port: 8080 });

server.on("connection", (socket) => {
  socket.on("message", (data, isBinary) => {
    socket.send(isBinary ? data : `echo: ${data.toString()}`);
  });
});

const client = new WebSocket("ws://127.0.0.1:8080/");
client.on("open", () => client.send("hello"));
```

The terminal shows the splash, then `connection : open`, `client : open`, and the
close records as they happen. The manual API (`info`, `warn`, `fatal`, `ready`)
shares the same switch, so a host can add its own records to the same stream.

## What it deliberately is not

- Not part of the `ws` compatibility contract: the root surface is unchanged, and
  the automatic output is a documented divergence in
  [COMPATIBILITY.md](../COMPATIBILITY.md).
- Not a dependency: the module imports nothing but the package's own version.
- Not a logging framework: three record functions, one switch, one stdout. No
  levels, sinks, formatting options, or rotation. Use a dedicated logger for that
  and keep this one for the process a developer has open.
- Not per-message: see the table above for the exact set.

The evidence is `tests/logging/logger.test.ts` for the record format, the toggle,
the environment switch, and the splash bytes, and `tests/compat/logging.test.ts`
for the auto-wired lifecycle and the silent disabled path.
