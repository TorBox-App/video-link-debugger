#!/usr/bin/env bun
import { createCLI } from "@bunli/core";

import testCommand from "./commands/test";
import speedtestCommand from "./commands/speedtest";

const cli = await createCLI({
  name: "video-link-debugger",
  version: "0.1.0",
  description: "CLI debugging application which tests any video link, and simulates start, seek, and buffer times for comparison or racing. Open source for transparency.",
});

cli.command(testCommand);
cli.command(speedtestCommand);

// Bunli only matches the camelCase option names (--skipTimings); accept the
// conventional kebab-case spelling (--skip-timings) too.
const argv = process.argv.slice(2).map((arg) => {
  if (!arg.startsWith("--")) return arg;
  const eq = arg.indexOf("=");
  const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
  const rest = eq === -1 ? "" : arg.slice(eq);
  return "--" + name.replace(/-([a-z0-9])/gi, (_, c: string) => c.toUpperCase()) + rest;
});

await cli.run(argv);

