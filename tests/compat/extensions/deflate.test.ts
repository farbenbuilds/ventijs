//! `permessage-deflate` negotiation, in both directions.
//!
//! Separate from `grammar.test.ts` because the two answer different questions. That one
//! asks whether a header is well formed; this one asks what is done with one, and the
//! answers are `ws`'s answers, which is the whole point of the module under test.
//!
//! The reduced-window refusals are the only place this build knowingly differs from
//! `ws`, and each case names why: the compressor is one-shot libdeflate, so a window
//! below 15 is a promise the codec cannot keep.

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

  test("a window this compressor cannot use is refused, not accepted", () => {
    // The one deliberate divergence from `ws`. A streaming zlib can honour a window
    // below 15; a one-shot libdeflate compressor emits a full window, so accepting 10
    // would produce a stream the peer's 10-bit inflater rejects on a back-reference.
    const outcome = acceptAsServer(
      configurations("permessage-deflate; client_max_window_bits=10"),
      DEFAULTS,
    );
    expect(outcome).toHaveProperty("refusal");
  });

  test("a second configuration is tried when the first names an unusable window", () => {
    // RFC 7692 section 7.1.1.1 exists for this: a client offers two configurations so a
    // narrow server can decline the first. Refusing the connection on the first offer
    // would be strictly worse than reading the second.
    const outcome = acceptAsServer(
      configurations("permessage-deflate; client_max_window_bits=8, permessage-deflate"),
      DEFAULTS,
    );
    expect(acceptedHeader(outcome)).toBe(
      "permessage-deflate; server_no_context_takeover; client_no_context_takeover",
    );
  });

  test("an offer every configuration refuses is a refusal", () => {
    const outcome = acceptAsServer(
      configurations(
        "permessage-deflate; client_max_window_bits=8, permessage-deflate; client_max_window_bits=9",
      ),
      DEFAULTS,
    );
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

  test("the extension off is never negotiated, whatever the client offers", () => {
    expect(
      acceptAsServer(configurations("permessage-deflate; client_max_window_bits"), false),
    ).toBeNull();
  });
});
