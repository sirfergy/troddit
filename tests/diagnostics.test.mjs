import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserPlatform, buildRevision, createDiagnosticBuffer, diagnose, inspectFeedCache, intersectsViewport,
  observeRequest, parseTranslation, validateBuildResponse,
} from "../lib/diagnostics.ts";

const freshBuild = {
  status: "verified", buildId: "build-a", revision: null, version: "0.21.0",
  checkedAt: "2026-09-11T00:00:00.000Z",
};
const worker = {
  status: "registered", controlled: true, controllerChanged: false,
  active: "activated", waiting: false, installing: false,
};
const snapshot = () => ({
  capturedAt: "2026-09-11T00:00:00.000Z", captureSource: "pointer",
  client: { buildId: "build-a", revision: null, version: "0.21.0", view: "feed" },
  browser: { family: "Safari", version: "26.0", platform: "iOS", standalone: true, online: true, secure: true },
  viewport: { width: 390, height: 664, visualWidth: 390, visualHeight: 664, offsetTop: 0, offsetLeft: 0, scale: 1 },
  layout: {
    available: true, htmlOverflowY: "auto", bodyOverflowY: "auto",
    owners: { post: 0, navigation: 0, peek: 0, dialog: 0, fullscreen: false },
    modalX: null, railY: null, activeMediaInput: false, zoom: 1, renderErrors: 0,
  },
  cache: { loaded: 0, malformed: 0, unreadable: 0 }, events: [], recorderFailures: 0,
});
const mediaSnapshot = () => {
  const value = snapshot();
  value.layout.owners.post = 1;
  value.layout.htmlOverflowY = "hidden";
  value.layout.bodyOverflowY = "hidden";
  value.layout.modalX = { offset: 0, expected: 0, quietForMs: 900 };
  value.layout.railY = { offset: -1992, expected: -3 * 664, quietForMs: 900 };
  return value;
};
const measured = (value) => diagnose(value, freshBuild, worker).filter((finding) => finding.confidence === "measured");

test("diagnoses vertical and horizontal offsets as separate measured invariants", () => {
  const value = mediaSnapshot();
  value.layout.railY.offset = -220;
  assert.deepEqual(measured(value).map((finding) => finding.code), ["vertical-offset"]);
  value.layout.railY.offset = value.layout.railY.expected;
  value.layout.modalX.offset = 220;
  assert.deepEqual(measured(value).map((finding) => finding.code), ["horizontal-offset"]);
});

test("normal indexed offsets, current viewport changes, gestures and zoom are not stuck rails", () => {
  const value = mediaSnapshot();
  value.viewport.height = 720;
  value.viewport.visualHeight = 420;
  assert.deepEqual(measured(value), []);
  value.layout.railY.offset = -220;
  value.layout.activeMediaInput = true;
  assert.deepEqual(measured(value), []);
  value.layout.activeMediaInput = false;
  value.layout.railY.quietForMs = 120;
  assert.deepEqual(measured(value), []);
  value.layout.railY.quietForMs = 900;
  value.layout.zoom = 2;
  assert.deepEqual(measured(value), []);
  value.layout.zoom = 1;
  value.layout.railY.quietForMs = null;
  assert.deepEqual(measured(value), []);
});

test("lock checks distinguish ordinary overflow-x hiding, real owners, and lost locks", () => {
  const value = snapshot();
  assert.deepEqual(measured(value), []);
  value.layout.htmlOverflowY = "hidden";
  assert.deepEqual(measured(value).map((finding) => finding.code), ["orphaned-scroll-lock"]);
  for (const owner of ["post", "navigation", "peek", "dialog"]) {
    value.layout.owners[owner] = 1;
    assert.deepEqual(measured(value), []);
    value.layout.owners[owner] = 0;
  }
  value.layout.owners.fullscreen = true;
  assert.deepEqual(measured(value), []);
  value.layout.owners.fullscreen = false;
  value.layout.htmlOverflowY = "auto";
  value.layout.owners.fullscreen = true;
  assert.deepEqual(measured(value), [], "Native fullscreen is not an app lock writer");
  value.layout.owners.fullscreen = false;
  value.layout.owners.dialog = 1;
  assert.deepEqual(measured(value), [], "Other dialogs do not prove an app lock was lost");
  value.layout.owners.dialog = 0;
  value.layout.owners.post = 1;
  assert.deepEqual(measured(value).map((finding) => finding.code), ["lost-scroll-lock"]);
});

test("cache inspection counts broken shapes without copying private keys or contents", () => {
  const privateData = { pages: [{ filtered: [{ data: { author: "PRIVATE_USER", selftext: "PRIVATE_TEXT" } }] }] };
  const broken = [[["feed", "PRIVATE_USER"], privateData]];
  const result = inspectFeedCache([undefined, privateData, broken, { pages: [{ filtered: "bad" }] }]);
  assert.deepEqual(result, { loaded: 3, malformed: 2, unreadable: 0 });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  const value = snapshot();
  value.cache = result;
  assert.ok(measured(value).some((finding) => finding.code === "feed-cache-shape"));
  assert.equal(inspectFeedCache([{ get pages() { throw new Error("PRIVATE_TOKEN"); } }]).unreadable, 1);
});

test("recording projects only allowlisted primitives, bounds retention, and excludes free text", () => {
  let clock = 0;
  const buffer = createDiagnosticBuffer(() => clock);
  buffer.request({
    operation: "/r/PRIVATE_SUB", method: "PRIVATE_METHOD", status: 403,
    outcome: "response", durationMs: 12,
    url: "https://private.invalid/u/PRIVATE_USER?token=PRIVATE_TOKEN",
    headers: { Authorization: "Bearer PRIVATE_TOKEN" }, body: "PRIVATE_TEXT t3_private",
  });
  const error = new TypeError("PRIVATE_TEXT PRIVATE_TOKEN");
  error.stack = "PRIVATE_URL";
  buffer.runtime("PRIVATE_SCOPE", error);
  buffer.resource("PRIVATE_PROVIDER", 4);
  const output = JSON.stringify(buffer.snapshot());
  assert.doesNotMatch(output, /PRIVATE_|Bearer|t3_private|https:|Authorization/);
  assert.equal(buffer.snapshot()[0].operation, "other");
  assert.equal(buffer.snapshot()[0].method, "OTHER");
  for (let i = 0; i < 60; i++) {
    clock++;
    buffer.request({ operation: "read", method: "GET", status: 500, outcome: "response", durationMs: 1 });
  }
  assert.equal(buffer.snapshot().length, 40);
  clock += 300001;
  assert.deepEqual(buffer.snapshot(), []);
});

test("resource noise and successful requests do not evict important failure evidence", () => {
  let clock = 0;
  const buffer = createDiagnosticBuffer(() => clock++);
  buffer.request({ operation: "save", method: "POST", status: 500, outcome: "response", durationMs: 10 });
  buffer.resource("app-code");
  for (let i = 0; i < 60; i++) {
    buffer.resource(i % 2 ? "image" : "video");
    buffer.request({ operation: "read", method: "GET", status: 200, outcome: "response", durationMs: 1 });
  }
  const events = buffer.snapshot();
  assert.ok(events.some((event) => event.kind === "request" && event.operation === "save"));
  assert.ok(events.filter((event) => event.kind === "resource" && event.resource !== "app-code").length <= 10);
  assert.ok(events.some((event) => event.kind === "resource" && event.resource === "app-code"));
  assert.ok(events.every((event) => event.kind !== "request" || event.status !== 200));
});

test("recorder failures expire instead of tainting the whole session", () => {
  let clock = 0;
  const buffer = createDiagnosticBuffer(() => clock);
  buffer.recordingFailed();
  assert.equal(buffer.failures, 1);
  clock = 300001;
  assert.equal(buffer.failures, 0);
});

test("request observation preserves the original response and rejection if recording fails", async () => {
  const response = { status: 200, body: "PRIVATE_TEXT" };
  const error = new Error("PRIVATE_TOKEN");
  let failures = 0;
  const recorder = () => { throw new Error("recorder broken"); };
  const classify = () => ({ status: null, cancelled: false });
  assert.equal(await observeRequest(async () => response, recorder, classify, () => failures++), response);
  await assert.rejects(observeRequest(async () => { throw error; }, recorder, classify, () => failures++), (actual) => actual === error);
  assert.equal(failures, 2);
});

test("cancelled requests are not diagnosed as connectivity failures", () => {
  const value = snapshot();
  value.events = [{ kind: "request", operation: "read", method: "GET", status: null, outcome: "cancelled", durationMs: 12, ageMs: 10 }];
  assert.ok(!diagnose(value, freshBuild, worker).some((finding) => finding.code === "recent-request-failure"));
  value.events[0].outcome = "response";
  value.events[0].status = 429;
  assert.ok(diagnose(value, freshBuild, worker).some((finding) => finding.code === "recent-request-failure" && finding.confidence === "possible"));
});

test("server build comparison requires a fresh nonce and usable metadata", () => {
  const nonce = "a".repeat(32);
  const payload = { nonce, buildId: "build-b", version: "0.21.0", revision: "b".repeat(40), token: "PRIVATE_TOKEN" };
  const result = validateBuildResponse(payload, nonce, freshBuild.checkedAt);
  assert.equal(result.status, "verified");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|nonce/);
  assert.deepEqual(validateBuildResponse(payload, "c".repeat(32), freshBuild.checkedAt), { status: "unavailable", reason: "unverified-freshness" });
  assert.equal(validateBuildResponse({ nonce, buildId: "https://private" }, nonce, freshBuild.checkedAt).status, "unavailable");
  assert.equal(buildRevision("not-a-revision"), null);
  const findings = diagnose(snapshot(), result, worker);
  assert.ok(findings.some((finding) => finding.code === "different-build" && finding.confidence === "context"));
  assert.ok(!findings.some((finding) => finding.code === "worker-waiting"));
});

test("chunk failures plus differing builds are plausible contributors, not proven SW faults", () => {
  const value = snapshot();
  value.events = [{ kind: "runtime", scope: "window", name: "ChunkLoadError", ageMs: 50 }];
  const findings = diagnose(value, { ...freshBuild, buildId: "build-b" }, worker);
  assert.equal(findings.find((finding) => finding.code === "app-code-load").confidence, "possible");
});

test("missing fields, unreadable state, and no matches never produce a healthy verdict", () => {
  assert.ok(diagnose(snapshot(), freshBuild, worker).some((finding) => finding.code === "no-cause-identified"));
  assert.equal(diagnose({}, freshBuild, worker)[0].code, "analysis-unavailable");
  const value = snapshot();
  Object.defineProperty(value, "layout", { get() { throw new Error("PRIVATE_TOKEN"); } });
  assert.equal(diagnose(value, freshBuild, worker)[0].code, "analysis-unavailable");
  assert.doesNotMatch(JSON.stringify(diagnose(value, freshBuild, worker)), /PRIVATE_TOKEN/);
});

test("historical and unscoped errors do not manufacture a current diagnosis", () => {
  const value = snapshot();
  value.events = [
    { kind: "request", operation: "account", method: "GET", status: 403, outcome: "response", durationMs: 10, ageMs: 240000 },
    { kind: "runtime", scope: "window", name: "TypeError", ageMs: 10 },
  ];
  const findings = diagnose(value, freshBuild, worker);
  assert.ok(findings.some((finding) => finding.code === "no-cause-identified"));
  assert.ok(!findings.some((finding) => finding.code === "recent-runtime-error"));
});

test("stale input is explicit uncertainty, not proof of release; small viewport scale noise is tolerated", () => {
  const value = mediaSnapshot();
  value.layout.railY.offset = -220;
  value.viewport.scale = 1.00001;
  assert.ok(measured(value).some((finding) => finding.code === "vertical-offset"));
  value.layout.activeMediaInput = true;
  value.layout.inputTrackingStale = true;
  const findings = diagnose(value, freshBuild, worker);
  assert.deepEqual(measured(value), []);
  assert.ok(findings.some((finding) => finding.explanation.includes("old contact")));
  assert.ok(findings.some((finding) => finding.code === "no-cause-identified"));
});

test("platform context recognizes desktop-mode iPads without relabeling other touch devices", () => {
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/26.0 Safari/605.1.15";
  const cases = [
    [mac, "MacIntel", 5, "iOS"],
    [mac, "MacIntel", 0, "macOS"],
    [mac, "MacIntel", 1, "macOS"],
    [mac, "MacPPC", 5, "macOS"],
    ["iPad; CPU OS 18_6 like Mac OS X", "iPad", 0, "iOS"],
    ["iPhone; CPU iPhone OS 18_6 like Mac OS X", "iPhone", 0, "iOS"],
    ["Linux; Android 16", "Linux armv8l", 5, "Android"],
    ["Windows NT 10.0", "Win32", 10, "Windows"],
    ["Windows NT 10.0", "MacIntel", 10, "Windows"],
    ["Linux PRIVATE_USER", "Linux", 5, "other"],
  ];
  for (const [ua, platform, points, expected] of cases) {
    assert.equal(browserPlatform(ua, platform, points), expected);
  }
});

test("fallback geometry requires positive overlap with the layout viewport", () => {
  const cases = [
    [{ left: 24, top: 100, right: 224, bottom: 148 }, true],
    [{ left: 24, top: 664, right: 224, bottom: 712 }, false],
    [{ left: 24, top: -48, right: 224, bottom: 0 }, false],
    [{ left: -200, top: 100, right: 0, bottom: 148 }, false],
    [{ left: 390, top: 100, right: 590, bottom: 148 }, false],
    [{ left: -20, top: 100, right: 180, bottom: 148 }, true],
    [{ left: -20, top: -20, right: 500, bottom: 800 }, true],
    [{ left: 20, top: 100, right: 20, bottom: 148 }, false],
    [{ left: 24, top: 100, right: 224, bottom: 100 }, false],
  ];
  for (const [rect, expected] of cases) {
    assert.equal(intersectsViewport(rect, 390, 664), expected);
  }
  assert.equal(intersectsViewport(cases[0][0], 0, 664), false);
  assert.equal(intersectsViewport(cases[0][0], 390, 0), false);
});

test("matrix parsing reads only translation components and rejects unavailable data", () => {
  assert.deepEqual(parseTranslation("matrix(1, 0, 0, 1, 220, -664)"), { x: 220, y: -664 });
  assert.deepEqual(parseTranslation("matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,220,-664,0,1)"), { x: 220, y: -664 });
  assert.deepEqual(parseTranslation("none"), { x: 0, y: 0 });
  assert.equal(parseTranslation(undefined), null);
  assert.equal(parseTranslation("matrix(1,0,0,1,NaN,0)"), null);
});
