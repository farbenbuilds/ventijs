/// Credentials across a redirect. A security property rather than a step in a flow, and the
/// one part of a hop whose failure is silent: a header that was not dropped produces no
/// error and only a password on a server the caller did not name.

/// In place, because `request.ts` hands `http.request` the *same* header object it stores on
/// the handshake, so two copies would mean stripping one and sending the other.
export function stripCredentials(headers: unknown): void {
  if (typeof headers !== "object" || headers === null) return;
  const map = headers as Record<string, string | string[]>;
  for (const name of Object.keys(map)) {
    const lower = name.toLowerCase();
    if (lower === "authorization" || lower === "cookie") delete map[name];
  }
}
