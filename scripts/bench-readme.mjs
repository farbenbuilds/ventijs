// The generated README on the benchmark-data branch. It is written from the
// index and the newest record only, so a consumer reading the branch never has
// to parse a record to see the current numbers.

export const README_HISTORY_LIMIT = 100;

const integer = new Intl.NumberFormat("en-US");

const ratio = (value) => (value === null ? "n/a" : value.toFixed(3));

const table = (header, rows) =>
  [header, header.map(() => "---"), ...rows].map((row) => `| ${row.join(" | ")} |`).join("\n");

const latestTable = (record) => {
  const {
    implementations,
    gate_candidate: candidate,
    gate_baseline: baseline,
  } = record.methodology;
  const header = ["payload", ...implementations, `${candidate} vs ${baseline}`];
  const rows = record.results.configurations.map((configuration) => [
    `${configuration.payload_bytes} B`,
    ...implementations.map((id) => {
      const value = configuration.legs[id].median_round_trips_per_second;
      return value === null ? "n/a" : integer.format(value);
    }),
    ratio(configuration.candidate_to_baseline_ratio),
  ]);
  return table(header, rows);
};

const historyTable = (entries) =>
  table(
    ["Recorded UTC", "Commit", "Median ratio vs ws", "Worst row", "Gate", "Evidence"],
    entries.map((entry) => [
      entry.recorded_at,
      `\`${entry.commit_sha.slice(0, 12)}\``,
      ratio(entry.median_ratio),
      entry.worst_payload_bytes === null ? "n/a" : `${entry.worst_payload_bytes} B`,
      entry.passed ? "pass" : "fail",
      `[record](${entry.record_path})`,
    ]),
  );

export const renderReadme = (index, latest, contractPath) => `# ventiws benchmark history

This branch is the durable, machine-readable history for \`${latest.benchmark_id}\`.
See [the contract](${contractPath}) for the guarantee and reproduction procedure.
\`index.json\` retains the active series; the table below shows the latest
${README_HISTORY_LIMIT} runs. Earlier series stay as \`index-<benchmark-id>.json\`
beside the records.

## Latest results

Median round trips per second; the last column is the gate ratio.

${latestTable(latest)}

## Recorded runs

${historyTable(index.records.slice(0, README_HISTORY_LIMIT))}
`;
