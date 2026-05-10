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