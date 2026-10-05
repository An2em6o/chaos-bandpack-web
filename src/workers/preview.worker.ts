import { decodePreview, encodePreview, imageDataPreview } from "../lib/pack/previewFactory";
self.onmessage = (event: MessageEvent) => {
  try {
    const { type, indices, palette, width, height, image } = event.data;
    if (type === "image") {
      const out = imageDataPreview(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height));
      self.postMessage({ ok: true, data: out }, [out.buffer]);
      return;
    }
    if (type === "encode") {
      const out = encodePreview(new Uint8Array(indices), new Uint8Array(palette), width, height);
      self.postMessage({ ok: true, data: out }, [out.buffer]);
    } else if (type === "decode") {
      const out = decodePreview(new Uint8Array(indices));
      self.postMessage({ ok: true, ...out }, [out.palette.buffer, out.indices.buffer]);
    }
  } catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
