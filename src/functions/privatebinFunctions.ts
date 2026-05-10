import { PrivatebinClient, PrivatebinOptions } from '@pixelfactory/privatebin';
import bs58 from 'bs58';
const urlPrivatebin = 'https://privatebin.net'
const privatebin = new PrivatebinClient(urlPrivatebin);

async function convertResultsToText(results: Object) {
    return JSON.stringify(results, null, 2);
}

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
    const paste = await privatebin.sendText(results, key, opts);
    const url = urlPrivatebin + paste.url + '#' + bs58.encode(key);
    return url;
}