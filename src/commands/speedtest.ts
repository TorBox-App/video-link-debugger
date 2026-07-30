import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { headers } from "../library/http";
import { getLinkInformation } from "../functions/linkValidation";
import {
  getLinkTimings,
  downloadFull,
  type DownloadResult,
  type LinkTimings,
} from "../functions/downloadFunctions";
import {
  renderMultiTable,
  formatBytes,
  formatSpeed,
  formatDuration,
  highlight,
  type TableRow,
} from "../library/tables";
import { makeProgressBar } from "../library/progress";
import { renderCdnMap } from "../library/map";
import { sendResultsToPrivatebin } from "../functions/privatebinFunctions";

const SPEEDTEST_API = "https://api.torbox.app/v1/api/speedtest";

type SpeedtestFile = {
  region: string;
  name: string;
  domain: string;
  path: string;
  url: string;
  closest: boolean;
  coordinates?: { lat: number; lng: number };
};

type SpeedtestApiResponse = {
  success: boolean;
  detail: string;
  error: string | null;
  data: SpeedtestFile[] | null;
};

async function fetchSpeedtestFiles(params: {
  testLength: "short" | "long";
  region?: string;
  userIp?: string;
}): Promise<SpeedtestFile[]> {
  const url = new URL(SPEEDTEST_API);
  url.searchParams.set("test_length", params.testLength);
  if (params.region) url.searchParams.set("region", params.region);
  if (params.userIp) url.searchParams.set("user_ip", params.userIp);

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`TorBox API request failed: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as SpeedtestApiResponse;
  if (!body.success || !body.data) {
    throw new Error(`TorBox API error: ${body.error ?? body.detail}`);
  }
  return body.data;
}

type CdnResult = {
  cdn: SpeedtestFile;
  timings: LinkTimings | null;
  single: DownloadResult | null;
  multi: DownloadResult | null;
};

function bestSpeed(r: CdnResult): number {
  return Math.max(
    r.single?.avgBytesPerSecond ?? -1,
    r.multi?.avgBytesPerSecond ?? -1,
  );
}

function speedtestRows(
  results: CdnResult[],
  doMulti: boolean,
  bestIndex = -1,
): TableRow[] {
  const fmt = (n: number | null | undefined) =>
    n === null || n === undefined ? "—" : `${n.toFixed(2)} ms`;
  return results.map(({ cdn, timings, single, multi }, i) => {
    const sized = single ?? multi;
    const row = [
      cdn.closest ? `${cdn.region} *` : cdn.region,
      cdn.name,
      fmt(timings?.tcp),
      fmt(timings?.wait),
      sized ? formatBytes(sized.bytes) : "—",
      single
        ? `${formatSpeed(single.avgBytesPerSecond)} (${formatDuration(single.durationMs)})`
        : "—",
      ...(doMulti
        ? [
            multi
              ? `${formatSpeed(multi.avgBytesPerSecond)} (${formatDuration(multi.durationMs)})`
              : "—",
          ]
        : []),
    ];
    return i === bestIndex ? row.map(highlight) : row;
  });
}

export default defineCommand({
  name: "speedtest" as const,
  description: "Speed tests TorBox CDNs using test files from the TorBox API.",
  options: {
    count: option(z.coerce.number().int().min(1).default(1), {
      description: "Number of CDNs to test, closest first",
      short: "n",
    }),
    all: option(z.boolean().default(false), {
      description: "Test every returned CDN",
      short: "a",
      argumentKind: "flag",
    }),
    testLength: option(z.enum(["short", "long"]).default("short"), {
      description: "Size of the speedtest file: short or long",
      short: "t",
    }),
    region: option(z.string().optional(), {
      description: "Only test CDNs in this region (see --list-regions)",
      short: "r",
    }),
    userIp: option(z.string().optional(), {
      description: "IP used to determine the closest server (defaults to the calling IP)",
      short: "u",
    }),
    connections: option(z.coerce.number().int().min(1).default(4), {
      description: "Connections for the multi-connection download; 1 disables it",
      short: "c",
    }),
    listRegions: option(z.boolean().default(false), {
      description: "List the available regions and exit without testing",
      short: "R",
      argumentKind: "flag",
    }),
    mapOnly: option(z.boolean().default(false), {
      description: "Show the CDN location map and exit without testing",
      short: "M",
      argumentKind: "flag",
    }),
    skipPastebin: option(z.boolean().default(false), {
      description: "Skip uploading results to PrivateBin",
      short: "P",
      argumentKind: "flag",
    }),
  },
  handler: async ({ flags }) => {
    let files: SpeedtestFile[];
    try {
      files = await fetchSpeedtestFiles({
        testLength: flags.testLength,
        region: flags.region,
        userIp: flags.userIp,
      });
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
    if (files.length === 0) {
      console.error(
        flags.region
          ? `No CDNs returned for region "${flags.region}". Run with --list-regions to see the available regions.`
          : "No CDNs returned by the TorBox API.",
      );
      process.exit(1);
    }

    if (flags.listRegions) {
      console.log(
        renderMultiTable(
          "Available Regions",
          ["Region", "CDN", "Closest"],
          files.map((f) => [f.region, f.name, f.closest ? "✓" : ""]),
        ),
      );
      const map = renderCdnMap(files);
      if (map) console.log(map);
      return;
    }

    if (flags.mapOnly) {
      const map = renderCdnMap(files);
      if (map) console.log(map);
      else
        console.error(
          "Map unavailable: no CDN coordinates or terminal narrower than 74 columns.",
        );
      return;
    }

    const sorted = [...files].sort((a, b) => Number(b.closest) - Number(a.closest));
    const selected = flags.all ? sorted : sorted.slice(0, flags.count);
    console.log(
      `Testing ${selected.length} of ${files.length} CDNs (test_length: ${flags.testLength})`,
    );
    const map = renderCdnMap(selected);
    if (map) console.log(map);

    const doMulti = flags.connections > 1;
    const results: CdnResult[] = [];
    for (const cdn of selected) {
      const info = await getLinkInformation(cdn.url);
      const timings = await getLinkTimings(cdn.url);

      const singleBar = makeProgressBar(
        `${cdn.region} — ${cdn.name} (single connection)`,
      );
      let singleError: string | undefined;
      const single = await downloadFull(cdn.url, {
        connections: 1,
        size: info.size ?? undefined,
        onProgress: singleBar.update,
        onError: (m) => (singleError = m),
      });
      singleBar.finish(single, singleError);

      let multi: DownloadResult | null = null;
      if (doMulti && !!info.size && info.acceptsRanges) {
        const multiBar = makeProgressBar(
          `${cdn.region} — ${cdn.name} (${flags.connections} connections)`,
        );
        let multiError: string | undefined;
        multi = await downloadFull(cdn.url, {
          connections: flags.connections,
          size: info.size ?? undefined,
          onProgress: multiBar.update,
          onError: (m) => (multiError = m),
        });
        multiBar.finish(multi, multiError);
      }

      results.push({ cdn, timings, single, multi });
    }

    // Leaderboard: best achieved speed first, failed CDNs last.
    results.sort((a, b) => bestSpeed(b) - bestSpeed(a));

    let resultsUrl: string | null = null;
    if (!flags.skipPastebin) {
      try {
        resultsUrl = await sendResultsToPrivatebin({
          testLength: flags.testLength,
          connections: doMulti ? flags.connections : 1,
          results: results.map(({ cdn, timings, single, multi }) => ({
            region: cdn.region,
            name: cdn.name,
            domain: cdn.domain,
            closest: cdn.closest,
            coordinates: cdn.coordinates,
            timings,
            single,
            multi,
          })),
        });
      } catch (err) {
        console.error(`PrivateBin upload failed: ${(err as Error).message}`);
      }
    }

    // After the sort the fastest CDN is first; only highlight it when there is
    // a successful download and something to compare it against.
    const bestIndex =
      results.length > 1 && (results[0]?.single || results[0]?.multi) ? 0 : -1;
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
          ...(doMulti ? [`Multi (${flags.connections}x)`] : []),
        ],
        speedtestRows(results, doMulti, bestIndex),
      ),
    );
    if (results.some((r) => r.cdn.closest)) {
      console.log("* closest CDN");
    }
    if (bestIndex !== -1) {
      console.log(highlight("fastest CDN"));
    }
    if (resultsUrl) {
      console.log(`Results URL: ${resultsUrl}`);
    }
  },
});
