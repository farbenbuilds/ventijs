// An offer this build cannot accept, answered with a 400.
//
// Its own module because these are the only cases that end the handshake, and the reason
// the negotiation returns an outcome rather than a nullable header: a 400 has to stop the
// handshake, and a 101 written after it is a stream error on the caller's own socket
// rather than the refusal the peer was told about.

import { expect, test } from "vitest";
import { TEST_TIMEOUT_MS } from "../../binding/support";
import { deflateServer } from "./deflate-support";
import { upgradeHarness } from "./codec-upgrade-support";
import { rawUpgrade, request, UPGRADE_HEADERS } from "../server/upgrade-support";

test.each([
  ["no configuration can satisfy the offer", "permessage-deflate; client_max_window_bits=1"],
  [
    "a server window this build cannot emit in every configuration",
    "permessage-deflate; server_max_window_bits=8, permessage-deflate; server_max_window_bits=10",
  ],
  [
    "a server window this compressor cannot produce",
    "permessage-deflate; server_max_window_bits=10",
  ],
  ["a malformed header", "permessage-deflate; p=(1)"],
])(
  "an offer with %s is answered with a 400",
  { timeout: TEST_TIMEOUT_MS },
  async (_name, extension) => {
    // The refusal path, and the reason `negotiate.ts` returns an outcome rather than a
    // nullable header: a 400 has to stop the handshake, and a 101 written after it is a
    // stream error on the caller's own socket rather than the refusal the peer was told.
    const harness = await upgradeHarness(deflateServer());
    try {
      const result = await rawUpgrade(
        harness.port,
        request("/", { ...UPGRADE_HEADERS, "Sec-WebSocket-Extensions": extension }),
      );
      expect(result.status).toBe(400);
    } finally {
      await harness.close();
    }
  },
);
