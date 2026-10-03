import { createServer, type Server as HttpServer } from "node:http";
import { connect } from "node:net";
import type { WebSocketServer } from "../../../src/index";

export const KEY = "dGhlIHNhbXBsZSBub25jZQ==";
export const ACCEPT = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";

export type RawResult = {
  readonly response: string;
  readonly status: number;
};

/// Resolves once the status line, the header block, and any declared body have
/// all arrived, so a rejection keeps its full body instead of racing the
/// header terminator. The wire timeout stays only as a safety net.
function responseComplete(data: string): boolean {
  const headerEnd = data.indexOf("\r\n\r\n");
  if (headerEnd === -1 || !data.startsWith("HTTP/1.1 ")) return false;
  if (data.startsWith("HTTP/1.1 101")) return true;
  const length = /^content-length:\s*(\d+)$/im.exec(data.slice(0, headerEnd));
  if (length === null) return true;
  return data.length >= headerEnd + 4 + Number(length[1]);
}

/// Reads the status from a complete status line instead of a fixed offset, so
/// a partial wire read can never fabricate a status.
function statusOf(data: string): number {
  if (!data.includes("\r\n\r\n")) return 0;
  const match = /^HTTP\/1\.1 (\d{3})\b/.exec(data);
  return match === null ? 0 : Number(match[1]);
}

export function rawUpgrade(port: number, request: string, waitMs = 200): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(request);
    });
    let data = "";
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ response: data, status: statusOf(data) });
    };
    socket.setTimeout(waitMs, finish);
    socket.on("end", finish);
    socket.on("close", finish);
    socket.on("data", (chunk) => {
      data += chunk.toString("latin1");
      if (responseComplete(data)) finish();
    });
    socket.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

export function request(
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
): string {
  const lines = [`${method} ${path} HTTP/1.1`, "Host: 127.0.0.1"];
  for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`);
  lines.push("", "");
  return lines.join("\r\n");
}

export const UPGRADE_HEADERS = {
  Upgrade: "websocket",
  Connection: "Upgrade",
  "Sec-WebSocket-Key": KEY,
  "Sec-WebSocket-Version": "13",
};

export type Harness = {
  readonly port: number;
  readonly server: WebSocketServer;
  readonly httpServer: HttpServer;
  close(): Promise<void>;
};

/// Wires a `noServer` facade to a real HTTP server the way `ws` documents:
/// the user owns the upgrade event and forwards accepted sockets.
export async function serve(server: WebSocketServer): Promise<Harness> {
  const httpServer = createServer();
  httpServer.on("upgrade", (incoming, socket, head) => {
    server.handleUpgrade(incoming, socket, head, (accepted, incomingRequest) => {
      // A reset after a test tears its peer down is expected; without a listener Node
      // rethrows the socket's `error` as an uncaught exception and fails the whole suite.
      accepted.on("error", () => undefined);
      server.emit("connection", accepted, incomingRequest);
    });
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  const address = httpServer.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    port,
    server,
    httpServer,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          httpServer.close(() => {
            resolve();
          });
        });
      }),
  };
}
