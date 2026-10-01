// The `ventiws/logging` subpath as an ESM TypeScript consumer sees it, compiled with
// `moduleResolution: node16` and `skipLibCheck: false` by `tsconfig.dist-types.json`.
// The subpath is additive to the `ws` surface, so its evidence is that it resolves
// through the package `exports` map rather than the source tree.

import { fatal, info, ready, setLoggerEnabled, warn } from "ventiws/logging";

export const silence = (): void => setLoggerEnabled(false);
export const enable = (): void => setLoggerEnabled(true);
export const record = (command: string, status: string): void => {
  info(command, status);
  warn(command, status);
  fatal(command, status);
};
export const splash = (version: string, timeMs: number, port: number): void =>
  ready(version, timeMs, port);
