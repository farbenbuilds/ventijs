import type { ClientOptions } from "../../../src/index";

/// An option `ws` accepts at runtime and `@types/ws` does not declare.
///
/// `closeTimeout` and `autoPong` are the two this suite drives, and both are declared
/// on neither type, so a caller in TypeScript is refused by `ws` for the same reason.
/// The cast is what a JavaScript caller does implicitly, and keeping it in one place
/// means a suite is not quietly testing a different value from the one `ws` would get.
export function undeclared(options: Record<string, unknown>): ClientOptions {
  return options as ClientOptions;
}
