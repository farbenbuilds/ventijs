import type {
  ClientOptions,
  FinishRequestCallback,
  PerMessageDeflateOptions,
  ServerOptions,
} from "./ws";

export type ZlibDeflateOptions = PerMessageDeflateOptions["zlibDeflateOptions"];

export type ZlibInflateOptions = PerMessageDeflateOptions["zlibInflateOptions"];

/// A negotiated window size, or `false` to refuse one.
///
/// `false` is in the type because `ws` compares against it at runtime, in both
/// directions, and a caller reaching its options through an untyped object can set it.
/// `@types/ws` declares only a number, so this is a wider type than the vendored
/// declarations and a narrower one than the runtime.
export type WindowBitsOption = number | false | undefined;

export type NormalizedPerMessageDeflate = {
  readonly serverNoContextTakeover: boolean | undefined;
  readonly clientNoContextTakeover: boolean | undefined;
  readonly serverMaxWindowBits: WindowBitsOption;
  readonly clientMaxWindowBits: WindowBitsOption;
  readonly threshold: number;
  readonly concurrencyLimit: number;
  readonly zlibDeflateOptions: ZlibDeflateOptions;
  readonly zlibInflateOptions: ZlibInflateOptions;
};

export type NormalizedServerOptions = {
  readonly host: string | null;
  readonly port: number | null;
  readonly backlog: number | null;
  readonly path: string | null;
  readonly server: ServerOptions["server"] | null;
  readonly noServer: boolean;
  readonly clientTracking: boolean;
  readonly allowSynchronousEvents: boolean;
  readonly autoPong: boolean;
  readonly maxPayload: number;
  /// The most fragments one message may be split into. `ws` documents it and
  /// defaults it, but `@types/ws` declares it on neither record, so it is read
  /// rather than declared here for the same reason `closeTimeout` is.
  readonly maxFragments: number;
  readonly skipUTF8Validation: boolean;
  readonly perMessageDeflate: false | NormalizedPerMessageDeflate;
  /// Milliseconds a close handshake may stay unfinished. Zero means no deadline,
  /// which is a caller's choice and not the default.
  readonly closeTimeout: number;
  readonly verifyClient: ServerOptions["verifyClient"] | null;
  readonly handleProtocols: ServerOptions["handleProtocols"] | null;
  readonly WebSocket: ServerOptions["WebSocket"];
};

export type NormalizedClientOptions = {
  readonly protocolVersion: 8 | 13;
  readonly followRedirects: boolean;
  readonly maxRedirects: number;
  readonly handshakeTimeout: number | undefined;
  readonly maxPayload: number;
  /// See the server record: documented and defaulted by `ws`, absent from
  /// `@types/ws`.
  readonly maxFragments: number;
  readonly skipUTF8Validation: boolean;
  readonly allowSynchronousEvents: boolean;
  readonly autoPong: boolean;
  readonly perMessageDeflate: false | NormalizedPerMessageDeflate;
  /// Milliseconds a close handshake may stay unfinished. Zero means no deadline,
  /// which is a caller's choice and not the default.
  readonly closeTimeout: number;
  readonly origin: string | undefined;
  readonly headers: Readonly<Record<string, string>> | undefined;
  /// `ws`'s `finishRequest`: the caller finishes the request itself, which means it
  /// owns the `end()`. Declared by `@types/ws`, so unlike `maxFragments` a typed caller
  /// reaches it without a cast.
  readonly finishRequest: FinishRequestCallback | undefined;
  /// `ws`'s `generateMask`, read as given. A four-byte buffer the callback fills.
  readonly generateMask: ClientOptions["generateMask"];
};
