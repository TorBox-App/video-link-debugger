import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import { getLinkInformation } from "../functions/linkValidation";
import {
  getLinkTimings,
  type TimingPhase,
  type DownloadProgress,
  type DownloadResult,
  SeekRandomMultipleTimes,
  downloadFull,
} from "../functions/downloadFunctions";
import {
  PHASES,
  renderTable,
  renderMultiTable,
  linkInfoRows,
  timingRows,
  seekRows,
  downloadRows,
  formatBytes,
  formatSpeed,
} from "../library/tables";

const MULTI_CONNECTIONS = 4;
const BAR_WIDTH = 40;

function makeProgressBox(renderer: CliRenderer, title: string) {
  const box = new BoxRenderable(renderer, {
    borderStyle: "rounded",
    padding: 1,
    title,
  });
  const bar = new TextRenderable(renderer, { content: "", fg: "#888888" });
  const stats = new TextRenderable(renderer, { content: "", fg: "#888888" });
  box.add(bar);
  box.add(stats);

  const update = (state: DownloadProgress) => {
    if (state.totalBytes !== null && state.totalBytes > 0) {
      const pct = Math.min(1, state.bytes / state.totalBytes);
      const filled = Math.floor(pct * BAR_WIDTH);
      bar.content = `${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)} ${(pct * 100).toFixed(1)}%`;
    } else {
      bar.content = "░".repeat(BAR_WIDTH);
    }
    const total = state.totalBytes !== null ? ` / ${formatBytes(state.totalBytes)}` : "";
    stats.content = `${formatBytes(state.bytes)}${total}  ·  ${formatSpeed(state.bytesPerSecond)}`;
  };

  const finish = (color: string) => {
    bar.fg = color;
    stats.fg = color;
  };

  return { box, update, finish };
}

export default defineCommand({
  name: "test" as const,
  description: "Tests a video link and simulates start, seek and buffering.",
  options: {
    link: option(z.url().optional(), { description: "Link to test", short: "l" }),
  },
  handler: async ({ flags, positional }) => {
    const link = z.url().parse(positional[0] ?? flags.link);

    const linkInfo = await getLinkInformation(link);

    const renderer = await createCliRenderer({ exitOnCtrlC: true });

    const progressBox = new BoxRenderable(renderer, {
      borderStyle: "rounded",
      padding: 1,
      title: "Measuring",
    });
    const rows = new Map<TimingPhase, TextRenderable>();
    for (const { key, label } of PHASES) {
      const row = new TextRenderable(renderer, {
        content: `⋯  ${label}`,
        fg: "#888888",
      });
      rows.set(key, row);
      progressBox.add(row);
    }
    renderer.root.add(progressBox);

    const results = new Map<TimingPhase, number>();
    await getLinkTimings(link, undefined, (phase, ms) => {
      results.set(phase, ms);
      const row = rows.get(phase);
      if (!row) return;
      const label = PHASES.find((p) => p.key === phase)?.label ?? phase;
      row.content = `✓  ${label.padEnd(16)} ${ms.toFixed(2)} ms`;
      row.fg = "#00d787";
    });

    const seekResults = await SeekRandomMultipleTimes(linkInfo, link, 5);

    const single = makeProgressBox(renderer, "Downloading (single connection)");
    renderer.root.add(single.box);
    const singleResult = await downloadFull(link, {
      connections: 1,
      size: linkInfo.size ?? undefined,
      onProgress: single.update,
    });
    single.finish(singleResult ? "#00d787" : "#ff5f5f");

    let multiResult: DownloadResult | null = null;
    const canMulti = !!linkInfo.size && linkInfo.acceptsRanges;
    if (canMulti) {
      const multi = makeProgressBox(
        renderer,
        `Downloading (${MULTI_CONNECTIONS} connections)`,
      );
      renderer.root.add(multi.box);
      multiResult = await downloadFull(link, {
        connections: MULTI_CONNECTIONS,
        size: linkInfo.size ?? undefined,
        onProgress: multi.update,
      });
      multi.finish(multiResult ? "#00d787" : "#ff5f5f");
    }

    renderer.destroy();

    console.log(renderTable("Link Information", linkInfoRows(linkInfo)));
    console.log(renderTable("Network Timings", timingRows(results)));
    console.log(
      renderMultiTable(
        "Seek Results",
        ["#", "Status", "TTFB", "Receive", "Total"],
        seekRows(seekResults),
      ),
    );
    console.log(
      renderMultiTable(
        "Download Comparison",
        ["Mode", "Conns", "Time", "Bytes", "Speed"],
        downloadRows([
          { label: "Single", result: singleResult },
          ...(canMulti
            ? [{ label: `Multi`, result: multiResult }]
            : []),
        ]),
      ),
    );
    if (!canMulti) {
      console.log(
        `Multi-connection skipped: ${
          !linkInfo.size ? "size unknown" : "server doesn't accept ranges"
        }.`,
      );
    }
  },
});
