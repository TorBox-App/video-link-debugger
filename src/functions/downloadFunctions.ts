import * as dns from "node:dns/promises";
import * as net from "node:net";
import * as tls from "node:tls";
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
}

export interface DownloadProgress {
    bytes: number;
    totalBytes: number | null;
    bytesPerSecond: number;
}

async function downloadOnce(
    link: string,
    range: { start: number; end: number } | undefined,
    onBytes: (delta: number) => void,
): Promise<{ statusCode: number | null; bytes: number }> {
    const url = new URL(link);
    const isHttps = url.protocol === "https:";
    const port = Number(url.port) || (isHttps ? 443 : 80);

    const { address } = await dns.lookup(url.hostname);
    const tcpSocket = await new Promise<net.Socket>((resolve, reject) => {
        const s = net.connect({ host: address, port });
        s.once("connect", () => resolve(s));
        s.once("error", reject);
    });

    let socket: net.Socket | tls.TLSSocket = tcpSocket;
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

        socket.on("data", (chunk: Buffer) => {
            if (!headersDone) {
                headerBuf = Buffer.concat([headerBuf, chunk]);
                const eoh = headerBuf.indexOf("\r\n\r\n");
                if (eoh !== -1) {
                    const head = headerBuf.subarray(0, eoh).toString("latin1");
                    const statusLine = head.split("\r\n", 1)[0] ?? "";
                    const match = statusLine.match(/^HTTP\/1\.\d (\d+)/);
                    if (match) statusCode = Number(match[1]);
                    headersDone = true;
                    const bodyStart = eoh + 4;
                    if (bodyStart < headerBuf.length) {
                        const bodyChunk = headerBuf.subarray(bodyStart);
                        bytes += bodyChunk.length;
                        onBytes(bodyChunk.length);
                    }
                    headerBuf = Buffer.alloc(0);
                }
            } else {
                bytes += chunk.length;
                onBytes(chunk.length);
            }
        });

        socket.once("end", () => resolve({ statusCode, bytes }));
        socket.once("error", reject);
    });
}

export async function downloadFull(
    link: string,
    options: {
        connections?: number;
        size?: number;
        onProgress?: (state: DownloadProgress) => void;
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

    try {
        if (useMulti) {
            const size = options.size!;
            const ranges: Array<{ start: number; end: number }> = [];
            for (let i = 0; i < connections; i++) {
                const s = Math.floor((size * i) / connections);
                const e = Math.floor((size * (i + 1)) / connections) - 1;
                ranges.push({ start: s, end: e });
            }
            const results = await Promise.all(
                ranges.map((r) => downloadOnce(link, r, onBytes)),
            );
            statusCode = results[0]?.statusCode ?? null;
        } else {
            const result = await downloadOnce(link, undefined, onBytes);
            statusCode = result.statusCode;
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Download error: ${message}`);
        return null;
    }

    const durationMs = performance.now() - start;
    return {
        bytes,
        durationMs,
        avgBytesPerSecond: durationMs > 0 ? bytes / (durationMs / 1000) : 0,
        statusCode,
        connections: useMulti ? connections : 1,
    };
}