// The seam between the harness and an implementation. Both `ws` and ventijs
// expose ws-shaped servers, but their declarations differ, so every structural
// difference is normalized here and nowhere else. `bench/echo/echo-run.ts`
// drives only these shapes, which is what makes the two legs comparable.

export type ImplementationId = "ventijs" | "ws";

export type EchoServerOptions = {
  readonly port: number;
  readonly perMessageDeflate: boolean;
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
  readonly label: string;
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
