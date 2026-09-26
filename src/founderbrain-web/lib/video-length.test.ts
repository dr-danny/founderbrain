import { test } from "node:test";
import assert from "node:assert/strict";
import { videoLengthError } from "./video-length";

test("accepts a clip at the 6 second limit", () => {
  assert.equal(videoLengthError("clip.mp4", 6), null);
  assert.equal(videoLengthError("clip.mp4", 6.04), null);
});

test("rejects a longer clip with the length in the message", () => {
  assert.equal(
    videoLengthError("InShot.mp4", 12.4),
    "InShot.mp4 is 12.4 seconds. Clips can be up to 6 seconds. Trim it and try again.",
  );
  assert.match(videoLengthError("long.mov", 42) ?? "", /42 seconds/);
});

test("rejects a video whose length cannot be read", () => {
  assert.match(videoLengthError("bad.webm", Number.NaN) ?? "", /Could not read the length/);
  assert.match(videoLengthError("bad.webm", Number.POSITIVE_INFINITY) ?? "", /Could not read the length/);
  assert.match(videoLengthError("bad.webm", 0) ?? "", /Could not read the length/);
});
