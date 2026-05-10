import { headers } from "../library/http";

export type LinkInformation = {
    status: number;
    contentType: string | null;
    size: number | null;
    acceptsRanges: boolean;
    fileName: string | null;
    isVideo: boolean;
    domain: string;
    error?: string;
}

async function isVideoLink(headers: Headers): Promise<boolean> {
    const contentType = headers.get("Content-Type");
    return contentType ? contentType.startsWith("video/") : false;
}

async function getLinkName(headers: Headers, link: string): Promise<string> {
    const contentDisposition = headers.get("Content-Disposition");
    if (contentDisposition) {
        const fromHeader = parseFilenameFromContentDisposition(contentDisposition);
        if (fromHeader) return fromHeader;
    }
    return filenameFromUrl(link);
}

// RFC 6266 / RFC 5987. Prefers `filename*` (with charset) over `filename`,
// supports quoted-string with escapes, and bare tokens.
function parseFilenameFromContentDisposition(header: string): string | null {
    const ext = header.match(/;\s*filename\*\s*=\s*([^'";]*)'([^'";]*)'([^;]+)/i);
    if (ext) {
        const charset = (ext[1] || "utf-8").trim().toLowerCase();
        const value = ext[3].trim().replace(/^"|"$/g, "");
        const decoded = decodePercentEncoded(value, charset);
        if (decoded) return sanitizeFilename(decoded);
    }

    const quoted = header.match(/;\s*filename\s*=\s*"((?:[^"\\]|\\.)*)"/i);
    if (quoted) {
        return sanitizeFilename(quoted[1].replace(/\\(.)/g, "$1"));
    }

    const token = header.match(/;\s*filename\s*=\s*([^;\s]+)/i);
    if (token) {
        return sanitizeFilename(token[1]);
    }

    return null;
}

function decodePercentEncoded(value: string, charset: string): string | null {
    try {
        if (charset === "utf-8" || charset === "") {
            return decodeURIComponent(value);
        }
        const bytes = new Uint8Array(
            value.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
                .split("")
                .map(c => c.charCodeAt(0))
        );
        return new TextDecoder(charset).decode(bytes);
    } catch {
        return null;
    }
}

function filenameFromUrl(link: string): string {
    try {
        const { pathname } = new URL(link);
        const last = pathname.split("/").filter(Boolean).pop();
        if (!last) return "unknown";
        try {
            return sanitizeFilename(decodeURIComponent(last));
        } catch {
            return sanitizeFilename(last);
        }
    } catch {
        return "unknown";
    }
}

function sanitizeFilename(name: string): string {
    // Strip any path components a malformed header might smuggle in.
    return name.replace(/[\\/]/g, "_").trim() || "unknown";
}

async function linkAcceptsRanges(headers: Headers): Promise<boolean> {
    return headers.get("Accept-Ranges") === "bytes";
}

async function linkSize(headers: Headers): Promise<number | null> {
    const contentLength = headers.get("Content-Length");
    return contentLength ? parseInt(contentLength) : null;
}

export async function getLinkInformation(link: string): Promise<LinkInformation> {
    try {
        const response = await fetch(link, {
            method: "HEAD",
            headers
        })
        if (!response.ok) {
            return {
                status: response.status,
                contentType: null,
                size: null,
                acceptsRanges: false,
                fileName: null,
                domain: new URL(link).hostname,
                isVideo: false,
                error: `Failed to fetch link information: ${response.statusText} | ${response.status}`
            };
        }

        const data: LinkInformation = {
            status: response.status,
            contentType: response.headers.get("Content-Type"),
            size: await linkSize(response.headers),
            acceptsRanges: await linkAcceptsRanges(response.headers),
            fileName: await getLinkName(response.headers, link),
            domain: new URL(link).hostname,
            isVideo: await isVideoLink(response.headers)
        }
        return data;
    } catch (error) {
        return {
            status: 0,
            contentType: null,
            size: null,
            acceptsRanges: false,
            fileName: null,
            isVideo: false,
            domain: (() => {
                try {
                    return new URL(link).hostname;
                } catch {
                    return "unknown";
                }
            })(),
            error: (error as Error).message
        };
    }

}