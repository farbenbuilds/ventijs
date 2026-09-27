/// The RFC 6455 extension header, rendered.
///
/// Split from `grammar.ts` because this half never fails and that half always does, and
/// a module owning both has to say which of the two it is doing for every value.
///
/// **The bare form matters.** A parameter with no value is written as its own name and
/// never as `name=`, because a peer that reads `client_max_window_bits=` as a number
/// gets 0, and 0 is not a legal window size. `client_max_window_bits` and
/// `client_no_context_takeover` are both valueless, and both are wrong with an `=`.

/// Renders one extension and its parameters, the way `ws` renders them.
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
