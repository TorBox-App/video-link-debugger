import { defineCommand } from "@bunli/core";
import { PrivatebinClient } from "@pixelfactory/privatebin";
import bs58 from "bs58";
import {
  printTestResults,
  printSpeedtestResults,
  type TestResultsPayload,
  type SpeedtestResultsPayload,
} from "../library/results";
import { renderCdnMap } from "../library/map";

function fatal(message: string): never {
  console.error(message);
  process.exit(1);
}

function render(payload: unknown): void {
  const p = payload as {
    results?: unknown[];
    linkInfo?: unknown;
  };
  if (
    Array.isArray(p?.results) &&
    p.results.length > 0 &&
    p.results.every((r) => !!(r as { region?: string })?.region)
  ) {
    const speedtest = payload as SpeedtestResultsPayload;
    // Payloads from before the two-pass change stored one download as `download`.
    for (const entry of speedtest.results as Array<
      SpeedtestResultsPayload["results"][number] & { download?: never }
    >) {
      entry.single ??= (entry as { download?: typeof entry.single }).download ?? null;
    }
    const map = renderCdnMap(speedtest.results);
    if (map) console.log(map);
    printSpeedtestResults(speedtest);
    return;
  }
  if (
    Array.isArray(p?.results) &&
    p.results.length > 0 &&
    p.results.every((r) => !!(r as { linkInfo?: unknown })?.linkInfo)
  ) {
    const list = p.results as Array<
      TestResultsPayload & { resultsUrl?: string | null }
    >;
    list.forEach((entry, i) => {
      console.log(`${i > 0 ? "\n" : ""}━━━ Link ${i + 1} of ${list.length} ━━━`);
      printTestResults(entry);
      if (entry.resultsUrl) console.log(`Results URL: ${entry.resultsUrl}`);
    });
    return;
  }
  if (p?.linkInfo) {
    printTestResults(payload as TestResultsPayload);
    return;
  }
  fatal("Unrecognized results payload — was this paste created by video-link-debugger?");
}

export default defineCommand({
  name: "view" as const,
  description:
    "Fetches a Results URL and renders the result tables it contains.",
  handler: async ({ positional }) => {
    const link = positional[0];
    if (!link || positional.length > 1) {
      fatal("Usage: video-link-debugger view <results-url>");
    }
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      fatal(`Not a valid URL: ${link}`);
    }
    const id = url.search.replace(/^\?/, "");
    const keyText = url.hash.replace(/^#/, "");
    if (!id || !keyText) {
      fatal(
        "Not a PrivateBin results URL — expected the form https://privatebin.net/?<id>#<key>",
      );
    }

    let text: string;
    try {
      const client = new PrivatebinClient(url.origin);
      const paste = await client.getText(id, bs58.decode(keyText));
      text = paste.paste;
    } catch (err) {
      fatal(`Could not fetch results: ${(err as Error).message}`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      fatal("The paste does not contain JSON results from this tool.");
    }
    render(payload);
  },
});
