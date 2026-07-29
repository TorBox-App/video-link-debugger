import type {
  DownloadProgress,
  DownloadResult,
} from "../functions/downloadFunctions";
import {
  formatBytes,
  formatSpeed,
  formatDuration,
  formatEta,
  visibleLength,
  padVisible,
} from "./tables";

const isTTY = process.stdout.isTTY === true;
const colorEnabled = isTTY && !process.env.NO_COLOR;

const GREEN = "\x1b[38;2;0;215;135m";
const RED = "\x1b[38;2;255;95;95m";
const GRAY = "\x1b[38;2;136;136;136m";
const RESET = "\x1b[0m";

const paint = (color: string, s: string) =>
  colorEnabled ? `${color}${s}${RESET}` : s;

export const ok = (s: string) => paint(GREEN, s);
export const err = (s: string) => paint(RED, s);
export const dim = (s: string) => paint(GRAY, s);

const UPDATE_INTERVAL_MS = 100;

// Terminals occasionally report 0 or tiny widths (odd PTYs, CI); fall back to
// 80 so repeat()/width math never goes negative.
const columns = () => {
  const c = process.stdout.columns;
  return c && c >= 20 ? c : 80;
};

// Cut a string to `max` visible characters, keeping ANSI sequences intact.
function truncateVisible(s: string, max: number): string {
  if (visibleLength(s) <= max) return s;
  let out = "";
  let count = 0;
  let i = 0;
  let sawAnsi = false;
  while (i < s.length && count < max) {
    const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i));
    if (m) {
      out += m[0];
      i += m[0].length;
      sawAnsi = true;
      continue;
    }
    out += s[i];
    i++;
    count++;
  }
  return sawAnsi ? out + RESET : out;
}

function renderBox(title: string, lines: string[]): string[] {
  const inner = Math.min(
    Math.max(title.length + 2, ...lines.map(visibleLength)),
    columns() - 4,
  );
  const titleBar = ` ${title} `;
  const top = `╭${titleBar}${"─".repeat(Math.max(0, inner + 2 - titleBar.length))}╮`;
  const body = lines.map(
    (l) => `│ ${padVisible(truncateVisible(l, inner), inner)} │`,
  );
  const bot = `╰${"─".repeat(inner + 2)}╯`;
  return [top, ...body, bot].map((l) => truncateVisible(l, columns() - 1));
}

/**
 * A small in-place live region: `update` redraws a box at the cursor by
 * rewriting only its own lines (cursor-up + erase), `finish` replaces it with
 * a single static line that scrolls away naturally. Everything above the box
 * is ordinary terminal text, so scrolling can never corrupt earlier output.
 * When stdout is not a TTY only the `finish` line is printed.
 */
export class LiveBox {
  private renderedLines = 0;
  private lastDraw = 0;

  constructor(private readonly title: string) {}

  update(lines: string[], opts?: { force?: boolean }): void {
    if (!isTTY) return;
    const now = Date.now();
    if (!opts?.force && now - this.lastDraw < UPDATE_INTERVAL_MS) return;
    this.lastDraw = now;
    const box = renderBox(this.title, lines);
    process.stdout.write(this.eraser() + box.join("\n") + "\n");
    this.renderedLines = box.length;
  }

  finish(line: string): void {
    process.stdout.write(this.eraser() + line + "\n");
    this.renderedLines = 0;
  }

  private eraser(): string {
    return this.renderedLines > 0 ? `\x1b[${this.renderedLines}A\x1b[0J` : "";
  }
}

const BAR_WIDTH = Math.max(10, Math.min(40, columns() - 40));

export function makeProgressBar(title: string) {
  const box = new LiveBox(title);
  box.update([dim("░".repeat(BAR_WIDTH)), dim("connecting…")], { force: true });

  const update = (state: DownloadProgress) => {
    let bar: string;
    if (state.totalBytes !== null && state.totalBytes > 0) {
      const pct = Math.min(1, state.bytes / state.totalBytes);
      const filled = Math.floor(pct * BAR_WIDTH);
      bar = `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)} ${(pct * 100).toFixed(1)}%`;
    } else {
      bar = "░".repeat(BAR_WIDTH);
    }
    const total =
      state.totalBytes !== null ? ` / ${formatBytes(state.totalBytes)}` : "";
    const eta =
      state.totalBytes !== null && state.bytesPerSecond > 0
        ? `  ·  ETA ${formatEta((state.totalBytes - state.bytes) / state.bytesPerSecond)}`
        : "";
    const stats = `${formatBytes(state.bytes)}${total}  ·  ${formatSpeed(state.bytesPerSecond)}${eta}`;
    box.update([dim(bar), dim(stats)]);
  };

  const finish = (result: DownloadResult | null, failNote?: string) => {
    box.finish(
      result
        ? ok(
            `✓  ${title}  ·  ${formatBytes(result.bytes)} in ${formatDuration(result.durationMs)}  ·  ${formatSpeed(result.avgBytesPerSecond)}`,
          )
        : err(`✗  ${title}  ·  ${failNote ?? "download failed"}`),
    );
  };

  return { update, finish };
}
