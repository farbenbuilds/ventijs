import { expect } from "vitest";
import { adopted, wsAccepted } from "./parity-fixtures";
import type { Closable, Compared, Outcome } from "./parity-fixtures";

export { adopted, wsAccepted } from "./parity-fixtures";
export type { Closable, Compared, Fixture, Outcome } from "./parity-fixtures";

/// Runs one operation and reduces it to what two implementations can be compared
/// on.
///
/// `readyState` is on both branches and is read after the throw, because the
/// latch is the behaviour most of these tests exist for and an earlier version
/// carried the state only on the non-throwing side.
function measure(scenario: (socket: Closable) => void): (socket: Closable) => Outcome {
  return (socket) => {
    try {
      scenario(socket);
      return { threw: false, readyState: socket.readyState, name: "", message: "" };
    } catch (error) {
      const failure = error as Error;
      return {
        threw: true,
        readyState: socket.readyState,
        name: failure.constructor.name,
        message: failure.message,
      };
    }
  };
}

/// One comparison, shared by every conformance file that needs it. Two of them
/// used to carry their own, and the older pair dropped the ready state on a
/// throw, which is exactly how a refused `close` could leave a socket `OPEN`
/// while every test in both tables still passed.
///
/// Neither fixture is shared, because a socket that has been closed cannot be
/// reused. `ws` runs first so a ventiws failure can never leave its server
/// listening, and the reference is the oracle: an equal outcome returns it, and a
/// divergence is the assertion that fails.
export async function parity(scenario: (socket: Closable) => void): Promise<Outcome> {
  const { expected, actual } = await compare(scenario, scenario);
  expect(actual.threw).toBe(expected.threw);
  if (expected.threw && !actual.threw) {
    throw new Error(`expected a throw like ws: ${expected.message}`);
  }
  expect(actual.name).toBe(expected.name);
  expect(actual.message).toBe(expected.message);
  expect(actual.readyState).toBe(expected.readyState);
  return actual;
}

/// The same comparison, for a scenario that has to differ between the two because
/// the fixtures are built differently. The caller makes the assertions, because
/// in that shape the outcomes are allowed to differ.
export async function compare(
  reference: (socket: Closable) => void,
  ours: (socket: Closable) => void,
): Promise<Compared> {
  const run = measure(reference);
  const live = await wsAccepted();
  let expected: Outcome;
  try {
    expected = run(live.socket);
  } finally {
    await live.dispose();
  }
  const attached = await adopted();
  let actual: Outcome;
  try {
    actual = measure(ours)(attached.socket);
  } finally {
    await attached.dispose();
  }
  return { expected, actual };
}
