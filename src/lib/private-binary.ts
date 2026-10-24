import { createHash } from 'node:crypto';

// Validate and finish generating the file before starting the response, then
// stream bounded chunks so larger images/packs do not use a buffered response.
export function privateBinary(data: Uint8Array, headers: Record<string, string>) {
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (offset >= data.length) {controller.close();return;}
            const end = Math.min(offset + 64 * 1024, data.length);
            controller.enqueue(data.subarray(offset, end));
            offset = end;
        },
    });
    return new Response(stream, {headers:{...headers, 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff',
        'X-Download-Bytes':String(data.length), 'X-Download-SHA256':createHash('sha256').update(data).digest('hex')}});
}
