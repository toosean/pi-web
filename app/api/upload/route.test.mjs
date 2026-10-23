import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { POST } = await jiti.import("./route.ts");
const temporaryRoot = tmpdir();

function fixture(t) {
  const dir = mkdtempSync(join(temporaryRoot, "pi-web-chat-upload-"));
  const original = Object.fromEntries(["TMPDIR", "TMP", "TEMP"].map((key) => [key, process.env[key]]));
  const roots = globalThis.__piAdditionalAllowedRoots;
  const cache = globalThis.__piAllowedRootsCache;
  globalThis.__piAdditionalAllowedRoots = new Set(roots);
  globalThis.__piAllowedRootsCache = undefined;
  for (const key of Object.keys(original)) process.env[key] = dir;
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    globalThis.__piAdditionalAllowedRoots = roots;
    globalThis.__piAllowedRootsCache = cache;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

async function upload(files) {
  const request = new Request("http://localhost/api/upload", { method: "POST", headers: { host: "localhost" } });
  // A bodyless adapter takes the parser's formData() fallback, letting the
  // concurrent test control when each File's arrayBuffer() completes.
  request.formData = async () => ({ getAll: (key) => key === "files" ? files : [] });
  const response = await POST(request);
  assert.equal(response.status, 200);
  return response.json();
}

test("a same-named existing temporary file is preserved and the new bytes get their own path", async (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, "report.txt"), "existing document");
  const saved = await upload([new File(["new document"], "report.txt")]);
  assert.notEqual(saved.filePath, join(dir, "report.txt"));
  assert.equal(readFileSync(join(dir, "report.txt"), "utf8"), "existing document");
  assert.equal(readFileSync(saved.filePath, "utf8"), "new document");
});

test("concurrent same-named attachments never overwrite each other's bytes", async (t) => {
  fixture(t);
  let arrived = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  class GatedFile extends File {
    async arrayBuffer() {
      if (++arrived === 2) release();
      await gate;
      return super.arrayBuffer();
    }
  }
  const results = await Promise.all([
    upload([new GatedFile(["first attachment"], "report.txt")]),
    upload([new GatedFile(["second attachment"], "report.txt")]),
  ]);
  assert.notEqual(results[0].filePath, results[1].filePath);
  assert.equal(readFileSync(results[0].filePath, "utf8"), "first attachment");
  assert.equal(readFileSync(results[1].filePath, "utf8"), "second attachment");
});
