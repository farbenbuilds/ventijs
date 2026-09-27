//! Credentials across a redirect.
//!
//! Split out of \`redirect.ts\` because the rule is a security property rather than a
//! step in a flow, and because it is the one part of a hop whose failure is silent: a
//! header that was not dropped produces no error, no event, and no difference in the
//! ready state. It only produces a password on a server the caller did not name.

/// Removes the caller's credentials when a redirect leaves the original host.
///
/// In place, because \`request.ts\` hands \`http.request\` the *same* header object it
/// stores on the handshake. Two copies would mean stripping one and sending the other,
/// which is the failure this rule exists to prevent.
export function stripCredentials(headers: unknown): void {
  if (typeof headers !== "object" || headers === null) return;
  const map = headers as Record<string, string | string[]>;
  for (const name of Object.keys(map)) {
    const lower = name.toLowerCase();
    if (lower === "authorization" || lower === "cookie") delete map[name];
  }
}
