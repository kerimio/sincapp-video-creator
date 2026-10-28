import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { ffmpegBin } from './render';

export interface VideoCheck {
  file: string;
  ok: boolean;
  problems: string[];
  info: { width: number; height: number; fps: number; codec: string; pixFmt: string; duration: number; sizeMB: number };
}

function capture(cmd: string, args: string[]): Promise<{ out: string; err: string }> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', fail);
    p.on('close', () => ok({ out, err }));
  });
}

const ffprobeBin = () => process.env.FFPROBE_PATH || ffmpegBin().replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

/** Prüft die Instagram-Kriterien aus der Spezifikation. */
export async function verifyVideo(file: string, expectedDuration: number, size = { w: 1080, h: 1920 }): Promise<VideoCheck> {
  const { out } = await capture(ffprobeBin(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,codec_name,pix_fmt:format=duration', '-of', 'json', file]);
  const j = JSON.parse(out);
  const s = j.streams[0];
  const [n, d] = String(s.r_frame_rate).split('/').map(Number);
  const info = {
    width: s.width,
    height: s.height,
    fps: n / (d || 1),
    codec: s.codec_name,
    pixFmt: s.pix_fmt,
    duration: Number(j.format.duration),
    sizeMB: (await stat(file)).size / 1024 / 1024,
  };
  const problems: string[] = [];
  if (info.width !== size.w || info.height !== size.h) problems.push(`Auflösung ${info.width}×${info.height} statt ${size.w}×${size.h}`);
  if (Math.abs(info.fps - 30) > 0.01) problems.push(`${info.fps} fps statt 30`);
  if (info.codec !== 'h264') problems.push(`Codec ${info.codec} statt H.264`);
  if (info.pixFmt !== 'yuv420p') problems.push(`Pixelformat ${info.pixFmt} statt yuv420p`);
  if (info.sizeMB > 15) problems.push(`${info.sizeMB.toFixed(1)} MB (max. 15 MB)`);
  if (Math.abs(info.duration - expectedDuration) > 0.1) problems.push(`Dauer ${info.duration.toFixed(2)} s statt ${expectedDuration.toFixed(2)} s`);
  // Schwarze Frames finden
  const { err } = await capture(ffmpegBin(), ['-v', 'info', '-i', file, '-vf', 'blackdetect=d=0.03:pix_th=0.10', '-an', '-f', 'null', '-']);
  const black = err.match(/black_start:\S+ black_end:\S+/g);
  if (black) problems.push(`Schwarze Frames: ${black.join(', ')}`);
  return { file, ok: problems.length === 0, problems, info };
}
