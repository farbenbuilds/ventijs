// The seam between the harness and an implementation. `ws` and ventiws expose
// ws-shaped servers, uWebSockets.js and Socket.IO expose their own, so every
// structural difference is normalized here and nowhere else. `echo-run.ts`
// drives only these shapes, which is what makes the legs comparable.

export type ImplementationId = "ws" | "ventiws" | "ventiws-engine" | "uWebSockets.js" | "socket.io";

// The gate compares the candidate against the baseline, exactly as the local
// `--gate` flag always has; the engine route and the two libraries are context.
export type GateImplementationId = "ws" | "ventiws";

export const BASELINE_ID: GateImplementationId = "ws";
export const CANDIDATE_ID: GateImplementationId = "ventiws";
export const GATE_IMPLEMENTATION_IDS: readonly GateImplementationId[] = [BASELINE_ID, CANDIDATE_ID];
export const REFERENCE_IMPLEMENTATION_IDS: readonly ImplementationId[] = [
  "ventiws-engine",
  "uWebSockets.js",
  "socket.io",
];
export const ALL_IMPLEMENTATION_IDS: readonly ImplementationId[] = [
  ...GATE_IMPLEMENTATION_IDS,
  ...REFERENCE_IMPLEMENTATION_IDS,
];

/// Total by construction: a new id cannot compile until it is named here.
export const IMPLEMENTATION_LABELS: Readonly<Record<ImplementationId, string>> = {
  ws: "ws (server and client)",
  ventiws: "ventiws facade (Zig codec over the Node transport, fixed ws client)",
  "ventiws-engine": "ventiws engine (native listener, fixed ws client)",
  "uWebSockets.js": "uWebSockets.js v20 (server, fixed ws client)",
  "socket.io": "Socket.IO v4 (server and client, websocket-only)",
};

export const isImplementationId = (value: string): value is ImplementationId =>
  ALL_IMPLEMENTATION_IDS.some((id) => id === value);

export type EchoServerOptions = {
  readonly host: string;
  readonly port: number;
  readonly perMessageDeflate: boolean;
  readonly maxPayloadBytes: number;
};

export type EchoConnection = {
  readonly send: (payload: Buffer) => void;
  readonly onMessage: (listener: (payload: Buffer) => void) => void;
  readonly onError: (listener: (error: Error) => void) => void;
};

export type EchoServer = {
  readonly listen: () => Promise<number>;
  readonly onConnection: (listener: (connection: EchoConnection) => void) => void;
  readonly onError: (listener: (error: Error) => void) => void;
  readonly close: () => void;
};

export type EchoClient = {
  readonly send: (payload: Buffer) => void;
  readonly close: () => void;
  readonly onOpen: (listener: () => void) => void;
  readonly onMessage: (listener: (payload: Buffer) => void) => void;
  readonly onError: (listener: (error: Error) => void) => void;
};

export type EchoImplementation = {
  readonly id: ImplementationId;
  readonly createServer: (options: EchoServerOptions) => EchoServer;
  readonly connect: (url: string) => EchoClient;
};

export type EchoConfig = {
  readonly implementation: ImplementationId;
  readonly payloadBytes: number;
  readonly messages: number;
  readonly timeoutMs: number;
};

export type SampleStatus = "measured" | "unavailable";

export type EchoSample = {
  readonly configuration: string;
  readonly implementation: ImplementationId;
  readonly payloadBytes: number;
  readonly messages: number;
  readonly status: SampleStatus;
  readonly seconds: number | null;
  readonly roundTripsPerSecond: number | null;
  readonly wireBytesPerSecond: number | null;
  readonly reason: string | null;
};
