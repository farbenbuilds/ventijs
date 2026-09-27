import { performance } from "node:perf_hooks";
import type {
  EchoClient,
  EchoConfig,
  EchoConnection,
  EchoImplementation,
  EchoSample,
  EchoServer,
  EchoServerOptions,
} from "./echo-types.ts";

// Compression is off on both legs: it would measure deflate, not the transport.
const SERVER_OPTIONS: EchoServerOptions = { port: 0, perMessageDeflate: false };

type Failure = {
  readonly promise: Promise<never>;
  readonly reject: (error: Error) => void;
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

// `Promise.race` needs a pending promise that any wired error source can settle.
const failureOf = (): Failure => {
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  return { promise, reject };
};

const configurationOf = (config: EchoConfig): string =>
  `${config.implementation}@${config.payloadBytes}B`;

const measured = (config: EchoConfig, seconds: number): EchoSample => ({
  configuration: configurationOf(config),
  implementation: config.implementation,
  payloadBytes: config.payloadBytes,
  messages: config.messages,
  status: "measured",
  seconds,
  roundTripsPerSecond: config.messages / seconds,
  // Every payload byte crosses the socket twice, once each way. The upstream
  // `ws` speed harness counts both directions, so the columns stay comparable.
  wireBytesPerSecond: (config.payloadBytes * 2 * config.messages) / seconds,
  reason: null,
});

/// Reported instead of a number when a leg cannot produce one. Every number in
/// the report came from a `runEcho` that finished; nothing is extrapolated.
export const unavailable = (config: EchoConfig, reason: string): EchoSample => ({
  configuration: configurationOf(config),
  implementation: config.implementation,
  payloadBytes: config.payloadBytes,
  messages: config.messages,
  status: "unavailable",
  seconds: null,
  roundTripsPerSecond: null,
  wireBytesPerSecond: null,
  reason,
});

// A client error during connect rejects this promise; a server or connection
// error reaches the same run through the shared failure channel.
const waitForOpen = (client: EchoClient): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    client.onError(reject);
    client.onOpen(resolve);
  });

// Lock-step ping-pong. The pump re-enters itself from the message listener
// instead of chaining a promise per round trip: a promise per echo would put
// the allocator and the microtask queue inside the measured window and report
// the harness rather than the engine.
const pumpRoundTrips = (client: EchoClient, payload: Buffer, messages: number): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    let received = 0;
    // The clock covers the round trips only. Handshake and connect sit outside
    // it because neither leg is measuring either.
    const startedAt = performance.now();
    client.onError(reject);
    client.onMessage(() => {
      received += 1;
      if (received < messages) {
        client.send(payload);
        return;
      }
      resolve((performance.now() - startedAt) / 1000);
    });
    client.send(payload);
  });

const closeQuietly = (close: () => void): void => {
  try {
    close();
  } catch {
    // Teardown runs after the sample is already decided; a close that throws
    // on an aborted socket cannot change the measurement.
  }
};

const teardown = (client: EchoClient | null, server: EchoServer): void => {
  if (client !== null) closeQuietly(client.close);
  closeQuietly(server.close);
};

const echoBack = (connection: EchoConnection, failure: Failure): void => {
  connection.onError(failure.reject);
  connection.onMessage((payload) => {
    connection.send(payload);
  });
};

export const runEcho = async (
  implementation: EchoImplementation,
  config: EchoConfig,
): Promise<EchoSample> => {
  const server = implementation.createServer(SERVER_OPTIONS);
  const failure = failureOf();
  let client: EchoClient | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    server.onError(failure.reject);
    server.onConnection((connection) => echoBack(connection, failure));
    // Every phase is bounded by the same deadline, and a client or server
    // error settles the run through `failure` rather than its own promise.
    const guard = async <T>(work: Promise<T>): Promise<T> => {
      const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no echo round trip completed within ${config.timeoutMs} ms`)),
          config.timeoutMs,
        );
      });
      return await Promise.race([work, expiry, failure.promise]);
    };
    const port = await guard(server.listen());
    client = implementation.connect(`ws://127.0.0.1:${port}/`);
    await guard(waitForOpen(client));
    const payload = Buffer.alloc(config.payloadBytes, 0x61);
    return measured(config, await guard(pumpRoundTrips(client, payload, config.messages)));
  } catch (error) {
    return unavailable(config, describeError(error));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    teardown(client, server);
  }
};
