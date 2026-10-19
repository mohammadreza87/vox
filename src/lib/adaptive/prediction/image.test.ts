import { describe, expect, it, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import { MAX_IMAGE_BYTES, minimizeImageDataUrl, sharedImageForModel } from './image';
import { prepareSharedImage } from './image-browser';
function crc32(bytes: Uint8Array) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c >>> 1 ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
export function png(width = 1, metadata = false): string {
  const chunk = (type: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([length, body, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    ...(metadata ? [chunk('tEXt', Buffer.from('PRIVATE_LOCATION_CANARY'))] : []), chunk('IDAT', deflateSync(Buffer.from([0,255,0,0,255]))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
function jpeg(metadataAfterScan = false): string {
  const header = [255,216,255,225,0,9,...Buffer.from('CANARY!'),255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0];
  return 'data:image/jpeg;base64,' + Buffer.from([...header,1,2,3,...(metadataAfterScan ? [255,225,0,9,...Buffer.from('CANARY!')] : []),255,217]).toString('base64');
}
describe('minimized explicitly shared raster', () => {
  it('strips PNG ancillary text metadata and preserves pixels', () => {
    const result = minimizeImageDataUrl(png(1, true));
    expect(result).toBe(png()); expect(atob(result.split(',')[1])).not.toContain('PRIVATE_LOCATION_CANARY');
    expect(sharedImageForModel(result)).toEqual({ mimeType: 'image/png', data: result.split(',')[1] });
  });
  it('strips baseline JPEG APP metadata; rejects interscan/trailing metadata', () => {
    expect(atob(minimizeImageDataUrl(jpeg()).split(',')[1])).not.toContain('CANARY!');
    expect(() => minimizeImageDataUrl(jpeg(true))).toThrow();
  });
  it.each(['https://example.org/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/gif;base64,R0lGODlh', png(513), 'data:image/png;base64,' + 'A'.repeat(MAX_IMAGE_BYTES * 2)])('rejects URL/unsupported/oversized input %#', value => {
    expect(() => minimizeImageDataUrl(value)).toThrow();
  });
  it('rejects corrupt CRC and PNG animation', () => {
    const bytes = Buffer.from(png().split(',')[1], 'base64'); bytes[29] ^= 1;
    expect(() => minimizeImageDataUrl('data:image/png;base64,' + bytes.toString('base64'))).toThrow();
  });
  it('resizes/re-encodes browser input, and closes the bitmap on cancellation', async () => {
    const close = vi.fn(), drawImage = vi.fn(), canvas = { width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage }), toDataURL: () => jpeg() };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2048, height: 1024, close })));
    const create = vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    try {
      expect(await prepareSharedImage(new Blob(['source'], { type: 'image/jpeg' }))).toBe(jpeg());
      expect(canvas.width).toBe(512); expect(canvas.height).toBe(256); expect(close).toHaveBeenCalledOnce();
      const controller = new AbortController(); controller.abort();
      await expect(prepareSharedImage(new Blob([], { type: 'image/png' }), controller.signal)).rejects.toThrow('cancelled');
    } finally { create.mockRestore(); vi.unstubAllGlobals(); }
  });
});
