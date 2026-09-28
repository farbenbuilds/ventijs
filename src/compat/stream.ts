import { Duplex } from "node:stream";
import type { DuplexOptions } from "node:stream";
import type { WebSocket } from "../types/ws";
import { closeFrameWritten } from "./socket/lifecycle";

/// Mirroring `ws` byte for byte: messages become readable chunks, writes become `send`
/// calls, and destroy terminates the socket unless the socket itself raised the error.
export function createWebSocketStream(ws: WebSocket, options?: DuplexOptions): Duplex {
  let terminateOnDestroy = true;
  const duplex = new Duplex({
    ...options,
    autoDestroy: false,
    emitClose: false,
    objectMode: false,
    writableObjectMode: false,
  });

  const onEnd = (): void => {
    if (!duplex.destroyed && duplex.writableFinished) duplex.destroy();
  };
  const onError = (error: Error): void => {
    duplex.removeListener("error", onError);
    duplex.destroy();
    if (duplex.listenerCount("error") === 0) duplex.emit("error", error);
  };

  ws.on("message", (message, isBinary) => {
    // `ws` (stream.js:63-64) converts only a text message, and only for a readable side in
    // object mode: a binary message stays a Buffer whatever the mode.
    const data = !isBinary && duplex.readableObjectMode ? message.toString() : message;
    if (!duplex.push(data)) ws.pause();
  });
  ws.once("error", (error) => {
    if (duplex.destroyed) return;
    // Prevents `ws.terminate()` from being called by `duplex._destroy()`: the close
    // frame may still be in flight, and the error listener on the receiver already closes
    // the connection.
    terminateOnDestroy = false;
    duplex.destroy(error);
  });
  ws.once("close", () => {
    if (!duplex.destroyed) duplex.push(null);
  });

  duplex._destroy = (error, callback) => {
    if (ws.readyState === ws.CLOSED) {
      callback(error);
      process.nextTick(() => {
        duplex.emit("close");
      });
      return;
    }
    let called = false;
    ws.once("error", (failure) => {
      called = true;
      callback(failure);
    });
    ws.once("close", () => {
      if (!called) callback(error);
      process.nextTick(() => {
        duplex.emit("close");
      });
    });
    if (terminateOnDestroy) ws.terminate();
  };

  // `ws` (stream.js:127-137) settles `_final` from the raw socket's `finish`, which
  // `Sender.close` triggers by ending that socket with the close frame, so `end` completes
  // once the frame is on the wire rather than when the peer answers it. The codec writes
  // the frame without ending the transport, so the latch is that same point, and the peer
  // answering stays the teardown path: `close` is what pushes the EOF and destroys.
  duplex._final = (callback) => {
    if (ws.readyState === ws.CONNECTING) {
      ws.once("open", () => {
        duplex._final?.(callback);
      });
      return;
    }
    if (ws.readyState === ws.CLOSED) {
      callback();
      return;
    }
    ws.close();
    if (!closeFrameWritten(ws)) {
      ws.once("close", () => {
        callback();
      });
      return;
    }
    callback();
    if (duplex.readableEnded) duplex.destroy();
  };

  duplex._read = (): void => {
    if (ws.isPaused) ws.resume();
  };

  duplex._write = (chunk, encoding, callback) => {
    if (ws.readyState === ws.CONNECTING) {
      ws.once("open", () => {
        duplex._write?.(chunk, encoding, callback);
      });
      return;
    }
    ws.send(chunk, callback);
  };

  duplex.on("end", onEnd);
  duplex.on("error", onError);
  return duplex;
}
