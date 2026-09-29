//! A self-signed `wss:` server, shared by the client suites that need one. Its own module
//! because the certificate is generated with `openssl` and taking a minute to mint, so a
//! suite that needs two servers should mint one.

import { execFileSync } from "node:child_process";
import { createServer as createHttps, type Server as HttpsServer } from "node:https";
import type { Server as HttpServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";

export type Certificates = { readonly ca: Buffer; readonly key: Buffer; readonly cert: Buffer };

export type TlsHarness = {
  readonly url: string;
  /// The certificate to hand a client as `ca`, so a caller can trust this server.
  readonly ca: Buffer;
  close(): Promise<void>;
};

let cached: Certificates | null = null;

/// A self-signed certificate for `localhost`. `127.0.0.1` is deliberately absent from the
/// subject alternative name: Node warns about an IP `servername`, and the point is a name
/// the client resolves.
export function certificates(): Certificates {
  if (cached !== null) return cached;
  const dir = mkdtempSync(join(tmpdir(), "ventiws-tls-"));
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "2",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
  ]);
  cached = { ca: readFileSync(cert), key: readFileSync(key), cert: readFileSync(cert) };
  return cached;
}

/// A `wss:` server on that certificate, echoing every message back.
export async function tlsServer(): Promise<TlsHarness> {
  const { ca, key, cert } = certificates();
  const http: HttpsServer = createHttps({ key, cert });
  const wss = new WebSocketServer({ server: http as unknown as HttpServer });
  wss.on("connection", (socket) => {
    socket.on("message", (data) => socket.send(data));
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
  const port = (http.address() as { port: number }).port;
  return {
    url: `wss://localhost:${port}/`,
    ca,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close(() => resolve());
      }),
  };
}

export { TEST_TIMEOUT_MS };
