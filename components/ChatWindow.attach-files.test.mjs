import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { createJiti } from "jiti";
import ts from "typescript";

const jiti = createJiti(import.meta.url);
const { splitDroppedItems } = await jiti.import("../lib/file-upload-client.ts");

const sourceText = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("ChatWindow.tsx", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Runs one of ChatWindow's useCallback bodies against the given scope. */
function chatWindowCallback(name, context) {
  function findCallback(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      return node.initializer.arguments[0];
    }
    return ts.forEachChild(node, findCallback);
  }
  return new Script(ts.transpileModule(findCallback(source).getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText).runInNewContext(context);
}

const photo = new File(["x"], "photo.png", { type: "image/png" });
const report = new File(["x"], "report.pdf", { type: "application/pdf" });
const log = new File(["x"], "server.log", { type: "" });

/** Picks files with the composer's attach button, through ChatWindow's real drop path. */
function attachmentScope() {
  const calls = { images: [], files: [], notices: [] };
  const scope = {
    chatInputRef: {
      current: {
        addImages: (images) => calls.images.push(...images),
        addFiles: (files) => calls.files.push(...files),
      },
    },
    addNotice: (notice) => calls.notices.push([notice.type, notice.message]),
    t: (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    splitDroppedItems,
  };
  scope.onDrop = chatWindowCallback("onDrop", scope);
  return { calls, scope };
}

test("picked and dropped files use the composer's tracked attachment flow", () => {
  const picked = attachmentScope();
  chatWindowCallback("onAttachFiles", picked.scope)([photo, report, log]);
  assert.deepEqual(picked.calls.images, [photo]);
  assert.deepEqual(picked.calls.files, [report, log]);
  assert.deepEqual(picked.calls.notices, []);
  const dropped = attachmentScope();
  dropped.scope.onDrop([{ kind: "file", file: photo }, { kind: "file", file: report }, { kind: "file", file: log }]);
  assert.deepEqual(dropped.calls, picked.calls);
});

test("folders keep their rejection notice without discarding the other attachments", () => {
  const { calls, scope } = attachmentScope();
  scope.onDrop([{ kind: "folder", name: "folder" }, { kind: "file", file: report }]);
  assert.deepEqual(calls.files, [report]);
  assert.deepEqual(calls.notices, [["warning", 'chat.dropFoldersUnsupported {"names":"folder"}']]);
});
