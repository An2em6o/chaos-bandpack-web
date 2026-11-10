import { compileIconSources, type IconSource } from '../lib/icon/iconAssets';

self.onmessage = async (event: MessageEvent<{ sources: IconSource[] }>) => {
  try {
    const compiled = await compileIconSources(event.data.sources, async source => {
      const bitmap = await createImageBitmap(new Blob([source.data.slice().buffer], { type: 'image/png' }));
      try {
        if (Math.max(bitmap.width, bitmap.height) > 4096) throw new Error('PNG 画布不能超过 4096 像素');
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const pixels = new Uint32Array(bitmap.width * bitmap.height);
        for (let i = 0; i < pixels.length; i++) pixels[i] = (rgba[i * 4 + 3] << 24 | rgba[i * 4] << 16 | rgba[i * 4 + 1] << 8 | rgba[i * 4 + 2]) >>> 0;
        return { width: bitmap.width, height: bitmap.height, pixels };
      } finally { bitmap.close(); }
    });
    self.postMessage({ ok: true, compiled });
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
