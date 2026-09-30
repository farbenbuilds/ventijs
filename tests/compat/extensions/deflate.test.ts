// `permessage-deflate` negotiation, in both directions.
//
// Separate from `grammar.test.ts` because the two answer different questions. That one asks
// whether a header is well formed; this one asks what is done with one, and the answers are
// `ws`'s answers. Window handling is in `deflate-window.test.ts`, which splits from this
// file only because the rules there are long enough to need the room; the range of the
// window *options* is checked here, next to the negotiation they feed.

import { describe, expect, test } from "vitest";
import { acceptAsServer } from "../../../src/compat/extensions/deflate";
import { parseExtensions, type ParsedExtension } from "../../../src/compat/extensions/grammar";
import { normalizePerMessageDeflate } from "../../../src/compat/options/shared";

/// `ws`'s own defaults, which is what every test here is negotiating against unless it
/// says otherwise.
const DEFAULTS = normalizePerMessageDeflate(undefined, true);

/// One configuration of `permessage-deflate` as it would arrive from the wire.
function configurations(header: string): readonly ParsedExtension[] {
  return parseExtensions(header).get("permessage-deflate") ?? [];
}

const acceptedHeader = (outcome: ReturnType<typeof acceptAsServer>): string | undefined =>
  outcome === null ? undefined : "accepted" in outcome ? outcome.accepted.header : outcome.refusal;

describe("a server reading a client offer", () => {
  test("no offer negotiates nothing", () => {
    expect(acceptAsServer([], DEFAULTS)).toBeNull();
  });

  test("ws's default offer is accepted", () => {
    // The shape every real `ws` client sends. It carries a bare
    // `client_max_window_bits`, which is a client asking to be given a window rather
    // than naming one, and reading it as "the parameter is present" is what makes this
    // work against the whole `ws` fleet rather than against a hand-written peer.
    expect(
      acceptedHeader(
        acceptAsServer(configurations("permessage-deflate; client_max_window_bits"), DEFAULTS),
      ),
    ).toBe("permessage-deflate; server_no_context_takeover; client_no_context_takeover");
  });

  test("a bare offer is accepted", () => {
    expect(acceptedHeader(acceptAsServer(configurations("permessage-deflate"), DEFAULTS))).toBe(
      "permessage-deflate; server_no_context_takeover; client_no_context_takeover",
    );
  });

  test("the answer is this codec's two parameters, not a subset of the offer", () => {
    // RFC 7692 section 7.1.2.2 lets a server answer with a parameter the client did not
    // offer, and `ws` accepts both `no_context_takeover` parameters unchecked. A header
    // a `ws` peer reads is worth more than a minimal one, and this is the only codec that
    // can honestly state both.
    const outcome = acceptAsServer(configurations("permessage-deflate"), DEFAULTS);
    expect(outcome).not.toBeNull();
    if (outcome !== null && "accepted" in outcome) {
      expect(Object.keys(outcome.accepted.parameters)).toEqual([
        "server_no_context_takeover",
        "client_no_context_takeover",
      ]);
    }
  });

  test.each([
    [
      "a duplicated parameter",
      "permessage-deflate; server_max_window_bits=10; server_max_window_bits=10",
    ],
    ["a window below the legal range", "permessage-deflate; client_max_window_bits=7"],
    ["a window above the legal range", "permessage-deflate; client_max_window_bits=16"],
    ["a non-numeric window", "permessage-deflate; client_max_window_bits=ten"],
    ["a valueless server window", "permessage-deflate; server_max_window_bits"],
    ["a value on a valueless parameter", "permessage-deflate; client_no_context_takeover=1"],
    ["an unknown parameter", "permessage-deflate; unknown"],
  ])("refuses %s", (_name, header) => {
    const outcome = acceptAsServer(configurations(header), DEFAULTS);
    expect(outcome).not.toBeNull();
    expect(outcome).toHaveProperty("refusal");
  });

  test("a client that will not accept a named window is skipped", () => {
    // `ws` refuses to answer a `clientMaxWindowBits` number with an offer that names no
    // window, because the client asked for a guarantee the offer does not give.
    const server = normalizePerMessageDeflate({ clientMaxWindowBits: 12 }, true);
    const outcome = acceptAsServer(configurations("permessage-deflate"), server);
    expect(outcome).toHaveProperty("refusal");
  });

  test("a server that asks for no context takeover declines an offer granting it", () => {
    const server = normalizePerMessageDeflate({ serverNoContextTakeover: false }, true);
    const outcome = acceptAsServer(
      configurations("permessage-deflate; server_no_context_takeover"),
      server,
    );
    expect(outcome).toHaveProperty("refusal");
  });
});

describe("window options outside RFC 7692's range", () => {
  test.each([7, 16, 0, 3.5, Number.NaN])("a value of %s is refused at construction", (bits) => {
    expect(() => normalizePerMessageDeflate({ serverMaxWindowBits: bits }, true)).toThrow(
      RangeError,
    );
    expect(() => normalizePerMessageDeflate({ clientMaxWindowBits: bits }, true)).toThrow(
      RangeError,
    );
  });

  test.each([null, true, "12"])("a non-number value of %s is refused at construction", (bits) => {
    const raw = bits as unknown as number;
    expect(() => normalizePerMessageDeflate({ serverMaxWindowBits: raw }, true)).toThrow(
      RangeError,
    );
    expect(() => normalizePerMessageDeflate({ clientMaxWindowBits: raw }, true)).toThrow(
      RangeError,
    );
  });

  test("the refusal carries the normalization error code", () => {
    expect(() => normalizePerMessageDeflate({ serverMaxWindowBits: 7 }, true)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_OPTION" }),
    );
  });

  test("false stays the runtime's name-no-window form", () => {
    // `ws` compares the option against `false` at `permessage-deflate.js:166`, and
    // `@types/ws` types it as a number, so the cast is the declaration gap, not a value.
    const server = normalizePerMessageDeflate(
      { serverMaxWindowBits: false } as unknown as { serverMaxWindowBits: number },
      true,
    );
    expect(server).not.toBe(false);
    if (server !== false) expect(server.serverMaxWindowBits).toBe(false);
  });
});
