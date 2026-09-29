//! `createWebSocketStream` against a real server on each side. `ws` is the contract, so
//! every scenario runs on both implementations and the transcripts have to match; the
//! literal each test pins is `ws`'s own answer, so a divergence reads as a difference and a
//! shared regression reads as one.

import type { DuplexOptions } from "node:stream";
import { expect, test } from "vitest";
import { TEST_TIMEOUT_MS } from "../binding/support";
import { waitFor } from "../compat/socket/codec-upgrade-support";
import {
  describeChunk,
  until,
  upstreamFixture,
  ventijsFixture,
  within,
  type StreamFixture,
  type Transcript,
} from "./stream-support";

type Build = (options?: DuplexOptions) => Promise<StreamFixture>;
type Scenario = (fixture: StreamFixture) => Promise<Transcript>;

/// Above the 16 KiB readable high-water mark, so a buffered chunk makes `push` go false.
const OVERSIZE = 64 * 1024;

/// One scenario on both legs, asserting they agree, and handing back the transcript so the
/// caller can pin it. `ws` runs first, as `parity-support.ts` does, so a ventijs failure can
/// never be the reason a reference server is left listening.
async function agree(scenario: Scenario, options?: DuplexOptions): Promise<Transcript> {
  const expected = await run(upstreamFixture, scenario, options);
  const actual = await run(ventijsFixture, scenario, options);
  expect(actual).toEqual(expected);
  return actual;
}

async function run(build: Build, scenario: Scenario, options?: DuplexOptions): Promise<Transcript> {
  const fixture = await build(options);
  try {
    return await scenario(fixture);
  } finally {
    await fixture.dispose();
  }
}

/// One text message and one binary message, as the stream reports them.
async function readChunks(fixture: StreamFixture): Promise<Transcript> {
  const seen: Transcript = [];
  const two = new Promise<void>((resolve) => {
    fixture.stream.on("data", (chunk: unknown) => {
      seen.push(describeChunk(chunk));
      if (seen.length === 2) resolve();
    });
  });
  fixture.client.send("hello");
  fixture.client.send(Buffer.from("bin"));
  await within(two, "two messages");
  return seen;
}

/// What the stream wrote, as the peer received it: a write is a `send`, so the only thing
/// that can differ is whether the bytes reached the peer as one message.
async function writeChunk(fixture: StreamFixture): Promise<Transcript> {
  const seen: Transcript = [];
  const received = new Promise<void>((resolve) => {
    fixture.client.on("message", (data: Buffer) => {
      seen.push(data.toString());
      resolve();
    });
  });
  fixture.stream.write("streamed");
  await within(received, "the written message");
  return seen;
}

/// `stream.end()`, then every event that follows, in the order it happened. `finish` is the
/// one under test: `ws` settles it when the close frame has been written, and the socket's
/// `close` is the peer answering that frame, which is a later event by contract. The
/// readable side is drained, because a stream nobody reads never emits `end` or `close` and
/// the teardown those two assert would go untested.
async function endOrder(fixture: StreamFixture): Promise<Transcript> {
  const seen: Transcript = [];
  fixture.stream.on("finish", () => seen.push("stream:finish"));
  fixture.stream.on("end", () => seen.push("stream:end"));
  fixture.stream.on("error", () => seen.push("stream:error"));
  fixture.stream.on("close", () => seen.push("stream:close"));
  fixture.socket.on("close", () => seen.push("socket:close"));
  fixture.stream.resume();
  fixture.stream.end();
  await until(seen, "stream:close");
  return seen;
}

/// A message the application has not read, larger than the readable high-water mark. The
/// chunk is buffered rather than delivered, so `push` goes false and the socket is paused;
/// the stub could not show this, because a synchronous `push` into a draining reader never
/// returned false.
async function pauseUnderLoad(fixture: StreamFixture): Promise<Transcript> {
  fixture.client.send(Buffer.alloc(OVERSIZE));
  await waitFor(() => fixture.socket.isPaused);
  return [String(fixture.socket.isPaused)];
}

test(
  "a text message is a string in object mode, and a binary message is a Buffer",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const transcript = await agree(readChunks, { readableObjectMode: true });
    expect(transcript).toEqual(["string:hello", "buffer:bin"]);
  },
);

test(
  "both messages stay buffers without readableObjectMode",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const transcript = await agree(readChunks);
    expect(transcript).toEqual(["buffer:hello", "buffer:bin"]);
  },
);

test(
  "end settles on the close frame, before the peer has answered it",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const transcript = await agree(endOrder);
    expect(transcript).toEqual(["stream:finish", "socket:close", "stream:end", "stream:close"]);
  },
);

test("a write reaches the peer as one message", { timeout: TEST_TIMEOUT_MS }, async () => {
  const transcript = await agree(writeChunk);
  expect(transcript).toEqual(["streamed"]);
});

test(
  "an unread message over the high-water mark pauses the socket",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const transcript = await agree(pauseUnderLoad);
    expect(transcript).toEqual(["true"]);
  },
);
