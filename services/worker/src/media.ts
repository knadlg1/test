import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// 영상 길이 제한 초기값. 파일럿에서 조정한다. 파일 크기는 제한하지 않는다.
export const MAX_VIDEO_SECONDS = 180;

export class MediaRejected extends Error {}

export async function probeDuration(input: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    input,
  ]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds)) throw new MediaRejected("읽을 수 없는 영상입니다");
  return seconds;
}

// 720p / H.264 / 약 2Mbps. 폰에서 찍은 세로 영상도 짧은 변을 720으로 맞춘다.
export async function compressVideo(
  input: string,
  output: string,
  thumb: string,
): Promise<{ durationSec: number }> {
  const durationSec = await probeDuration(input);
  if (durationSec > MAX_VIDEO_SECONDS) {
    throw new MediaRejected(`영상은 ${MAX_VIDEO_SECONDS}초까지 보낼 수 있어요`);
  }
  await run("ffmpeg", [
    "-y", "-i", input,
    "-vf", "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)'",
    "-c:v", "libx264", "-crf", "26", "-maxrate", "2M", "-bufsize", "4M",
    "-preset", "medium", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+faststart",
    output,
  ]);
  await run("ffmpeg", [
    "-y", "-ss", String(Math.min(1, durationSec / 2)), "-i", output,
    "-frames:v", "1", "-vf", "scale=320:-2", thumb,
  ]);
  return { durationSec };
}

// 긴 변 1920px 이하 JPEG. 회전 정보(EXIF)는 ffmpeg가 적용한다.
export async function compressPhoto(
  input: string,
  output: string,
  thumb: string,
): Promise<void> {
  await run("ffmpeg", [
    "-y", "-i", input,
    "-vf", "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'",
    "-q:v", "4", "-frames:v", "1",
    output,
  ]);
  await run("ffmpeg", [
    "-y", "-i", output,
    "-vf", "scale=320:-2", "-q:v", "6", "-frames:v", "1",
    thumb,
  ]);
}
