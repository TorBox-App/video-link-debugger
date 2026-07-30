import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { LiveBox, makeProgressBar, ok, err, dim } from "../library/progress";
import {
  getLinkInformation,
  blurFileName,
  type LinkInformation,
} from "../functions/linkValidation";
import {
  getLinkTimings,
  type TimingPhase,
  type DownloadResult,
  SeekRandomMultipleTimes,
  downloadFull,
} from "../functions/downloadFunctions";
import { PHASES, computeSeekStats } from "../library/tables";
import {
  printTestResults,
  type TestResultsPayload,
} from "../library/results";
import { sendResultsToPrivatebin } from "../functions/privatebinFunctions";

const MULTI_CONNECTIONS = 4;

type TestFlags = {
  skipTimings: boolean;
  skipSeek: boolean;
  skipDownload: boolean;
  skipPastebin: boolean;
  noBlur: boolean;
  chunkSize: number;
};

type LinkOutcome = {
  linkInfo: LinkInformation;
  payload: TestResultsPayload;
  resultsUrl: string | null;
};

async function runLinkTest(link: string, flags: TestFlags): Promise<LinkOutcome> {
  const { skipTimings, skipSeek, skipDownload, skipPastebin } = flags;

  const linkInfo = await getLinkInformation(link);
  if (!flags.noBlur && linkInfo.fileName) {
    linkInfo.fileName = blurFileName(linkInfo.fileName);
  }

  const results = new Map<TimingPhase, number>();
  let latencyMs: number | null = null;
  if (!skipTimings) {
    const box = new LiveBox("Measuring");
    const render = (force = false) =>
      box.update(
        [
          ...PHASES.map(({ key, label }) =>
            results.has(key)
              ? ok(`✓  ${label.padEnd(16)} ${results.get(key)!.toFixed(2)} ms`)
              : dim(`⋯  ${label}`),
          ),
          latencyMs !== null
            ? ok(`✓  ${"Latency".padEnd(16)} ${latencyMs.toFixed(2)} ms`)
            : dim(`⋯  Latency`),
        ],
        { force },
      );
    render(true);
    const linkTimings = await getLinkTimings(
      link,
      { start: 0, end: flags.chunkSize },
      (phase, ms) => {
        results.set(phase, ms);
        render();
      },
    );
    latencyMs = linkTimings?.tcp ?? null;
    box.finish(
      results.size > 0
        ? ok(
            `✓  Network timings measured${latencyMs !== null ? `  ·  Latency ${latencyMs.toFixed(2)} ms` : ""}`,
          )
        : err("✗  Network timing measurement failed"),
    );
  }

  const seekResults = skipSeek
    ? null
    : await SeekRandomMultipleTimes(linkInfo, link, 5, flags.chunkSize);

  let singleResult: DownloadResult | null = null;
  let multiResult: DownloadResult | null = null;
  const canMulti = !!linkInfo.size && linkInfo.acceptsRanges;

  if (!skipDownload) {
    const single = makeProgressBar("Downloading (single connection)");
    let singleError: string | undefined;
    singleResult = await downloadFull(link, {
      connections: 1,
      size: linkInfo.size ?? undefined,
      onProgress: single.update,
      onError: (m) => (singleError = m),
    });
    single.finish(singleResult, singleError);

    if (canMulti) {
      const multi = makeProgressBar(
        `Downloading (${MULTI_CONNECTIONS} connections)`,
      );
      let multiError: string | undefined;
      multiResult = await downloadFull(link, {
        connections: MULTI_CONNECTIONS,
        size: linkInfo.size ?? undefined,
        onProgress: multi.update,
        onError: (m) => (multiError = m),
      });
      multi.finish(multiResult, multiError);
    }
  }

  const payload: TestResultsPayload = {
    linkInfo,
    timings: !skipTimings
      ? { ...Object.fromEntries(results), latencyMs }
      : undefined,
    seekResults: !skipSeek && seekResults
      ? { runs: seekResults, stats: computeSeekStats(seekResults) }
      : undefined,
    downloadResults: !skipDownload
      ? { single: singleResult, multi: multiResult }
      : undefined,
  };

  let resultsUrl: string | null = null;
  if (!skipPastebin) {
    try {
      resultsUrl = await sendResultsToPrivatebin(payload);
    } catch (err) {
      console.error(`PrivateBin upload failed: ${(err as Error).message}`);
    }
  }

  printTestResults(payload);
  if (resultsUrl) {
    console.log(`Results URL: ${resultsUrl}`);
  }

  return { linkInfo, payload, resultsUrl };
}

export default defineCommand({
  name: "test" as const,
  description: "Tests a video link and simulates start, seek and buffering.",
  options: {
    link: option(z.url().optional(), { description: "Link to test", short: "l" }),
    file: option(z.string().optional(), {
      description: "Path to a text file with one link per line",
      short: "f",
    }),
    skipTimings: option(z.boolean().default(false), {
      description: "Skip network timing measurements",
      short: "T",
      argumentKind: "flag",
    }),
    skipSeek: option(z.boolean().default(false), {
      description: "Skip random seek tests",
      short: "S",
      argumentKind: "flag",
    }),
    skipDownload: option(z.boolean().default(false), {
      description: "Skip single- and multi-connection download tests",
      short: "D",
      argumentKind: "flag",
    }),
    skipPastebin: option(z.boolean().default(false), {
      description: "Skip uploading results to PrivateBin",
      short: "P",
      argumentKind: "flag",
    }),
    noBlur: option(z.boolean().default(false), {
      description: "Show the full file name instead of blurring it",
      short: "B",
      argumentKind: "flag",
    }),
    chunkSize: option(z.coerce.number().int().min(1).default(2048), {
      description: "Bytes fetched by the timing and seek probes",
      short: "C",
    }),
  },
  handler: async ({ flags, positional }) => {
    const fromFile: string[] = [];
    if (flags.file) {
      let text: string;
      try {
        text = await Bun.file(flags.file).text();
      } catch (err) {
        console.error(
          `Could not read links file "${flags.file}": ${(err as Error).message}`,
        );
        process.exit(1);
      }
      fromFile.push(
        ...text
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#")),
      );
    }

    const links = z
      .array(z.url())
      .min(1, "No links provided. Pass links as arguments, with --link, or with --file <path>.")
      .parse([...positional, ...(flags.link ? [flags.link] : []), ...fromFile]);

    const outcomes: LinkOutcome[] = [];
    for (const [index, link] of links.entries()) {
      if (links.length > 1) {
        console.log(`\n━━━ Link ${index + 1} of ${links.length} ━━━`);
      }
      outcomes.push(await runLinkTest(link, flags));
    }

    if (links.length > 1 && !flags.skipPastebin) {
      console.log("\nAll Results:");
      outcomes.forEach((outcome, i) => {
        const name = outcome.linkInfo.fileName ?? outcome.linkInfo.domain;
        console.log(`  [${i + 1}] ${name}: ${outcome.resultsUrl ?? "—"}`);
      });
      try {
        const combinedUrl = await sendResultsToPrivatebin({
          results: outcomes.map((outcome, i) => ({
            index: i + 1,
            resultsUrl: outcome.resultsUrl,
            ...outcome.payload,
          })),
        });
        console.log(`Combined Results URL: ${combinedUrl}`);
      } catch (err) {
        console.error(`Combined PrivateBin upload failed: ${(err as Error).message}`);
      }
    }
  },
});
