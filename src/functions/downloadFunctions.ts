import * as dns from "node:dns/promises";
import * as net from "node:net";
import * as tls from "node:tls";
import { createHash } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headers } from "../library/http";
import { LinkInformation } from "./linkValidation";

export interface LinkTimings {
    dns: number | null;
    tcp: number | null;
    tls: number | null;
    send: number | null;
    wait: number | null;
    receive: number | null;
    total: number;
    statusCode: number | null;
}

export type TimingPhase = "dns" | "tcp" | "tls" | "send" | "wait" | "receive";

export async function getLinkTimings(
    link: string,
    range: { start?: number; end?: number } = { start: 0, end: 2048 },
    onPhase?: (phase: TimingPhase, durationMs: number) => void,
): Promise<LinkTimings | null> {
    const url = new URL(link);
    const isHttps = url.protocol === "https:";
    const port = Number(url.port) || (isHttps ? 443 : 80);

    const start = performance.now();

    try {
        const dnsStart = performance.now();
        const { address } = await dns.lookup(url.hostname);
        const dnsEnd = performance.now();
        onPhase?.("dns", dnsEnd - dnsStart);

        const tcpStart = performance.now();
        const tcpSocket = await new Promise<net.Socket>((resolve, reject) => {
            const s = net.connect({ host: address, port });
            s.once("connect", () => resolve(s));
            s.once("error", reject);
        });
        const tcpEnd = performance.now();
        onPhase?.("tcp", tcpEnd - tcpStart);

        let socket: net.Socket | tls.TLSSocket = tcpSocket;
        let tlsEnd: number | null = null;
        if (isHttps) {
            socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
                const t = tls.connect({
                    socket: tcpSocket,
                    servername: url.hostname,
                    ALPNProtocols: ["http/1.1"],
                });
                t.once("secureConnect", () => resolve(t));
                t.once("error", reject);
            });
            tlsEnd = performance.now();
            onPhase?.("tls", tlsEnd - tcpEnd);
        }

        const sendStart = performance.now();
        const requestText =
            `GET ${url.pathname + url.search} HTTP/1.1\r\n` +
            `Host: ${url.hostname}\r\n` +
            Object.entries({ ...headers, Range: `bytes=${range.start}-${range.end}` })
                .map(([k, v]) => `${k}: ${v}`)
                .join("\r\n") +
            `\r\nConnection: close\r\n\r\n`;
        await new Promise<void>((resolve, reject) => {
            socket.write(requestText, (err) => (err ? reject(err) : resolve()));
        });
        const sendEnd = performance.now();
        onPhase?.("send", sendEnd - sendStart);

        return await new Promise<LinkTimings | null>((resolve) => {
            let firstByte: number | null = null;
            let headerBuf = "";
            let statusCode: number | null = null;

            socket.on("data", (chunk: Buffer) => {
                if (firstByte === null) {
                    firstByte = performance.now();
                    onPhase?.("wait", firstByte - sendEnd);
                }
                if (statusCode === null) {
                    headerBuf += chunk.toString("latin1");
                    const eoh = headerBuf.indexOf("\r\n\r\n");
                    if (eoh !== -1) {
                        const statusLine = headerBuf.split("\r\n", 1)[0] ?? "";
                        const match = statusLine.match(/^HTTP\/1\.\d (\d+)/);
                        if (match) statusCode = Number(match[1]);
                        headerBuf = "";
                    }
                }
            });

            socket.once("end", () => {
                const end = performance.now();
                if (firstByte !== null) onPhase?.("receive", end - firstByte);

                resolve({
                    dns: dnsEnd - dnsStart,
                    tcp: tcpEnd - tcpStart,
                    tls: tlsEnd !== null ? tlsEnd - tcpEnd : null,
                    send: sendEnd - sendStart,
                    wait: firstByte !== null ? firstByte - sendEnd : null,
                    receive: firstByte !== null ? end - firstByte : null,
                    total: end - start,
                    statusCode,
                });
            });

            socket.once("error", (err) => {
                console.error(`Socket error: ${err.message}`);
                resolve(null);
            });
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error fetching link: ${message}`);
        return null;
    }
}

async function getLinkTimingsSeek(link: string, seekTo: number): Promise<LinkTimings | null> {
    return getLinkTimings(link, { start: seekTo, end: seekTo + 2048 });
}

async function getRandomSeekPosition(linkInfo: LinkInformation): Promise<number> {
    try {
        const size = linkInfo.size ?? 1_000_000_000;
        if (size <= 1) return 0;
        return Math.floor(Math.random() * size);
    } catch {
        return 0;
    }
}

export async function SeekRandomMultipleTimes(linkInfo: LinkInformation, link: string, times: number): Promise<LinkTimings[]> {
    const results: LinkTimings[] = [];
    for (let i = 0; i < times; i++) {
        // pick random seek position within the file size if known, otherwise within 1GB
        const seekTo = await getRandomSeekPosition(linkInfo);
        const timings = await getLinkTimingsSeek(link, seekTo);
        if (timings) results.push(timings);
    }
    return results;
}

export interface DownloadResult {
    bytes: number;
    durationMs: number;
    avgBytesPerSecond: number;
    statusCode: number | null;
    connections: number;
    md5: string | null;
}

export interface DownloadProgress {
    bytes: number;
    totalBytes: number | null;
    bytesPerSecond: number;
}

const CONNECT_TIMEOUT_MS = 10_000;
const STALL_TIMEOUT_MS = 15_000;

async function downloadOnce(
    link: string,
    range: { start: number; end: number } | undefined,
    onBytes: (delta: number) => void,
    onChunk?: (chunk: Buffer) => void,
    signal?: AbortSignal,
): Promise<{ statusCode: number | null; bytes: number }> {
    const url = new URL(link);
    const isHttps = url.protocol === "https:";
    const port = Number(url.port) || (isHttps ? 443 : 80);

    if (signal?.aborted) throw new Error("download aborted");

    const { address } = await dns.lookup(url.hostname);
    const tcpSocket = await new Promise<net.Socket>((resolve, reject) => {
        const s = net.connect({ host: address, port });
        const timer = setTimeout(() => {
            s.destroy();
            reject(new Error(`TCP connect timed out after ${CONNECT_TIMEOUT_MS / 1000}s`));
        }, CONNECT_TIMEOUT_MS);
        s.once("connect", () => {
            clearTimeout(timer);
            resolve(s);
        });
        s.once("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });

    let socket: net.Socket | tls.TLSSocket = tcpSocket;
    if (isHttps) {
        socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
            const t = tls.connect({
                socket: tcpSocket,
                servername: url.hostname,
                ALPNProtocols: ["http/1.1"],
            });
            const timer = setTimeout(() => {
                t.destroy();
                reject(new Error(`TLS handshake timed out after ${CONNECT_TIMEOUT_MS / 1000}s`));
            }, CONNECT_TIMEOUT_MS);
            t.once("secureConnect", () => {
                clearTimeout(timer);
                resolve(t);
            });
            t.once("error", (err) => {
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    const headerLines = [
        `GET ${url.pathname + url.search} HTTP/1.1`,
        `Host: ${url.hostname}`,
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
        "Connection: close",
    ];
    if (range) headerLines.push(`Range: bytes=${range.start}-${range.end}`);
    headerLines.push("", "");

    await new Promise<void>((resolve, reject) => {
        socket.write(headerLines.join("\r\n"), (err) => (err ? reject(err) : resolve()));
    });

    return new Promise((resolve, reject) => {
        let statusCode: number | null = null;
        let headersDone = false;
        let headerBuf = Buffer.alloc(0);
        let bytes = 0;
        // Body size promised by the response; lets us finish without waiting
        // for a server close, and detect hangs via the stall watchdog.
        let expected: number | null = null;
        let settled = false;
        let stallTimer: ReturnType<typeof setTimeout> | undefined;

        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(stallTimer);
            signal?.removeEventListener("abort", onAbort);
            socket.destroy();
            fn();
        };
        const fail = (err: Error) => finish(() => reject(err));
        const onAbort = () => fail(new Error("download aborted"));
        const resetStall = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(
                () => fail(new Error(`stalled: no data received for ${STALL_TIMEOUT_MS / 1000}s`)),
                STALL_TIMEOUT_MS,
            );
        };
        const checkComplete = () => {
            if (expected !== null && bytes >= expected) {
                finish(() => resolve({ statusCode, bytes }));
            }
        };

        signal?.addEventListener("abort", onAbort);
        resetStall();

        const addBody = (chunk: Buffer) => {
            bytes += chunk.length;
            onBytes(chunk.length);
            onChunk?.(chunk);
            checkComplete();
        };

        socket.on("data", (chunk: Buffer) => {
            if (settled) return;
            resetStall();
            if (!headersDone) {
                headerBuf = Buffer.concat([headerBuf, chunk]);
                const eoh = headerBuf.indexOf("\r\n\r\n");
                if (eoh !== -1) {
                    const head = headerBuf.subarray(0, eoh).toString("latin1");
                    const statusLine = head.split("\r\n", 1)[0] ?? "";
                    const match = statusLine.match(/^HTTP\/1\.\d (\d+)/);
                    if (match) statusCode = Number(match[1]);
                    const clMatch = head.match(/^content-length:\s*(\d+)\s*$/im);
                    if (clMatch) {
                        expected = Number(clMatch[1]);
                    } else if (range && statusCode === 206) {
                        expected = range.end - range.start + 1;
                    }
                    headersDone = true;
                    const bodyStart = eoh + 4;
                    const bodyChunk = headerBuf.subarray(bodyStart);
                    headerBuf = Buffer.alloc(0);
                    if (bodyChunk.length > 0) addBody(bodyChunk);
                    else checkComplete();
                }
            } else {
                addBody(chunk);
            }
        });

        socket.once("end", () => finish(() => resolve({ statusCode, bytes })));
        socket.once("error", (err) => fail(err));
    });
}

export async function downloadFull(
    link: string,
    options: {
        connections?: number;
        size?: number;
        onProgress?: (state: DownloadProgress) => void;
        onError?: (message: string) => void;
    } = {},
): Promise<DownloadResult | null> {
    const connections = Math.max(1, options.connections ?? 1);
    const useMulti = connections > 1 && !!options.size && options.size > 0;
    const totalBytes = options.size ?? null;
    const start = performance.now();
    let bytes = 0;
    const samples: Array<[number, number]> = [[start, 0]];

    const onBytes = (delta: number) => {
        bytes += delta;
        const now = performance.now();
        samples.push([now, bytes]);
        const cutoff = now - 1000;
        while (samples.length > 2 && samples[1]![0] < cutoff) samples.shift();
        const oldest = samples[0]!;
        const newest = samples[samples.length - 1]!;
        const dt = newest[0] - oldest[0];
        const db = newest[1] - oldest[1];
        const bytesPerSecond = dt > 0 ? (db / dt) * 1000 : 0;
        options.onProgress?.({ bytes, totalBytes, bytesPerSecond });
    };

    let statusCode: number | null = null;
    let md5: string | null = null;
    let end = start;

    try {
        if (useMulti) {
            const size = options.size!;
            const ranges: Array<{ start: number; end: number }> = [];
            for (let i = 0; i < connections; i++) {
                const s = Math.floor((size * i) / connections);
                const e = Math.floor((size * (i + 1)) / connections) - 1;
                ranges.push({ start: s, end: e });
            }
            // Spool each range to its real offset in a temp file, then hash the
            // file sequentially so the MD5 is the actual file hash, comparable
            // to the single-connection value.
            const tmpPath = join(tmpdir(), `video-link-debugger-${crypto.randomUUID()}`);
            const file = await open(tmpPath, "w+");
            try {
                const positions = ranges.map((r) => r.start);
                const writeChains: Promise<void>[] = ranges.map(() => Promise.resolve());
                let writeError: unknown = null;
                // On the first failure abort the sibling connections so one
                // stalled range fails the download instead of hanging it.
                const controller = new AbortController();
                let rootError: unknown = null;
                const settled = await Promise.allSettled(
                    ranges.map((r, i) =>
                        downloadOnce(
                            link,
                            r,
                            onBytes,
                            (chunk) => {
                                const pos = positions[i]!;
                                positions[i] = pos + chunk.length;
                                writeChains[i] = writeChains[i]!
                                    .then(() => file.write(chunk, 0, chunk.length, pos))
                                    .then(() => {}, (err) => { writeError ??= err; });
                            },
                            controller.signal,
                        ).catch((err) => {
                            rootError ??= err;
                            controller.abort();
                            throw err;
                        }),
                    ),
                );
                await Promise.all(writeChains);
                if (rootError) throw rootError;
                if (writeError) throw writeError;
                const results = settled.map(
                    (s) =>
                        (s as PromiseFulfilledResult<{ statusCode: number | null; bytes: number }>)
                            .value,
                );
                statusCode = results[0]?.statusCode ?? null;
                end = performance.now();

                const hasher = createHash("md5");
                const buf = Buffer.alloc(8 * 1024 * 1024);
                let readPos = 0;
                while (true) {
                    const { bytesRead } = await file.read(buf, 0, buf.length, readPos);
                    if (bytesRead === 0) break;
                    hasher.update(buf.subarray(0, bytesRead));
                    readPos += bytesRead;
                }
                md5 = hasher.digest("hex");
            } finally {
                await file.close();
                await unlink(tmpPath).catch(() => {});
            }
        } else {
            const hasher = createHash("md5");
            const result = await downloadOnce(link, undefined, onBytes, (chunk) =>
                hasher.update(chunk),
            );
            statusCode = result.statusCode;
            md5 = hasher.digest("hex");
            end = performance.now();
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (options.onError) options.onError(message);
        else console.error(`Download error: ${message}`);
        return null;
    }

    const durationMs = end - start;
    return {
        bytes,
        durationMs,
        avgBytesPerSecond: durationMs > 0 ? bytes / (durationMs / 1000) : 0,
        statusCode,
        connections: useMulti ? connections : 1,
        md5,
    };
}