//! Codec fixtures shared by the binding suites.
//!
//! Every test that builds a codec directly needs the same three things: a role, the
//! two ceilings, and the UTF-8 policy. Spelling them out per file is how a suite ends
//! up creating a codec with a 32 KiB ceiling and a test next to it asserting a 64 KiB
//! one, which is the divergence this whole change is about.
//!
//! The defaults here are the compiled ceilings rather than the `ws` defaults, on
//! purpose. A binding test is about the codec, not about `maxPayload`: with the
//! compiled ceiling the "over the capacity" cases are the smallest over-limit payloads
//! available, and with `ws`'s 100 MiB default they would have to allocate 100 MiB to
//! reach the boundary. The `maxPayload` option is tested where it is plumbed -- in
//! `tests/compat/` -- and against a small value there for the same reason.

import { CODEC_ROLE, createCodec, type CodecOptions } from "../../src/binding/codec";

/// The `maxPayload` the binding suites share.
///
/// The compiled engine cap, not `codecLimits().maxPayloadBytes`. That ceiling is now
/// the boundary's 32-bit width, so a suite that used it would have to allocate four
/// gigabytes to reach its own boundary, and a test that measures a boundary should be
/// able to name a number it can actually build a payload over.
///
/// It does not make a codec expensive: the floor is allocated at creation whatever the
/// ceiling is, so a suite at 64 KiB and a codec at `ws`'s 100 MiB default have the same
/// cost at rest and differ only when a peer sends enough to earn the difference.
export const DEFAULT_MAX_PAYLOAD = 64 * 1024;

/// The `maxFragments` the binding suites share. `ws`'s default, which is also the
/// smallest value every framing suite can exercise the bound against.
export const DEFAULT_MAX_FRAGMENTS = 16 * 1024;

/// A codec with the shared ceilings, which is what almost every binding test wants:
/// nothing is refused for being large, and a payload over the cap is one the test
/// chose.
export function defaultCodecOptions(overrides: Partial<CodecOptions> = {}): CodecOptions {
  return {
    maxPayload: DEFAULT_MAX_PAYLOAD,
    maxFragments: DEFAULT_MAX_FRAGMENTS,
    validateUtf8: true,
    ...overrides,
  };
}

/// A server-role codec with the compiled ceilings.
export function serverCodec(overrides: Partial<CodecOptions> = {}): bigint {
  return createCodec(CODEC_ROLE.server, defaultCodecOptions(overrides));
}

/// A client-role codec with the compiled ceilings.
export function clientCodec(overrides: Partial<CodecOptions> = {}): bigint {
  return createCodec(CODEC_ROLE.client, defaultCodecOptions(overrides));
}
