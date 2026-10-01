// The subpath under the CommonJS `require` condition, mirroring `consumer.cts`: a
// resolver that reads `types` before the runtime conditions must find
// `dist/logging.d.cts` here, or a `moduleResolution: node16` consumer cannot compile.

import type { fatal, info, ready, setLoggerEnabled, warn } from "ventiws/logging";

export type Record = typeof info;
export type Warn = typeof warn;
export type Fail = typeof fatal;
export type Splash = typeof ready;
export type Toggle = typeof setLoggerEnabled;
