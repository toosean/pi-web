import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./tool-images.ts");
}

async function loadToolNames() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./tool-names.ts");
}

test("isReadToolName correctly identifies built-in and MCP read tool names", async () => {
  const { isReadToolName } = await loadToolNames();

  assert.equal(isReadToolName("read"), true);
  assert.equal(isReadToolName("READ"), true);
  assert.equal(isReadToolName("read_file"), true);
  assert.equal(isReadToolName("readFile"), true);
  assert.equal(isReadToolName("filesystem.read"), true);
  assert.equal(isReadToolName("mcp_read_file"), true);

  assert.equal(isReadToolName("write"), false);
  assert.equal(isReadToolName("bash"), false);
  assert.equal(isReadToolName("grep"), false);
  assert.equal(isReadToolName("thread_reader"), false);
});

test("extractReadImageInfo extracts image path and builds api url", async () => {
  const { extractReadImageInfo } = await loadSubject();

  const block = {
    type: "toolCall",
    toolCallId: "tc-1",
    toolName: "read",
    input: { path: "assets/logo.png" },
  };

  const info = extractReadImageInfo(block, "/project/root", "session-123");
  assert.notEqual(info, null);
  assert.equal(info.rawPath, "assets/logo.png");
  assert.equal(info.resolvedPath, "/project/root/assets/logo.png");
  assert.equal(info.imageUrl, "/api/files/project/root/assets/logo.png?type=read&sessionId=session-123");
});

test("extractReadImageInfo ignores non-image files", async () => {
  const { extractReadImageInfo } = await loadSubject();

  const block = {
    type: "toolCall",
    toolCallId: "tc-2",
    toolName: "read",
    input: { path: "src/index.ts" },
  };

  assert.equal(extractReadImageInfo(block, "/project/root"), null);
});

test("extractReadImageInfo ignores non-read tools", async () => {
  const { extractReadImageInfo } = await loadSubject();

  const block = {
    type: "toolCall",
    toolCallId: "tc-3",
    toolName: "write",
    input: { path: "photo.jpg" },
  };

  assert.equal(extractReadImageInfo(block, "/project/root"), null);
});

test("extractReadImageInfo supports streaming rawInput", async () => {
  const { extractReadImageInfo } = await loadSubject();

  const block = {
    type: "toolCall",
    toolCallId: "tc-4",
    toolName: "read_file",
    input: {},
    rawInput: JSON.stringify({ file_path: "/tmp/graph.svg" }),
  };

  const info = extractReadImageInfo(block);
  assert.notEqual(info, null);
  assert.equal(info.resolvedPath, "/tmp/graph.svg");
  assert.equal(info.imageUrl, "/api/files/tmp/graph.svg?type=read");
});
