# ventiws benchmark history

This branch is the durable, machine-readable history for `echo-throughput-v1`.
See [CONTRACT.md](CONTRACT.md) for the guarantee and reproduction procedure.
`index.json` retains the complete history; the table below shows the latest
100 runs.

## Latest results

Median round trips per second; the last column is the gate ratio.

| payload | ws | ventiws | uWebSockets.js | socket.io | ventiws vs ws |
| --- | --- | --- | --- | --- | --- |
| 64 B | 36,611 | 8,063 | 42,474 | 9,121 | 0.220 |
| 1024 B | 31,714 | 7,892 | 38,169 | 8,937 | 0.249 |
| 16384 B | 11,860 | 5,669 | 16,854 | 6,116 | 0.478 |
| 32768 B | 7,318 | 4,496 | 9,421 | 4,566 | 0.614 |

## Recorded runs

| Recorded UTC | Commit | Median ratio vs ws | Worst row | Gate | Evidence |
| --- | --- | --- | --- | --- | --- |
| 2026-10-03T06:46:37.451Z | `20a0dcc1ca4b` | 0.363 | 64 B | fail | [record](records/2026/37102633805-1-20a0dcc1ca4b.json) |
