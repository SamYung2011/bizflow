import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// All renderer resources are bundled locally and fetched only when a PDF needs
// them (including CJK character maps and scanned-document image decoders).
const assets = import.meta.glob('/node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}/*', {
  query: '?url', import: 'default', eager: true,
});
const folders = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' };
class LocalPdfData {
  async fetch({ kind, filename }) {
    const url = assets[`/node_modules/pdfjs-dist/${folders[kind]}/${filename}`];
    if (!url) throw new Error('Missing PDF resource');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Unable to load PDF resource');
    return new Uint8Array(await response.arrayBuffer());
  }
}
GlobalWorkerOptions.workerSrc = workerUrl;

export async function renderFirstPage(blob, canvas, signal) {
  const data = new Uint8Array(await blob.arrayBuffer());
  if (signal.aborted) return;
  const task = getDocument({ data, BinaryDataFactory: LocalPdfData, useWorkerFetch: false, isEvalSupported: false });
  let render;
  const cancel = () => { render?.cancel(); void task.destroy(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    if (signal.aborted) return;
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1080 / natural.width, 1440 / natural.height) });
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    render = page.render({ canvasContext: canvas.getContext('2d'), viewport });
    await render.promise;
  } finally {
    signal.removeEventListener('abort', cancel);
    await task.destroy();
  }
}
