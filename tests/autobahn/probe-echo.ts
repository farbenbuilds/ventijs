import { WebSocket as WsClient } from "ws";

/// Measured facts about the target, gathered by dialling it with the pinned `ws`
/// client. The suite is the authoritative conformance signal, but a suite run
/// costs minutes and reports the same thing less precisely, so the runner
/// probes first and keeps what it measured as the evidence for the verdict.
export type EchoProbe = {
  readonly port: number;
  readonly engine: string;
  readonly echo: boolean;
  readonly handshake: boolean;
  readonly textEcho: boolean;
  readonly binaryEcho: boolean;
  readonly inboundLimitBytes: number;
  readonly overLimitCloseCode: number | null;
  readonly overLimitCloseReason: string;
  readonly detail: string;
};

type ProbeOutcome = {
  readonly opened: boolean;
  readonly textEcho: boolean;
  readonly binaryEcho: boolean;
  readonly closeCode: number | null;
  readonly closeReason: string;
};

type ProbeState = {
  opened: boolean;
  textEcho: boolean;
  binaryEcho: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
};

const PROBE_TIMEOUT_MS = 2000;
const TEXT_PAYLOAD = "ventijs-autobahn-probe";
const BINARY_PAYLOAD = Buffer.from([0x00, 0xff, 0x10, 0x7f, 0x80, 0xfe]);
/// Two payloads above the engine's `message_capacity`: the first the suite-sized
/// case group 9.1 uses, the second the size group 9.3 uses. Both are far above
/// the cap, and both must come back as a close rather than a silent hang.
const OVER_LIMIT_BYTES = [64 * 1024, 4 * 1024 * 1024] as const;

const NO_RESULT: ProbeOutcome = {
  opened: false,
  textEcho: false,
  binaryEcho: false,
  closeCode: null,
  closeReason: "",
};

/// One connection: a handshake, one message, then a close handshake. Every stage
/// is bounded, so a target that accepts the connection and then goes quiet still
/// produces a verdict instead of hanging the runner.
function probeSession(port: number, payload: Buffer | string): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    const state: ProbeState = {
      opened: false,
      textEcho: false,
      binaryEcho: false,
      timer: undefined,
    };
    const finish = (closeCode: number | null, closeReason: string): void => {
      if (state.timer !== undefined) clearTimeout(state.timer);
      state.timer = undefined;
      client.removeAllListeners();
      // A target that never answers leaves the socket open and keeps the
      // runner's event loop alive. Terminating after the listeners are gone
      // releases it without changing the verdict.
      client.terminate();
      resolve({
        opened: state.opened,
        textEcho: state.textEcho,
        binaryEcho: state.binaryEcho,
        closeCode,
        closeReason,
      });
    };
    const client = new WsClient(`ws://127.0.0.1:${port}/`, { maxPayload: 8 * 1024 * 1024 });
    state.timer = setTimeout(() => {
      finish(null, "");
    }, PROBE_TIMEOUT_MS);
    client.on("open", () => {
      state.opened = true;
      client.send(payload);
    });
    client.on("message", (_data: Buffer, isBinary: boolean) => {
      if (isBinary) state.binaryEcho = true;
      else state.textEcho = true;
    });
    // A protocol-level rejection is a verdict about the target, not a harness
    // failure, so the error event is observed and the close event decides.
    client.on("error", () => undefined);
    client.on("close", (code: number, reason: Buffer) => {
      finish(code, reason.toString());
    });
  });
}

async function measureOverLimit(port: number): Promise<ProbeOutcome> {
  let last: ProbeOutcome = NO_RESULT;
  for (const size of OVER_LIMIT_BYTES) {
    const result = await probeSession(port, Buffer.alloc(size, 0x61));
    if (result.closeCode !== null) return result;
    last = result;
  }
  return last;
}

export async function probeTarget(input: {
  readonly port: number;
  readonly engine: string;
  readonly inboundLimitBytes: number;
}): Promise<EchoProbe> {
  const text = await probeSession(input.port, TEXT_PAYLOAD);
  const binary = text.opened ? await probeSession(input.port, BINARY_PAYLOAD) : text;
  const overLimit = await measureOverLimit(input.port);
  const echo = text.textEcho && binary.binaryEcho;
  const detail = echo
    ? "target echoed a text and a binary payload"
    : `no echo: text=${String(text.textEcho)} binary=${String(binary.binaryEcho)} close=${String(text.closeCode)}`;
  return {
    port: input.port,
    engine: input.engine,
    echo,
    handshake: text.opened,
    textEcho: text.textEcho,
    binaryEcho: binary.binaryEcho,
    inboundLimitBytes: input.inboundLimitBytes,
    overLimitCloseCode: overLimit.closeCode,
    overLimitCloseReason: overLimit.closeReason,
    detail,
  };
}
