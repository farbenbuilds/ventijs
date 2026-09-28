//! Codec fixtures shared by the binding suites. The defaults are the compiled ceilings, not
//! `ws`'s, so the "over the capacity" cases are the smallest over-limit payloads available.

import { CODEC_ROLE, createCodec, type CodecOptions } from "../../src/binding/codec";

/// The `maxPayload` the binding suites share: 64 KiB, not `codecLimits().maxPayloadBytes`,
/// which is now the boundary's 32-bit width and would need a four-gigabyte allocation.
export const DEFAULT_MAX_PAYLOAD = 64 * 1024;

/// `ws`'s default, and the smallest value every framing suite can exercise the bound against.
export const DEFAULT_MAX_FRAGMENTS = 16 * 1024;

/// Nothing is refused for being large, so a payload over the cap is one the test chose.
export function defaultCodecOptions(overrides: Partial<CodecOptions> = {}): CodecOptions {
  return {
    maxPayload: DEFAULT_MAX_PAYLOAD,
    maxFragments: DEFAULT_MAX_FRAGMENTS,
    validateUtf8: true,
    permessageDeflate: false,
    ...overrides,
  };
}

export function serverCodec(overrides: Partial<CodecOptions> = {}): bigint {
  return createCodec(CODEC_ROLE.server, defaultCodecOptions(overrides));
}

export function clientCodec(overrides: Partial<CodecOptions> = {}): bigint {
  return createCodec(CODEC_ROLE.client, defaultCodecOptions(overrides));
}
