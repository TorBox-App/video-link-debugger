import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { getLinkInformation } from "../functions/linkValidation";

export default defineCommand({
  name: "test" as const,
  description: "Tests a video link and simulates start, seek and buffering.",
  options: {
    link: option(z.url().optional(), { description: "Link to test", short: "l" }),
  },
  handler: async ({ spinner, flags, positional }) => {
    const link = z.url().parse(positional[0] ?? flags.link);

    const linkInfo = await getLinkInformation(link);
    if (linkInfo.error) {
        console.error(`Error validating link: ${linkInfo.error}`);
    }

    console.log("Link Information:");
    console.log(`Status: ${linkInfo.status}`);
    console.log(`Content-Type: ${linkInfo.contentType}`);
    console.log(`Size: ${linkInfo.size !== null ? `${linkInfo.size} bytes` : "Unknown"}`);
    console.log(`Accepts Ranges: ${linkInfo.acceptsRanges}`);
    console.log(`File Name: ${linkInfo.fileName}`);
    console.log(`Is Video: ${linkInfo.isVideo}`);



    // const spin = spinner("Installing dependencies...");
    // spin.start();
  },
});