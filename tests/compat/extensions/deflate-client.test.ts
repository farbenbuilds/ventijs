//! `permessage-deflate` negotiation from the client's side.
//!
//! Split from `deflate.test.ts` because a server reading an offer and a client reading
//! an answer are two decisions, and the one that is not the same code is the one most
//! likely to be tested only once: the client writes a header it chose, and then has to
//! accept whatever a peer sends back, including parameters this codec never offered.

import { describe, expect, test } from "vitest";
import { acceptAsClient } from "../../../src/compat/extensions/deflate";
import { offer } from "../../../src/compat/extensions/offer";
import { parseExtensions, type ParsedExtension } from "../../../src/compat/extensions/grammar";
import { normalizePerMessageDeflate } from "../../../src/compat/options/shared";
import type { PerMessageDeflateOptions } from "../../../src/types/ws";

/// `ws`'s own defaults, which is what these are negotiating against unless a case says
/// otherwise.
const DEFAULTS = normalizePerMessageDeflate(undefined, true);

/// The first `permessage-deflate` configuration, which is the one a client reads.
function one(header: string): ParsedExtension {
  const found = parseExtensions(header).get("permessage-deflate")?.[0];
  if (found === undefined) throw new Error(`no permessage-deflate in ${header}`);
  return found;
}

describe("a client writing its offer", () => {
  test("the offer names both no-context-takeover parameters", () => {
    // Not a bare `permessage-deflate`, because `ws` omits the response header entirely
    // when the configuration it accepted carries no parameters. A bare offer is a request
    // a `ws` server silently declines, and the connection runs uncompressed with nothing
    // to report.
    expect(offer(DEFAULTS)).toBe(
      "permessage-deflate; server_no_context_takeover; client_no_context_takeover",
    );
  });

  test("the offer is the same whatever the window options say", () => {
    // The window parameters are never offered, because a server answering with a window
    // this compressor cannot use would be a handshake refusal rather than a smaller
    // message. Declining the parameter up front is the only way to avoid asking for it.
    const client = normalizePerMessageDeflate(
      {
        serverMaxWindowBits: 10,
        clientMaxWindowBits: 12,
        serverNoContextTakeover: true,
      } satisfies PerMessageDeflateOptions,
      true,
    );
    expect(offer(client)).toBe(
      "permessage-deflate; server_no_context_takeover; client_no_context_takeover",
    );
  });

  test("the extension off offers nothing", () => {
    expect(offer(false)).toBeUndefined();
  });
});

describe("a client reading a server answer", () => {
  test("this codec's own answer is accepted", () => {
    const outcome = acceptAsClient(
      one("permessage-deflate; server_no_context_takeover; client_no_context_takeover"),
      DEFAULTS,
    );
    expect(outcome).toHaveProperty("accepted");
  });

  test("an answer that negotiates nothing is still an answer", () => {
    // A server is free to answer with the bare name, and the client connects
    // uncompressed. Reading that as a refusal would break against a perfectly correct
    // server that simply declined the parameters.
    expect(acceptAsClient(one("permessage-deflate"), DEFAULTS)).toHaveProperty("accepted");
  });

  test("a context takeover this side did not ask for is refused", () => {
    // `ws` raises exactly this against a server that assumes it, and honouring it would
    // mean a compressor that cannot carry a window between messages.
    const client = normalizePerMessageDeflate({ clientNoContextTakeover: false }, true);
    const outcome = acceptAsClient(one("permessage-deflate; client_no_context_takeover"), client);
    expect(outcome).toHaveProperty("refusal");
  });

  test("a window this compressor cannot use is refused", () => {
    const outcome = acceptAsClient(one("permessage-deflate; client_max_window_bits=10"), DEFAULTS);
    expect(outcome).toHaveProperty("refusal");
  });

  test("a valueless client window in a response is refused", () => {
    // RFC 7692 section 7.1.2.1 requires a server to name the window it chose, so the
    // valueless form is legal in an offer and not in a response.
    const outcome = acceptAsClient(one("permessage-deflate; client_max_window_bits"), DEFAULTS);
    expect(outcome).toHaveProperty("refusal");
  });

  test("a window wider than the client offered is refused", () => {
    const client = normalizePerMessageDeflate({ clientMaxWindowBits: 10 }, true);
    const outcome = acceptAsClient(one("permessage-deflate; client_max_window_bits=15"), client);
    expect(outcome).toHaveProperty("refusal");
  });

  test("an unknown parameter is refused", () => {
    const outcome = acceptAsClient(one("permessage-deflate; unknown=1"), DEFAULTS);
    expect(outcome).toHaveProperty("refusal");
  });

  test("a duplicated parameter is refused", () => {
    const outcome = acceptAsClient(
      one("permessage-deflate; client_no_context_takeover; client_no_context_takeover"),
      DEFAULTS,
    );
    expect(outcome).toHaveProperty("refusal");
  });

  test("the extension off accepts nothing", () => {
    expect(acceptAsClient(one("permessage-deflate"), false)).toBeNull();
  });
});
