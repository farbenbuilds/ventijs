import type { EchoConfig, EchoSample } from "./echo-types.ts";

export const configurationOf = (config: EchoConfig): string =>
  `${config.implementation}@${config.payloadBytes}B`;

export const measured = (config: EchoConfig, seconds: number): EchoSample => ({
  configuration: configurationOf(config),
  implementation: config.implementation,
  payloadBytes: config.payloadBytes,
  messages: config.messages,
  status: "measured",
  seconds,
  roundTripsPerSecond: config.messages / seconds,
  // Every payload byte crosses the socket twice, once each way. The upstream
  // `ws` speed harness counts both directions, so the columns stay comparable.
  wireBytesPerSecond: (config.payloadBytes * 2 * config.messages) / seconds,
  reason: null,
});

/// Reported instead of a number when a leg cannot produce one. Every number in
/// the report came from a `runEcho` that finished; nothing is extrapolated.
export const unavailable = (config: EchoConfig, reason: string): EchoSample => ({
  configuration: configurationOf(config),
  implementation: config.implementation,
  payloadBytes: config.payloadBytes,
  messages: config.messages,
  status: "unavailable",
  seconds: null,
  roundTripsPerSecond: null,
  wireBytesPerSecond: null,
  reason,
});
