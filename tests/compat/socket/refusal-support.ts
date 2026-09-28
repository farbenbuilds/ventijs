//! The refusal harness: one server, one malformed frame, and what each side hears.
//!
//! Its own module because the two refusal suites need it and it is the part that decides
//! whether a test means anything. The server is ventijs's own, so the socket is the
//! facade's and the frames are the codec's.

import type { WebSocketServer } from "../../../src/index";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { openRawClient } from "../../binding/codec-net";
import { nextSocket, upgradeHarness } from "./codec-upgrade-support";

/// What one refused frame reported: the application's `error`, and the socket's `close`.
export type Seen = {
  readonly code: string;
  readonly ctor: string;
  readonly message: string;
  readonly closeCode: number;
};

/// A client frame's masking key, so a hand-written frame is written the way a client
/// writes one rather than the way a server would.
export const MASK: readonly number[] = [0x37, 0xfa, 0x21, 0x3d];

/// A frame the codec's own encoder refuses to build: a control frame the RFC forbids, a
/// reserved opcode, or a close payload with a reserved code. Written byte by byte.
export function rawFrame(bytes: readonly number[]): Buffer {
  return Buffer.from(bytes);
}

/// One server over one refused frame.
export async function refused(
  server: WebSocketServer,
  write: (send: (bytes: Buffer) => void) => void,
): Promise<Seen> {
  const harness = await upgradeHarness(server);
  const accepted = nextSocket(server);
  const raw = await openRawClient(harness.port);
  try {
    const socket = await accepted;
    const seen = new Promise<Seen>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("no refusal within the timeout")),
        TEST_TIMEOUT_MS,
      );
      socket.on("error", (error: Error & { code?: string }) => {
        clearTimeout(timer);
        socket.on("close", (code: number) => {
          resolve({
            code: error.code ?? "ERR_NONE",
            ctor: error.constructor.name,
            message: error.message,
            closeCode: code,
          });
        });
      });
    });
    write((bytes) => raw.write(bytes));
    return await seen;
  } finally {
    raw.destroy();
    await harness.close();
  }
}
