import assert from "node:assert/strict";
import test from "node:test";
import { buildId, buildRevision, checkServerBuild, deploymentStatus, pageBuildId, validateBuildResponse } from "../lib/appUpdates.ts";

const nonce = "0123456789abcdef0123456789abcdef";
const checkedAt = "2026-09-11T12:00:00.000Z";
const metadata = { nonce, buildId: "next-build-A", version: "0.21.0", revision: "a".repeat(40) };

test("reads actual page build identity and handles missing or malformed metadata", () => {
  assert.equal(pageBuildId(JSON.stringify({ buildId: "next-build-A" })), "next-build-A");
  for (const value of [null, "", "not json", "null", "[]", "{}", '{"buildId":22}']) {
    assert.equal(pageBuildId(value), null);
  }
  for (const value of ["", "x".repeat(129), "../build", "a\n", 42, null]) assert.equal(buildId(value), null);
  assert.equal(buildId("build_A.b-c"), "build_A.b-c");
  assert.equal(buildRevision("A".repeat(40)), "a".repeat(40));
  assert.equal(buildRevision("b".repeat(64)), "b".repeat(64));
  assert.equal(buildRevision("not-a-commit"), null);
});

test("requires a fresh challenge and valid build metadata", () => {
  const verified = validateBuildResponse({ ...metadata, ignored: "extra field" }, nonce, checkedAt);
  assert.deepEqual(verified, { status: "verified", buildId: metadata.buildId, version: metadata.version, revision: metadata.revision, checkedAt });
  for (const value of [null, [], {}, { ...metadata, nonce: "replayed" }, { ...metadata, buildId: "" }, { ...metadata, version: "latest" }]) {
    assert.equal(validateBuildResponse(value, nonce, checkedAt).status, "unavailable");
  }
  assert.deepEqual(validateBuildResponse({ ...metadata, nonce: "replayed" }, nonce, checkedAt), {
    status: "unavailable", reason: "unverified-freshness",
  });
  assert.equal(validateBuildResponse({ ...metadata, revision: "bad" }, nonce, checkedAt).revision, null);
});

test("compares builds, not package versions or git revisions, without inferring chronology", () => {
  const check = validateBuildResponse(metadata, nonce, checkedAt);
  assert.equal(deploymentStatus("next-build-A", check), "same");
  assert.equal(deploymentStatus("next-build-B", check), "different");
  assert.equal(deploymentStatus("next-build-A", { ...check, revision: "b".repeat(40) }), "same");
  assert.equal(deploymentStatus(null, check), "unknown");
  assert.equal(deploymentStatus("development", check), "development");
  assert.equal(deploymentStatus("next-build-A", { ...check, buildId: "development" }), "development");
  for (const unknown of [{ status: "idle" }, { status: "unavailable", reason: "offline" }]) {
    assert.equal(deploymentStatus("next-build-A", unknown), "unknown");
  }
});

test("build checks bypass GET caches and use a new challenge on every request", async (t) => {
  const challenges = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/build-info");
    assert.equal(init.method, "POST");
    assert.equal(init.cache, "no-store");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.headers["Content-Type"], "application/json");
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body), ["nonce"]);
    assert.match(body.nonce, /^[a-f0-9]{32}$/);
    challenges.push(body.nonce);
    return Response.json({ ...metadata, nonce: body.nonce });
  });
  assert.equal((await checkServerBuild()).status, "verified");
  assert.equal((await checkServerBuild()).status, "verified");
  assert.notEqual(challenges[0], challenges[1]);
});

test("failed, malformed, and replayed probes never report success", async (t) => {
  const cases = [
    [async () => { throw new TypeError("Network failure"); }, "network"],
    [async () => new Response("", { status: 503 }), "http"],
    [async () => new Response("<html>"), "invalid-response"],
    [async () => ({ ok: true, json: async () => { throw new TypeError("Invalid JSON in WebKit"); } }), "invalid-response"],
    [async () => Response.json({ ...metadata, nonce: "old" }), "unverified-freshness"],
  ];
  for (const [response, reason] of cases) {
    const mock = t.mock.method(globalThis, "fetch", response);
    assert.deepEqual(await checkServerBuild(), { status: "unavailable", reason });
    mock.mock.restore();
  }
});

test("aborts a hung check and exposes the timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  }));
  const pending = checkServerBuild();
  t.mock.timers.tick(4000);
  assert.deepEqual(await pending, { status: "unavailable", reason: "timeout" });
});

test("reports an unavailable challenge generator without attempting a request", async (t) => {
  t.mock.method(globalThis.crypto, "getRandomValues", () => { throw new Error("Unavailable"); });
  const request = t.mock.method(globalThis, "fetch", () => { throw new Error("Must not fetch"); });
  assert.deepEqual(await checkServerBuild(), { status: "unavailable", reason: "unsupported" });
  assert.equal(request.mock.callCount(), 0);
});
