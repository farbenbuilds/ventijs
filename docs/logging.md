# The ventiws dev logger

`ventiws/logging` is an opt-in, zero-dependency ANSI logger with a startup splash.
It is additive to the `ws` surface: the root entry still mirrors `ws` exactly, so
nothing about a `ws` migration changes. Nothing in the library imports the logger
either, so a `ventiws` process writes to stdout only when the host asks it to.

It exists for the same reason the splash looks familiar: a developer starting a
server wants one small, consistent place to say what happened, without taking a
logging dependency to get it.

## Reaching it

The logger is a subpath, not a root export, because a logger is not part of the
`ws` API. Both module systems and both `types` conditions are published:

```ts
// ESM, and TypeScript under any resolution mode
import { info, ready, fatal, setLoggerEnabled, warn } from "ventiws/logging";

// CommonJS
const { info, ready, setLoggerEnabled } = require("ventiws/logging");
```

`tests/declarations/logging.ts` and `logging.cts` compile the subpath through the
package `exports` map with `moduleResolution: node16` and `skipLibCheck: false`,
so the conditions are held to the same bar as the root entry.

## Turning it on and off

The logger is enabled when the module loads. One process-wide switch governs all
five functions:

```ts
import { setLoggerEnabled } from "ventiws/logging";

setLoggerEnabled(process.env.VENTIWS_LOG !== "0");
```

Every writer opens with `if (!isEnabled) return;`, so a disabled logger formats
nothing. `setLoggerEnabled` itself is deliberately unguarded: a guard there would
make a disabled logger impossible to re-enable.

The switch is process-wide rather than per-server or per-socket, and there is no
environment variable or option object. The host decides, which is what keeps the
logger out of the `ws` contract.

The logger does not detect a TTY. It always emits raw SGR escape codes, so output
redirected to a file carries them. Disable the logger for machine-readable output,
or strip `\u001B\[[0-9;]*m` at the consumer.

## Records: `info`, `warn`, `fatal`

The three record functions share one shape:

```
{time} | {command} : {status}
```

`time` is local wall-clock time as `HH:MM:SS`. The function is the level, so no
level word appears in the line; severity is carried by color instead. The time is
dim, `info` paints the command cyan, `warn` yellow, and `fatal` red, and every
painted field is reset.

```ts
info("pnpm build", "ok"); // 10:04:05 | pnpm build : ok
warn("pnpm lint", "dirty");
fatal("pnpm test", "3 failed");
```

`fatal` records and returns; it does not throw or exit the process. The caller owns
its exit policy.

## The startup splash: `ready`

`ready(version, timeMs, port)` prints the banner and address a developer expects on
startup, in exactly this order:

1. the six-line block banner spelling VENTIWS,
2. a blank line,
3. `ventiws {version} ready in {timeMs}`,
4. a blank line,
5. `➜  Local: localhost:{port}/`,
6. a blank line.

`timeMs` is the caller's measurement and is printed as given, with no unit suffix.
`ready` binds nothing and reads nothing: it is a formatter, so the host passes the
version it ships, the time it measured, and the port the listener actually bound.

It is not called automatically by `WebSocketServer`. A server that printed on
startup would break the drop-in silence `ws` promises; the host wires it into the
`listening` event.

## A full example

```ts
import { WebSocket, WebSocketServer } from "ventiws";
import { fatal, info, ready, setLoggerEnabled, warn } from "ventiws/logging";

setLoggerEnabled(process.env.VENTIWS_LOG !== "0");

const startedAt = Date.now();
const server = new WebSocketServer({ port: 8080 });

server.on("listening", () => {
  ready("1.0.0-beta", Date.now() - startedAt, server.address()?.port ?? 8080);
});

server.on("connection", (socket) => {
  info("server", "connection open");

  socket.on("message", (data, isBinary) => {
    info("server", "echo");
    socket.send(isBinary ? data : `echo: ${data.toString()}`);
  });

  socket.on("close", (code, reason) => {
    warn(`close ${code}`, reason.toString() || "no reason");
  });
});

const client = new WebSocket("ws://127.0.0.1:8080/");
client.on("open", () => client.send("hello"));
client.on("message", (data) => {
  info("client", `saw ${data.toString()}`);
  client.close(1000, "done");
});
client.on("error", (error) => fatal("client", error.message));

// Turn it off whenever you like: setLoggerEnabled(false)
```

## What it deliberately is not

- Not part of the `ws` compatibility contract, and not a divergence from it.
- Not a dependency: the module imports nothing and ships in `dist/` like any entry.
- Not a logging framework: there are no levels beyond the three functions, no sinks,
  no formatting options, and no log rotation. Use a dedicated logger for that, and
  keep this one for the process a developer has open.
- Not stateful per connection: one flag, one stdout, no files.

The evidence for the behavior above is `tests/logging/logger.test.ts`, which pins
the record format, the disabled path, the re-enable path, and the splash bytes.
