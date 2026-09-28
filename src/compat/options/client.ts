import type { NormalizedClientOptions } from "../../types/options";
import type { ClientOptions } from "../../types/ws";
import { maxFragmentsOf, maxPayloadOf } from "./bounded";
import { codecLimits } from "../../binding/codec";
import {
  DEFAULT_MAX_REDIRECTS,
  closeTimeoutOf,
  invalidOption,
  normalizePerMessageDeflate,
} from "./shared";

export function normalizeClientOptions(options?: ClientOptions): NormalizedClientOptions {
  // ws copies own enumerable properties before reading, so inherited
  // properties are ignored and each getter runs exactly once.
  const source = { ...options };
  const protocolVersion = source.protocolVersion ?? 13;
  if (protocolVersion !== 8 && protocolVersion !== 13) {
    invalidOption(
      `Unsupported protocol version: ${protocolVersion} (supported versions: 8, 13)`,
      RangeError,
    );
  }
  return {
    protocolVersion,
    followRedirects: source.followRedirects ?? false,
    maxRedirects: source.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    handshakeTimeout: source.handshakeTimeout,
    maxPayload: maxPayloadOf(source, () => codecLimits().maxPayloadBytes),
    maxFragments: maxFragmentsOf(source, () => codecLimits().maxFragments),
    skipUTF8Validation: source.skipUTF8Validation ?? false,
    allowSynchronousEvents: source.allowSynchronousEvents ?? true,
    autoPong: source.autoPong ?? true,
    // `closeTimeout` is read rather than declared: `@types/ws` does not declare it
    // either, so a caller passing it in typed code is refused by `ws` too. Accepting
    // it here keeps the runtime behaviour identical, which is the only part a
    // difference here would be observable in.
    closeTimeout: closeTimeoutOf(source),
    perMessageDeflate: normalizePerMessageDeflate(source.perMessageDeflate, true),
    origin: source.origin,
    headers: source.headers === undefined ? undefined : { ...source.headers },
    finishRequest: source.finishRequest,
    generateMask: source.generateMask,
  };
}
