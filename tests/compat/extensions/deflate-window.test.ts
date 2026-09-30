// The window a `permessage-deflate` *offer* names, in both directions. Split from
// `deflate.test.ts` because the two directions have opposite owners: a client offer's
// `client_max_window_bits` is the window the client will use, while its
// `server_max_window_bits` is a limit on what this server may emit. Reading either the
// wrong way round answers a valid option with a 400.

import { describe, expect, test } from "vitest";
import { acceptAsServer } from "../../../src/compat/extensions/deflate";
import { parseExtensions, type ParsedExtension } from "../../../src/compat/extensions/grammar";
import { normalizePerMessageDeflate } from "../../../src/compat/options/shared";

/// `ws`'s own defaults, which is what every test here negotiates against.
const DEFAULTS = normalizePerMessageDeflate(undefined, true);

function configurations(header: string): readonly ParsedExtension[] {
  return parseExtensions(header).get("permessage-deflate") ?? [];
}

const acceptedHeader = (outcome: ReturnType<typeof acceptAsServer>): string | undefined =>
  outcome === null ? undefined : "accepted" in outcome ? outcome.accepted.header : outcome.refusal;

describe("a window named in a client offer", () => {
  test("a client naming its own window below 15 is accepted", () => {
    // RFC 7692 section 7.1.1.2 reads a `client_max_window_bits` in a client offer as the
    // client stating the window *it* will compress with, not a limit on this server. An
    // inflater reads the window out of the stream, so a 10-bit client is fine to serve and
    // refusing it failed a real connection for a constraint that does not exist.
    expect(
      acceptedHeader(
        acceptAsServer(configurations("permessage-deflate; client_max_window_bits=10"), DEFAULTS),
      ),
    ).toBe("permessage-deflate; server_no_context_takeover; client_no_context_takeover");
  });

  test("a server window of 15 is accepted, because 15 is what this build emits", () => {
    // The other half of the same correction. 15 is the only window a one-shot libdeflate
    // compressor produces, so an offer naming 15 describes what would have happened anyway
    // and accepting it costs nothing. Declining it refused the maximum legal value, which
    // is the value `@types/ws` and `ws` both default to.
    expect(
      acceptedHeader(
        acceptAsServer(configurations("permessage-deflate; server_max_window_bits=15"), DEFAULTS),
      ),
    ).toBe("permessage-deflate; server_no_context_takeover; client_no_context_takeover");
  });

  test("a server window below 15 is refused, not answered with a lie", () => {
    // The one deliberate divergence from `ws`, and the narrowest one. RFC 7692 section
    // 7.1.1.1 lets a client offer two configurations so a narrow server can decline the
    // first; `ws` accepts the offer and then compresses at 15 regardless, so the answer it
    // sends claims a window it is not using. Declining is the honest reading.
    expect(
      acceptAsServer(configurations("permessage-deflate; server_max_window_bits=10"), DEFAULTS),
    ).toHaveProperty("refusal");
  });

  test("a second configuration is tried when the first names an unusable window", () => {
    // RFC 7692 section 7.1.1.1 exists for this: a client offers two configurations so a
    // narrow server can decline the first. Refusing the connection on the first offer
    // would be strictly worse than reading the second.
    const outcome = acceptAsServer(
      configurations("permessage-deflate; server_max_window_bits=10, permessage-deflate"),
      DEFAULTS,
    );
    expect(acceptedHeader(outcome)).toBe(
      "permessage-deflate; server_no_context_takeover; client_no_context_takeover",
    );
  });

  test("an offer every configuration refuses is a refusal", () => {
    const outcome = acceptAsServer(
      configurations(
        "permessage-deflate; server_max_window_bits=10, permessage-deflate; server_max_window_bits=12",
      ),
      DEFAULTS,
    );
    expect(outcome).toHaveProperty("refusal");
  });

  test("a server that asked for a wider window than the client offered is refused", () => {
    // `ws`'s own comparison at `permessage-deflate.js:167`: the server has nothing to give
    // back when it wants more than the client said it could take.
    const server = normalizePerMessageDeflate({ serverMaxWindowBits: 15 }, true);
    const outcome = acceptAsServer(
      configurations("permessage-deflate; server_max_window_bits=10"),
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

/// The answer a producible window negotiates, which every non-refusal here expects.
const NEGOTIATED = "permessage-deflate; server_no_context_takeover; client_no_context_takeover";

describe("a server window named only in the options", () => {
  test.each([8, 9, 10, 11, 12, 13, 14])("an option of %i is declined, never advertised", (bits) => {
    // The compressor emits 15 at every level, so an option-only below-15 window can only be
    // answered with a lie: `ws` writes the option into the 101 header and ignores it in the
    // stream. Declining is the divergence COMPATIBILITY.md documents, on every path.
    const server = normalizePerMessageDeflate({ serverMaxWindowBits: bits }, true);
    expect(acceptAsServer(configurations("permessage-deflate"), server)).toHaveProperty("refusal");
  });

  test.each([
    [undefined, "permessage-deflate"],
    [15, "permessage-deflate"],
    [15, "permessage-deflate; server_max_window_bits=15"],
  ])("an option of %s still negotiates against %s", (bits, header) => {
    const server = normalizePerMessageDeflate({ serverMaxWindowBits: bits }, true);
    expect(acceptedHeader(acceptAsServer(configurations(header), server))).toBe(NEGOTIATED);
  });
});

describe("the window this server asked for", () => {
  test("a server that asked to widen past the offer is refused", () => {
    // `ws`'s own comparison at `permessage-deflate.js:167`: the server has nothing to give
    // back when it wants more than the client said it could take.
    const server = normalizePerMessageDeflate({ serverMaxWindowBits: 15 }, true);
    const outcome = acceptAsServer(
      configurations("permessage-deflate; server_max_window_bits=10"),
      server,
    );
    expect(outcome).toHaveProperty("refusal");
  });

  test("a server that will not name a window at all refuses an offer that names one", () => {
    // `false` is reachable at runtime and `ws` compares against it
    // (`permessage-deflate.js:166`), but `@types/ws` types the option as a number, so a
    // typed caller cannot set it. The cast is the declaration gap, not a behaviour.
    const server = normalizePerMessageDeflate(
      { serverMaxWindowBits: false } as unknown as { serverMaxWindowBits: number },
      true,
    );
    const outcome = acceptAsServer(
      configurations("permessage-deflate; server_max_window_bits=15"),
      server,
    );
    expect(outcome).toHaveProperty("refusal");
  });
});
