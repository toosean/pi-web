import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  DEFAULT_TOOL_INPUT_FORMAT,
  formatToolCallInput,
  formatToolInput,
  isToolInputFormat,
  parseToolInputFormat,
  resolveToolInputFormat,
} = await jiti.import("./tool-input-format.ts");
const { load: parseYaml } = await jiti.import("js-yaml");

test("parses only recognized format names", () => {
  assert.equal(parseToolInputFormat("yaml"), "yaml");
  assert.equal(parseToolInputFormat(" YAML "), "yaml");
  assert.equal(parseToolInputFormat("yml"), "yaml");
  assert.equal(parseToolInputFormat("JSON"), "json");
  assert.equal(parseToolInputFormat("toml"), null);
  assert.equal(parseToolInputFormat(""), null);
  assert.equal(parseToolInputFormat(undefined), null);
  assert.equal(parseToolInputFormat(null), null);
});

test("falls back to JSON when nothing valid is configured", () => {
  assert.equal(DEFAULT_TOOL_INPUT_FORMAT, "json");
  assert.equal(resolveToolInputFormat(undefined), "json");
  assert.equal(resolveToolInputFormat("nope"), "json");
  assert.equal(resolveToolInputFormat("yaml"), "yaml");
  assert.equal(isToolInputFormat("yaml"), true);
  assert.equal(isToolInputFormat("toml"), false);
});

test("keeps the JSON rendering when JSON is selected", () => {
  assert.equal(formatToolInput({ command: "ls", timeout: 30 }, "json"), '{\n  "command": "ls",\n  "timeout": 30\n}');
});

test("renders multi-line strings as literal block scalars", () => {
  // No trailing newline in the value -> strip chomping (`|-`).
  assert.equal(
    formatToolInput({ command: "printf 'a\nb\n' > f.txt" }, "yaml"),
    "command: |-\n  printf 'a\n  b\n  ' > f.txt",
  );
  // Trailing newline in the value -> clip chomping (`|`), exactly as requested.
  assert.equal(formatToolInput({ command: "a\nb\n" }, "yaml"), "command: |\n  a\n  b");
});

test("keeps long single-line values on one line", () => {
  const yaml = formatToolInput({ command: `helm template tc /tmp/tc ${"x".repeat(200)}` }, "yaml");
  assert.equal(yaml.split("\n").length, 1);
});

test("quotes values YAML cannot express as plain scalars", () => {
  assert.equal(formatToolInput({ raw: "a\tb" }, "yaml"), 'raw: "a\\tb"');
  assert.equal(formatToolInput({ flag: "yes" }, "yaml"), "flag: 'yes'");
});

test("round-trips every argument shape through the YAML rendering", () => {
  const samples = [
    { command: "printf 'apiVersion: v2\\nname: tc\\n' > /tmp/tc/Chart.yaml && cat /tmp/tc/Chart.yaml" },
    { command: "cat > /tmp/tc/templates/t.yaml <<'EOF'\na: {{ has \"x\" .Values.l }}\nb: {{ has .Values.l \"x\" }}\nEOF\nhelm template tc /tmp/tc -f /tmp/tc/v.yaml 2>&1 | head -6" },
    { subagent_type: "Explore", prompt: "line1\nline2", description: "Find parser", nested: { list: ["a\nb", "c"], flag: true, count: 3 } },
    { keepChomping: "trailing\n\n\n", empty: "", padded: "a  \nb", indented: "a\n  b" },
    { long: "x".repeat(300) },
  ];
  for (const sample of samples) {
    assert.deepEqual(parseYaml(formatToolInput(sample, "yaml")), sample);
  }
});

test("avoids anchors so repeated objects stay readable", () => {
  const shared = { a: 1 };
  const yaml = formatToolInput({ first: shared, second: shared }, "yaml");
  assert.deepEqual(parseYaml(yaml), { first: { a: 1 }, second: { a: 1 } });
  assert.doesNotMatch(yaml, /[&*]/);
});

test("never throws for values YAML or JSON cannot dump", () => {
  // YAML rejects functions/bigints; JSON drops functions but rejects bigints.
  assert.doesNotThrow(() => formatToolInput({ fn: () => {} }, "yaml"));
  assert.doesNotThrow(() => formatToolInput({ big: 10n }, "yaml"));
  assert.doesNotThrow(() => formatToolInput({ big: 10n }, "json"));
  assert.equal(formatToolInput({ fn: () => {} }, "yaml"), "{}");
});

test("streamed arguments stay verbatim in every format", () => {
  const streaming = { type: "toolCall", toolCallId: "c1", toolName: "bash", input: { command: "ls" }, rawInput: '{"command":"ls -' };
  assert.equal(formatToolCallInput(streaming, "json"), streaming.rawInput);
  assert.equal(formatToolCallInput(streaming, "yaml"), streaming.rawInput);

  const done = { type: "toolCall", toolCallId: "c2", toolName: "bash", input: { command: "a\nb" }, rawInput: "" };
  assert.equal(formatToolCallInput(done, "yaml"), "");
  assert.equal(formatToolCallInput({ ...done, rawInput: undefined }, "yaml"), "command: |-\n  a\n  b");
});
