import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./route.ts");
const { TOOL_INPUT_FORMAT_ENV } = await jiti.import("@/lib/tool-input-format");

async function readFormat() {
  const response = await GET();
  return (await response.json()).toolInputFormat;
}

test("reports the configured tool input format at runtime", async () => {
  const previous = process.env[TOOL_INPUT_FORMAT_ENV];
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    delete process.env[TOOL_INPUT_FORMAT_ENV];
    assert.equal(await readFormat(), "json");

    process.env[TOOL_INPUT_FORMAT_ENV] = "yaml";
    assert.equal(await readFormat(), "yaml");
    assert.equal(warnings.length, 0, "a valid value must not warn");

    process.env[TOOL_INPUT_FORMAT_ENV] = "toml";
    assert.equal(await readFormat(), "json");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /PI_WEB_TOOL_INPUT_FORMAT/);

    // The same bad value is only reported once so logs stay readable.
    assert.equal(await readFormat(), "json");
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
    if (previous === undefined) delete process.env[TOOL_INPUT_FORMAT_ENV];
    else process.env[TOOL_INPUT_FORMAT_ENV] = previous;
  }
});
