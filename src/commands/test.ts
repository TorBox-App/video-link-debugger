import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { getLinkInformation } from "../functions/linkValidation";
import {
  getLinkTimings,
  type TimingPhase,
  SeekRandomMultipleTimes,
} from "../functions/downloadFunctions";
import {
  PHASES,
  renderTable,
  renderMultiTable,
  linkInfoRows,
  timingRows,
  seekRows,
} from "../library/tables";

export default defineCommand({
  name: "test" as const,
  description: "Tests a video link and simulates start, seek and buffering.",
  options: {
    link: option(z.url().optional(), { description: "Link to test", short: "l" }),
  },
  handler: async ({ flags, positional }) => {
    const link = z.url().parse(positional[0] ?? flags.link);

    const linkInfo = await getLinkInformation(link);

    const renderer = await createCliRenderer({ exitOnCtrlC: false });
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

    // Simulate 5 random seeks to see if range requests work well
    const seekResults = await SeekRandomMultipleTimes(linkInfo, link, 5);

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
  },
});
