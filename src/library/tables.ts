import type { LinkInformation } from "../functions/linkValidation";
import type {
  LinkTimings,
  TimingPhase,
  DownloadResult,
} from "../functions/downloadFunctions";

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(2)} ${units[i]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export const PHASES: { key: TimingPhase; label: string }[] = [
  { key: "dns", label: "DNS Resolution" },
  { key: "tcp", label: "TCP Connect" },
  { key: "tls", label: "TLS Setup" },
  { key: "send", label: "Sending" },
  { key: "wait", label: "Waiting (TTFB)" },
  { key: "receive", label: "Receiving" },
];

export function renderTable(title: string, rows: [string, string][]): string {
  const keyW = Math.max(0, ...rows.map((r) => r[0].length));
  const valW = Math.max(0, ...rows.map((r) => r[1].length));
  const inner = keyW + valW + 5;
  const titleBar = ` ${title} `;
  const top = `╭${titleBar}${"─".repeat(Math.max(0, inner - titleBar.length))}╮`;
  const sep = `├${"─".repeat(keyW + 2)}┬${"─".repeat(valW + 2)}┤`;
  const bot = `╰${"─".repeat(keyW + 2)}┴${"─".repeat(valW + 2)}╯`;
  const body = rows.map(([k, v]) => `│ ${k.padEnd(keyW)} │ ${v.padEnd(valW)} │`);
  return [top, sep, ...body, bot].join("\n");
}

export function renderMultiTable(
  title: string,
  headers: string[],
  rows: string[][],
): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const inner = widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 3 + 2;
  const titleBar = ` ${title} `;
  const top = `╭${titleBar}${"─".repeat(Math.max(0, inner - titleBar.length))}╮`;
  const colSep = `├${widths.map((w) => "─".repeat(w + 2)).join("┬")}┤`;
  const headerLine = `│ ${headers.map((h, i) => h.padEnd(widths[i]!)).join(" │ ")} │`;
  const headerSep = `├${widths.map((w) => "─".repeat(w + 2)).join("┼")}┤`;
  const bodyLines = rows.map(
    (r) => `│ ${r.map((c, i) => (c ?? "").padEnd(widths[i]!)).join(" │ ")} │`,
  );
  const bot = `╰${widths.map((w) => "─".repeat(w + 2)).join("┴")}╯`;
  return [top, colSep, headerLine, headerSep, ...bodyLines, bot].join("\n");
}

export function linkInfoRows(info: LinkInformation): [string, string][] {
  return [
    ["Status", String(info.status)],
    ["Content-Type", info.contentType ?? "—"],
    ["Size", info.size !== null ? `${info.size} bytes` : "—"],
    ["Accepts Ranges", String(info.acceptsRanges)],
    ["File Name", info.fileName ?? "—"],
    ["Is Video", String(info.isVideo)],
    ["Domain", info.domain],
    ...(info.error ? ([["Error", info.error]] as [string, string][]) : []),
  ];
}

export function timingRows(results: Map<TimingPhase, number>): [string, string][] {
  return PHASES.map(({ key, label }) => [
    label,
    results.has(key) ? `${results.get(key)!.toFixed(2)} ms` : "—",
  ]);
}

export function downloadRows(
  results: { label: string; result: DownloadResult | null }[],
): string[][] {
  return results.map(({ label, result }) =>
    result === null
      ? [label, "—", "—", "—", "—"]
      : [
          label,
          String(result.connections),
          formatDuration(result.durationMs),
          formatBytes(result.bytes),
          formatSpeed(result.avgBytesPerSecond),
        ],
  );
}

export function seekRows(seeks: LinkTimings[]): string[][] {
  const fmt = (n: number | null) => (n === null ? "—" : `${n.toFixed(2)} ms`);
  return seeks.map((s, i) => [
    String(i + 1),
    s.statusCode?.toString() ?? "—",
    fmt(s.wait),
    fmt(s.receive),
    fmt(s.total),
  ]);
}
