import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registrationSource = await readFile(new URL("./PwaRegistration.tsx", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

test("development mode removes stale Pi Web service workers and caches", () => {
  assert.match(registrationSource, /process\.env\.NODE_ENV !== "production"/);
  assert.match(registrationSource, /getRegistrations\(\)/);
  assert.match(registrationSource, /registration\.unregister\(\)/);
  assert.match(registrationSource, /name\.startsWith\("pi-web-"\)/);
});

test("Next static assets use a versioned cache-first cache and navigation uses stale-while-revalidate", () => {
  assert.match(workerSource, /CACHE_SCHEMA = "v3"/);
  assert.match(workerSource, /url\.pathname\.startsWith\("\/_next\/static\/"\)/);
  assert.match(workerSource, /event\.respondWith\(cacheFirst\(request\)\)/);
  assert.match(workerSource, /async function cacheFirst/);
  assert.match(workerSource, /async function staleWhileRevalidate/);
});

test("service worker installation tolerates protected precache assets", () => {
  assert.match(workerSource, /Promise\.allSettled/);
  assert.match(workerSource, /fetch\(url, \{ credentials: "same-origin" \}\)/);
});
