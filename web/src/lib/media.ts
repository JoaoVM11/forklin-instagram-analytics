// Processamento de mídia no navegador: redimensiona imagens, extrai quadros e áudio de vídeos.
// Assim só imagens leves (e um WAV pequeno) vão para o servidor.

const MAX_SIDE = 1280;

function canvasToDataURL(c: HTMLCanvasElement, q = 0.85) { return c.toDataURL("image/jpeg", q); }

function drawScaled(src: CanvasImageSource, w: number, h: number, max = MAX_SIDE) {
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export async function imageToDataURL(file: File, max = MAX_SIDE) {
  const bmp = await createImageBitmap(file);
  return canvasToDataURL(drawScaled(bmp, bmp.width, bmp.height, max));
}

export async function thumbFrom(dataUrl: string) {
  const img = new Image(); img.src = dataUrl; await img.decode();
  return canvasToDataURL(drawScaled(img, img.naturalWidth, img.naturalHeight, 320), 0.7);
}

// Junta várias imagens numa grade (o modelo aceita no máximo 3 imagens por análise)
export async function contactSheet(dataUrls: string[], cols = 3, cell = 420) {
  const imgs = await Promise.all(dataUrls.map(async (u) => { const i = new Image(); i.src = u; await i.decode(); return i; }));
  const rows = Math.ceil(imgs.length / cols);
  const ratio = imgs[0] ? imgs[0].naturalHeight / imgs[0].naturalWidth : 1;
  const ch = Math.round(cell * Math.min(Math.max(ratio, 0.5), 1.8));
  const gap = 8, label = 26;
  const c = document.createElement("canvas");
  c.width = cols * cell + (cols + 1) * gap; c.height = rows * (ch + label) + (rows + 1) * gap;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0A1433"; ctx.fillRect(0, 0, c.width, c.height);
  imgs.forEach((im, i) => {
    const x = gap + (i % cols) * (cell + gap), y = gap + Math.floor(i / cols) * (ch + label + gap);
    const s = Math.min(cell / im.naturalWidth, ch / im.naturalHeight);
    const w = im.naturalWidth * s, h = im.naturalHeight * s;
    ctx.fillStyle = "#1a2547"; ctx.fillRect(x, y + label, cell, ch);
    ctx.drawImage(im, x + (cell - w) / 2, y + label + (ch - h) / 2, w, h);
    ctx.fillStyle = "#fff"; ctx.font = "bold 18px Arial"; ctx.fillText(`${i + 1}`, x + 4, y + 19);
  });
  return canvasToDataURL(drawScaled(c, c.width, c.height, 1600), 0.82);
}

function loadVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "auto"; v.muted = true; v.playsInline = true;
    v.src = URL.createObjectURL(file);
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error("Não foi possível ler este vídeo no navegador. Tente MP4 (H.264)."));
  });
}
function seek(v: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => { v.onseeked = () => resolve(); v.currentTime = Math.min(Math.max(t, 0), Math.max(v.duration - 0.05, 0)); });
}

export type VideoParts = { hook: string; sheet: string; frames: string[]; duration: number; thumb: string };

export async function extractVideoFrames(file: File, count = 8): Promise<VideoParts> {
  const v = await loadVideo(file);
  const d = v.duration || 1;
  await seek(v, Math.min(0.6, d / 10));
  const hook = canvasToDataURL(drawScaled(v, v.videoWidth, v.videoHeight, 1024));
  const frames: string[] = [];
  for (let i = 1; i <= count; i++) {
    await seek(v, (d * i) / (count + 1));
    frames.push(canvasToDataURL(drawScaled(v, v.videoWidth, v.videoHeight, 480), 0.8));
  }
  URL.revokeObjectURL(v.src);
  const sheet = await contactSheet(frames, 4, 360);
  return { hook, sheet, frames, duration: d, thumb: await thumbFrom(hook) };
}

// Áudio do vídeo -> WAV 16 kHz mono (formato ideal para o Whisper e bem leve: ~32 KB/s)
export async function extractAudioWav(file: File, maxSeconds = 180): Promise<string | null> {
  const buf = await file.arrayBuffer();
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try { decoded = await ctx.decodeAudioData(buf); } catch { await ctx.close(); return null; } // vídeo sem áudio
  await ctx.close();
  const secs = Math.min(decoded.duration, maxSeconds);
  const off = new OfflineAudioContext(1, Math.ceil(secs * 16000), 16000);
  const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start(0);
  const rendered = await off.startRendering();
  const pcm = rendered.getChannelData(0);
  let peak = 0; for (let i = 0; i < pcm.length; i += 64) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 0.01) return null; // silêncio
  const wav = new ArrayBuffer(44 + pcm.length * 2); const dv = new DataView(wav);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true);
  dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  const bytes = new Uint8Array(wav); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
