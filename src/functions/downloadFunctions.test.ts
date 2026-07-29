import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { downloadFull } from "./downloadFunctions";

function makeRangeServer(data: Uint8Array<ArrayBuffer>) {
    return Bun.serve({
        port: 0,
        fetch(req) {
            const range = req.headers.get("Range");
            const m = range?.match(/bytes=(\d+)-(\d+)/);
            if (m) {
                const start = Number(m[1]);
                const end = Math.min(Number(m[2]), data.length - 1);
                return new Response(data.slice(start, end + 1), {
                    status: 206,
                    headers: {
                        "Content-Range": `bytes ${start}-${end}/${data.length}`,
                        "Accept-Ranges": "bytes",
                    },
                });
            }
            return new Response(data, { headers: { "Accept-Ranges": "bytes" } });
        },
    });
}

describe("downloadFull", () => {
    // Odd size so the range boundaries don't fall on chunk-friendly offsets.
    const data = new Uint8Array(1_000_003);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) % 256;
    const expectedMd5 = createHash("md5").update(data).digest("hex");

    test("single-connection MD5 is the file hash", async () => {
        const server = makeRangeServer(data);
        try {
            const result = await downloadFull(`http://127.0.0.1:${server.port}/file.bin`);
            expect(result?.bytes).toBe(data.length);
            expect(result?.md5).toBe(expectedMd5);
        } finally {
            server.stop(true);
        }
    });

    test("multi-connection MD5 matches the single-connection file hash", async () => {
        const server = makeRangeServer(data);
        try {
            const result = await downloadFull(`http://127.0.0.1:${server.port}/file.bin`, {
                connections: 4,
                size: data.length,
            });
            expect(result?.connections).toBe(4);
            expect(result?.bytes).toBe(data.length);
            expect(result?.md5).toBe(expectedMd5);
        } finally {
            server.stop(true);
        }
    });
});
