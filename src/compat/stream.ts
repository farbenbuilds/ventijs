import { Duplex } from "node:stream";
import type { DuplexOptions } from "node:stream";
import type { WebSocket } from "../types/ws";

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

  ws.on("message", (message) => {
    if (!duplex.push(message)) ws.pause();
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
    ws.once("close", () => {
      callback();
    });
    ws.close();
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
