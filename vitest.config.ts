// The suite silences the auto-wired logger once for every test file. Lifecycle records
// are covered on purpose in tests/logging and tests/compat/logging, which re-enable the
// logger themselves; every other suite gets the quiet default a redirected pipe wants.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { VENTIWS_LOG: "0" },
  },
});
