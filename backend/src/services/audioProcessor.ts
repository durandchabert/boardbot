import { spawn } from 'child_process';
import { createWriteStream, unlink } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { v4 as uuid } from 'uuid';

let FFMPEG_BIN: string = 'ffmpeg';
try {
  // @ts-expect-error - ffmpeg-static ships no type declarations
  const mod = await import('ffmpeg-static');
  const staticPath = (mod.default ?? mod) as unknown as string | null;
  if (staticPath) FFMPEG_BIN = staticPath;
} catch {
  // keep fallback
}

export interface PreprocessOptions {
  denoise?: boolean;
  sampleRate?: number;
  onProgress?: (percent: number) => void;
}

export interface PreprocessResult {
  outputPath: string;
  durationSec: number;
}

// Probe the source file duration by asking ffmpeg to decode it to null.
// We parse the "Duration: HH:MM:SS.xx" line from stderr. This is a ~200ms
// pass even for multi-hour files because we request format-level info only.
function probeDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      FFMPEG_BIN,
      ['-hide_banner', '-i', inputPath, '-f', 'null', '-'],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    child.on('error', reject);
    child.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return resolve(0);
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
  });
}

export async function preprocessAudio(
  inputPath: string,
  opts: PreprocessOptions = {}
): Promise<PreprocessResult> {
  const denoise = opts.denoise ?? true;
  const sampleRate = opts.sampleRate ?? 16000;
  const onProgress = opts.onProgress;
  const outputPath = join(tmpdir(), `boardbot-${uuid()}.wav`);

  // Kick off the duration probe, but don't block the encode on it — we can
  // encode without knowing the total and just not emit percentages.
  const durationSec = await probeDuration(inputPath).catch(() => 0);

  const filters: string[] = [];
  if (denoise) {
    filters.push('highpass=f=80');
    filters.push('afftdn=nr=20:nf=-25');
    filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  }

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    '-progress', 'pipe:1',
    '-i', inputPath,
    '-vn',
    '-ac', '1',
    '-ar', String(sampleRate),
    '-c:a', 'pcm_s16le',
  ];
  if (filters.length > 0) args.push('-af', filters.join(','));
  args.push(outputPath);

  return new Promise<PreprocessResult>((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let buffer = '';

    child.stdout.on('data', (c: Buffer) => {
      // Each progress chunk is a series of key=value lines terminated by
      // "progress=continue" (or "progress=end" at the very end).
      buffer += c.toString('utf8');
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('out_time_us=') && !line.startsWith('out_time_ms=')) continue;
        const val = Number(line.split('=')[1]);
        if (!Number.isFinite(val) || durationSec <= 0) continue;
        // out_time_us is actually microseconds in recent ffmpeg; out_time_ms is
        // also microseconds in some builds (naming is confusing). Both give a
        // value in µs on the ffmpeg-static binaries we ship.
        const currentSec = val / 1_000_000;
        const pct = Math.max(0, Math.min(100, (currentSec / durationSec) * 100));
        onProgress?.(pct);
      }
    });

    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        onProgress?.(100);
        resolve({ outputPath, durationSec });
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(0, 400)}`));
      }
    });
  });
}

export function cleanupFile(path: string): void {
  unlink(path, () => { /* noop */ });
}

export function writeBufferToTmp(buffer: Buffer, extension: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const safeExt = extension.replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'bin';
    const path = join(tmpdir(), `boardbot-in-${uuid()}.${safeExt}`);
    const stream = createWriteStream(path);
    stream.on('error', reject);
    stream.on('finish', () => resolve(path));
    stream.end(buffer);
  });
}
