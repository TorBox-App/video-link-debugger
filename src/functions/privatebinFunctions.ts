import { PrivatebinClient, PrivatebinOptions } from '@pixelfactory/privatebin';
import bs58 from 'bs58';
const urlPrivatebin = 'https://privatebin.net'
const privatebin = new PrivatebinClient(urlPrivatebin);

async function convertResultsToText(results: Object) {
    return JSON.stringify(results, null, 2);
}

// PrivateBin rate-limits pastes (default: one per 10 s per IP), so back-to-back
// uploads need a wait-and-retry.
const RETRY_DELAY_MS = 11_000;
const MAX_ATTEMPTS = 3;

export async function sendResultsToPrivatebin(data: Object): Promise<string> {
    const results = await convertResultsToText(data);
    const opts: PrivatebinOptions = {
        textformat: 'plaintext',
        expire: '1week',
        burnafterreading: 0,
        opendiscussion: 0,
        output: 'text',
        compression: 'zlib',
    };
    const key = crypto.getRandomValues(new Uint8Array(32));
    let lastMessage = 'unknown error';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const paste = await privatebin.sendText(results, key, opts);
        if (paste.status === 0 && paste.url) {
            return urlPrivatebin + paste.url + '#' + bs58.encode(key);
        }
        lastMessage = (paste as { message?: string }).message ?? `status ${paste.status}`;
        if (attempt < MAX_ATTEMPTS) {
            console.error(`PrivateBin upload rejected (${lastMessage}), retrying in ${RETRY_DELAY_MS / 1000}s...`);
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
    }
    throw new Error(lastMessage);
}