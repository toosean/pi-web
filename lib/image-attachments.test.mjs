import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./image-attachments.ts");
}

const image = { type: "image", mimeType: "image/png", data: "YWJj" };

test("calculates padded base64 byte lengths and rejects invalid data", async () => {
  const { getBase64DecodedByteLength } = await loadSubject();

  assert.equal(getBase64DecodedByteLength("YQ=="), 1);
  assert.equal(getBase64DecodedByteLength("YWI="), 2);
  assert.equal(getBase64DecodedByteLength("YWJj"), 3);
  assert.equal(getBase64DecodedByteLength("not base64!"), null);
});

test("rejects invalid, oversized, and too many image attachments", async () => {
  const { MAX_ATTACHED_IMAGE_BYTES, MAX_ATTACHED_IMAGES, validateAgentImages } = await loadSubject();
  const oversizedData = "AAAA".repeat(Math.ceil((MAX_ATTACHED_IMAGE_BYTES + 1) / 3));

  assert.equal(validateAgentImages([image]), null);
  assert.match(validateAgentImages([{ ...image, mimeType: "text/plain" }]), /valid base64 image/);
  assert.match(validateAgentImages([{ ...image, data: oversizedData }]), /10MB/);
  assert.match(validateAgentImages(Array.from({ length: MAX_ATTACHED_IMAGES + 1 }, () => image)), /at most/);
});

test("compresses images only when width >= 800 or height >= 800", async () => {
  const { shouldCompressImage, calculateTargetDimensions } = await loadSubject();

  // 宽小于 800 且 高小于 800：不压缩
  assert.equal(shouldCompressImage(799, 799), false);
  assert.equal(shouldCompressImage(500, 600), false);
  assert.equal(shouldCompressImage(100, 100), false);
  assert.deepEqual(calculateTargetDimensions(500, 600, 800), { width: 500, height: 600, wasCompressed: false });

  // 宽 >= 800 或 高 >= 800：压缩
  assert.equal(shouldCompressImage(800, 600), true);
  assert.equal(shouldCompressImage(600, 800), true);
  assert.equal(shouldCompressImage(1600, 1200), true);
  assert.equal(shouldCompressImage(1080, 2400), true);

  // 等比压缩计算
  assert.deepEqual(calculateTargetDimensions(1600, 1200, 800), { width: 800, height: 600, wasCompressed: true });
  assert.deepEqual(calculateTargetDimensions(1200, 1600, 800), { width: 600, height: 800, wasCompressed: true });
});
