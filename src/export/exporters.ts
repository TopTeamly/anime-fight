import type { Engine } from '../scene/engine.js';
import { audioBufferToWav } from '../audio/director.js';
import { download } from '../ui/dom.js';

/** Everything here is a real, working export path. Limits (browser codec support, speech not recorded offline) are documented in the README. */

export function snapshotPNG(engine: Engine, name = 'frame.png') {
  engine.renderFrame();
  return new Promise<void>((res) => engine.renderer.canvas.toBlob((b) => { if (b) download(name, b); res(); }, 'image/png'));
}

/** Real-time capture of the canvas + synthesised audio into a WebM file (MediaRecorder). */
export async function recordWebM(engine: Engine, onState: (s: string) => void): Promise<void> {
  const canvas = engine.renderer.canvas;
  if (!('MediaRecorder' in window)) { onState('MediaRecorder is not available in this browser.'); return; }
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) { onState('No WebM codec available.'); return; }
  engine.seek(0);
  await engine.play();
  const vs = (canvas as any).captureStream(30) as MediaStream;
  const as = engine.audio.recordingStream();
  const stream = new MediaStream([...vs.getVideoTracks(), ...(as ? as.getAudioTracks() : [])]);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((res) => { rec.onstop = () => res(); });
  const prevEnd = engine.onEnd;
  engine.onEnd = () => { prevEnd?.(); rec.stop(); };
  rec.start(500);
  onState('Recording in real time... (the scene plays once, then the file downloads)');
  await done;
  engine.onEnd = prevEnd;
  download('anime-fight.webm', new Blob(chunks, { type: 'video/webm' }));
  onState('Saved anime-fight.webm');
}

/** Deterministic offline frame export: steps the scene through the time warp at a fixed fps and writes PNGs to a folder. */
export async function exportFrames(engine: Engine, fps: number, width: number, onState: (s: string, frac?: number) => void): Promise<void> {
  const picker = (window as any).showDirectoryPicker;
  if (!picker) { onState('Frame export needs the File System Access API (Chrome / Edge).'); return; }
  const dir = await picker.call(window);
  engine.pause();
  const R = engine.renderer, canvas = R.canvas;
  const oldScale = R.quality.scale, ow = canvas.width, oh = canvas.height;
  const height = Math.round((width * 9) / 16);
  R.quality.scale = 1; R.resize(width, height, true);
  const total = Math.floor(engine.warp.realDuration * fps);
  for (let i = 0; i <= total; i++) {
    const real = i / fps, tau = engine.warp.contentOf(real);
    engine.renderFrame(Math.min(tau, engine.duration));
    const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    const fh = await dir.getFileHandle(`frame_${String(i).padStart(6, '0')}.png`, { create: true });
    const w = await fh.createWritable(); await w.write(blob); await w.close();
    if (i % 10 === 0) onState(`Rendering frame ${i} / ${total}`, i / total);
  }
  R.quality.scale = oldScale; R.resize(ow / oldScale, oh / oldScale, true);
  onState(`Done: ${total + 1} PNG frames. Assemble with:  ffmpeg -framerate ${fps} -i frame_%06d.png -i audio.wav -c:v libx264 -pix_fmt yuv420p out.mp4`, 1);
}

/** offline audio render (OfflineAudioContext) -> WAV. Browser speech synthesis cannot be captured, so voice lines are not part of it. */
export async function exportWAV(engine: Engine, onState: (s: string) => void) {
  onState('Rendering audio offline...');
  const buf = await engine.audio.renderOffline(engine.warp.realDuration + 1.5);
  download('anime-fight-audio.wav', audioBufferToWav(buf));
  onState('Saved anime-fight-audio.wav (synthesised SFX + music; speech not included)');
}

export function saveTimeline(engine: Engine) {
  const json = engine.timeline.toJSON();
  download(`${engine.timeline.data.name.replace(/\W+/g, '-').toLowerCase()}.afe.json`, json, 'application/json');
  try { localStorage.setItem('afe.timeline', json); } catch { /* storage may be unavailable */ }
}
export function loadLocal(): string | null { try { return localStorage.getItem('afe.timeline'); } catch { return null; } }
export function exportModels(engine: Engine) {
  download('sael.obj', engine.A.bodyMB.toOBJ('Sael'), 'text/plain');
  download('korran.obj', engine.B.bodyMB.toOBJ('Korran'), 'text/plain');
}
