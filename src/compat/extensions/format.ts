/// A parameter with no value is written as its own name and never as `name=`, because a
/// peer that reads `client_max_window_bits=` as a number gets 0, and 0 is not a legal
/// window size.

export function formatExtension(
  name: string,
  parameters: Readonly<Record<string, string>>,
): string {
  const parts = [name];
  for (const [key, value] of Object.entries(parameters)) {
    parts.push(value === "" ? key : `${key}=${value}`);
  }
  return parts.join("; ");
}
