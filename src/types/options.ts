import type {
  ClientOptions,
  FinishRequestCallback,
  PerMessageDeflateOptions,
  ServerOptions,
} from "./ws";

export type ZlibDeflateOptions = PerMessageDeflateOptions["zlibDeflateOptions"];

export type ZlibInflateOptions = PerMessageDeflateOptions["zlibInflateOptions"];

/// `false` is in the type because `ws` compares against it at runtime, in both
/// directions, and a caller reaching its options through an untyped object can set it.
/// `@types/ws` declares only a number, so this is wider than the vendored declarations
/// and narrower than the runtime.
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
  /// `ws` documents and defaults this, but `@types/ws` declares it on neither record.
  readonly maxFragments: number;
  /// Reads queued behind a paused parse, as in `ws`. Zero is no limit, and the default is
  /// `ws`'s 262144.
  readonly maxBufferedChunks: number;
  readonly skipUTF8Validation: boolean;
  readonly perMessageDeflate: false | NormalizedPerMessageDeflate;
  /// Milliseconds a close handshake may stay unfinished. Zero is a caller's choice, not
  /// the default.
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
  /// See the server record.
  readonly maxFragments: number;
  /// See the server record.
  readonly maxBufferedChunks: number;
  readonly skipUTF8Validation: boolean;
  readonly allowSynchronousEvents: boolean;
  readonly autoPong: boolean;
  readonly perMessageDeflate: false | NormalizedPerMessageDeflate;
  /// Milliseconds a close handshake may stay unfinished. Zero is a caller's choice, not
  /// the default.
  readonly closeTimeout: number;
  readonly origin: string | undefined;
  readonly headers: Readonly<Record<string, string>> | undefined;
  /// The caller's own options, forwarded to `http.request` as `ws` forwards them: a copy of
  /// the source, because `@types/ws` types `ClientOptions` as extending
  /// `SecureContextOptions` and the request options. See `client/transport-options.ts`.
  readonly requestOptions: Readonly<Record<string, unknown>>;
  /// `ws`'s `finishRequest`: the caller owns the `end()`. Declared by `@types/ws`, so
  /// unlike `maxFragments` a typed caller reaches it without a cast.
  readonly finishRequest: FinishRequestCallback | undefined;
  readonly generateMask: ClientOptions["generateMask"];
};
