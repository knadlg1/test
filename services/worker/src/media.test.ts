import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compressPhoto, compressVideo, MediaRejected } from "./media.ts";

const dir = mkdtempSync(join(tmpdir(), "mamapapa-"));

function ffmpeg(...args: string[]) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
}
function size(path: string) {
  return statSync(path).size;
}
function videoSize(path: string) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,codec_name",
    "-of", "csv=p=0", path,
  ]).toString().trim();
  const [codec, w, h] = out.split(",");
  return { codec, width: Number(w), height: Number(h) };
}

test("1080p 영상은 720p H.264로 줄어든다", async () => {
  const src = join(dir, "src.mp4");
  ffmpeg("-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-t", "4",
    "-c:v", "libx264", "-b:v", "20M", src);
  const out = join(dir, "out.mp4");
  const { durationSec } = await compressVideo(src, out, join(dir, "v.jpg"));
  const v = videoSize(out);
  assert.equal(v.codec, "h264");
  assert.equal(v.height, 720);
  assert.ok(durationSec > 3.5 && durationSec < 4.5);
  assert.ok(size(out) < size(src) / 3);
});

test("세로 영상은 짧은 변(가로)을 720으로 맞춘다", async () => {
  const src = join(dir, "portrait.mp4");
  ffmpeg("-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30", "-t", "2",
    "-c:v", "libx264", src);
  const out = join(dir, "portrait-out.mp4");
  await compressVideo(src, out, join(dir, "p.jpg"));
  const v = videoSize(out);
  assert.equal(v.width, 720);
  assert.equal(v.height, 1280);
});

test("길이 제한을 넘는 영상은 거절한다", async () => {
  const src = join(dir, "long.mp4");
  ffmpeg("-f", "lavfi", "-i", "color=c=black:size=160x90:rate=1", "-t", "200",
    "-c:v", "libx264", src);
  await assert.rejects(
    compressVideo(src, join(dir, "long-out.mp4"), join(dir, "l.jpg")),
    MediaRejected,
  );
});

test("사진은 긴 변 1920px 이하로 줄고 썸네일이 만들어진다", async () => {
  const src = join(dir, "big.png");
  ffmpeg("-f", "lavfi", "-i", "testsrc2=size=4000x3000", "-frames:v", "1", src);
  const out = join(dir, "photo.jpg");
  const thumb = join(dir, "photo-thumb.jpg");
  await compressPhoto(src, out, thumb);
  const dims = execFileSync("ffprobe", ["-v", "error", "-show_entries",
    "stream=width,height", "-of", "csv=p=0", out]).toString().trim();
  assert.equal(dims, "1920,1440");
  assert.ok(size(thumb) > 0 && size(thumb) < size(out));
});
