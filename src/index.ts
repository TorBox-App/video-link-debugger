#!/usr/bin/env bun
import { createCLI } from "@bunli/core";

import testCommand from "./commands/test";

const cli = await createCLI({
  name: "video-link-debugger",
  version: "0.1.0",
  description: "CLI debugging application which tests any video link, and simulates start, seek, and buffer times for comparison or racing. Open source for transparency.",
});

cli.command(testCommand);

await cli.run();
