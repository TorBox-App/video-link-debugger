import {
  renderTable,
  renderMultiTable,
  linkInfoRows,
  timingRows,
  seekRows,
  seekStatsRows,
  downloadRows,
  highlight,
  formatBytes,
  formatSpeed,
  formatDuration,
  type TableRow,
  type SeekStats,
} from "./tables";
import type { LinkInformation } from "../functions/linkValidation";
import type {
  LinkTimings,
  TimingPhase,
  DownloadResult,
} from "../functions/downloadFunctions";

// The shapes uploaded to PrivateBin by `test` and `speedtest`. The same
// printers render both the live run and a payload fetched back by `view`,
// so the two outputs can never drift apart.

export type TestResultsPayload = {
  linkInfo: LinkInformation;
  timings?: Partial<Record<TimingPhase, number>> & { latencyMs?: number | null };
  seekResults?: { runs: LinkTimings[]; stats?: SeekStats };
  downloadResults?: {
    single: DownloadResult | null;
    multi: DownloadResult | null;
  };
};

export function printTestResults(payload: TestResultsPayload): void {
  console.log(renderTable("Link Information", linkInfoRows(payload.linkInfo)));
  if (payload.timings) {
    const { latencyMs, ...phases } = payload.timings;
    const results = new Map<TimingPhase, number>();
    for (const [key, value] of Object.entries(phases)) {
      if (typeof value === "number") results.set(key as TimingPhase, value);
    }
    console.log(renderTable("Network Timings", timingRows(results, latencyMs ?? null)));
  }
  const runs = payload.seekResults?.runs;
  if (runs && runs.length > 0) {
    console.log(
      renderMultiTable(
        "Seek Results",
        ["#", "Status", "TTFB", "Receive", "Total"],
        [...seekRows(runs), ...seekStatsRows(runs)],
      ),
    );
  }
  if (payload.downloadResults) {
    const canMulti = !!payload.linkInfo.size && payload.linkInfo.acceptsRanges;
    console.log(
      renderMultiTable(
        "Download Comparison",
        ["Mode", "Conns", "Time", "Bytes", "Speed", "MD5"],
        downloadRows([
          { label: "Single", result: payload.downloadResults.single },
          ...(canMulti
            ? [{ label: "Multi", result: payload.downloadResults.multi }]
            : []),
        ]),
      ),
    );
  }
}

export type SpeedtestEntry = {
  region: string;
  name: string;
  domain?: string;
  closest?: boolean;
  coordinates?: { lat: number; lng: number };
  timings?: { tcp?: number | null; wait?: number | null } | null;
  single?: DownloadResult | null;
  multi?: DownloadResult | null;
};

export type SpeedtestResultsPayload = {
  testLength?: string;
  connections?: number;
  results: SpeedtestEntry[];
};

export function bestSpeed(e: SpeedtestEntry): number {
  return Math.max(
    e.single?.avgBytesPerSecond ?? -1,
    e.multi?.avgBytesPerSecond ?? -1,
  );
}

function speedtestRows(
  entries: SpeedtestEntry[],
  doMulti: boolean,
  bestIndex: number,
): TableRow[] {
  const fmt = (n: number | null | undefined) =>
    n === null || n === undefined ? "—" : `${n.toFixed(2)} ms`;
  return entries.map((e, i) => {
    const sized = e.single ?? e.multi;
    const row = [
      e.closest ? `${e.region} *` : e.region,
      e.name,
      fmt(e.timings?.tcp),
      fmt(e.timings?.wait),
      sized ? formatBytes(sized.bytes) : "—",
      e.single
        ? `${formatSpeed(e.single.avgBytesPerSecond)} (${formatDuration(e.single.durationMs)})`
        : "—",
      ...(doMulti
        ? [
            e.multi
              ? `${formatSpeed(e.multi.avgBytesPerSecond)} (${formatDuration(e.multi.durationMs)})`
              : "—",
          ]
        : []),
    ];
    return i === bestIndex ? row.map(highlight) : row;
  });
}

export function printSpeedtestResults(payload: SpeedtestResultsPayload): void {
  const doMulti = (payload.connections ?? 1) > 1;
  // Leaderboard: best achieved speed first, failed CDNs last.
  const entries = [...payload.results].sort((a, b) => bestSpeed(b) - bestSpeed(a));
  // Only highlight the fastest when there is a successful download and
  // something to compare it against.
  const bestIndex =
    entries.length > 1 && (entries[0]?.single || entries[0]?.multi) ? 0 : -1;
  console.log(
    renderMultiTable(
      "Speedtest Results",
      [
        "Region",
        "Name",
        "Latency",
        "TTFB",
        "Size",
        "Single",
        ...(doMulti ? [`Multi (${payload.connections}x)`] : []),
      ],
      speedtestRows(entries, doMulti, bestIndex),
    ),
  );
  if (entries.some((e) => e.closest)) {
    console.log("* closest CDN");
  }
  if (bestIndex !== -1) {
    console.log(highlight("fastest CDN"));
  }
}
