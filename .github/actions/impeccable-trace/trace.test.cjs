const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { renderWrapper } = require("./main.cjs");
const { digest, parseTrace, readTrace, TraceError } = require("./trace.cjs");

function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "impeccable trace-test-")));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const native = path.join(directory, "native");
  const wrapper = path.join(directory, "wrapper.py");
  const traceDirectory = fs.mkdtempSync(path.join(directory, "impeccable-trace-"));
  const filename = path.join(traceDirectory, "calls.jsonl");
  const header = {
    event: "armed",
    trace_id: randomUUID(),
    run_id: "123",
    run_attempt: "1",
    native_sha256: "a".repeat(64),
    wrapper_sha256: "b".repeat(64),
    at_ms: Date.now(),
  };
  fs.writeFileSync(native, `#!/usr/bin/env python3
import json, os, sys, time
args = sys.argv[1:]
if "--sleep" in args:
    print("ready", flush=True)
    time.sleep(2)
elif "--argv" in args:
    print(json.dumps(args))
elif "--environment" in args:
    print(json.dumps([os.environ.get("IMPECCABLE_NO_TELEMETRY"), os.environ.get("IMPECCABLE_NO_UPDATE_CHECK")]))
else:
    data = sys.stdin.buffer.read()
    os.write(1, b"out:" + data)
    os.write(2, b"err:" + data)
sys.exit(int(args[-1]) if args and args[-1].isdigit() else 0)
`, { mode: 0o755 });
  fs.writeFileSync(wrapper, renderWrapper(native, filename, header.trace_id));
  header.native_sha256 = digest(native);
  header.wrapper_sha256 = digest(wrapper);
  fs.writeFileSync(filename, JSON.stringify(header) + "\n");
  const invoke = (args, input = Buffer.alloc(0)) => spawnSync("python3", [wrapper, ...args], {
    input,
    timeout: 5000,
    env: { ...process.env, IMPECCABLE_NO_TELEMETRY: "", IMPECCABLE_NO_UPDATE_CHECK: "" },
  });
  return {
    directory, native, wrapper, filename, header, invoke,
    read: () => parseTrace(fs.readFileSync(filename, "utf8"), header),
    collect: () => readTrace({ root: directory, filename, expected: header, entrypoint: wrapper, native }),
  };
}

test("preserves binary stdin, stdout, stderr, and native exit 0/1/2", (t) => {
  const f = fixture(t);
  const input = Buffer.from([0, 255, 10, 65]);
  for (const status of [0, 1, 2]) {
    const result = f.invoke(["detect", "--json", String(status)], input);
    assert.ifError(result.error);
    assert.equal(result.status, status);
    assert.deepEqual(result.stdout, Buffer.concat([Buffer.from("out:"), input]));
    assert.deepEqual(result.stderr, Buffer.concat([Buffer.from("err:"), input]));
  }
  const trace = f.read();
  assert.deepEqual(trace.issues, []);
  assert.deepEqual(trace.calls.map((call) => call.return_code), [0, 1, 2]);
  assert.ok(trace.calls.every((call) => call.status === "completed" && call.command === "detect"));
});

test("preserves argv but never records arguments, source paths, stdin, or URLs", (t) => {
  const f = fixture(t);
  const secret = "private-marker-for-test";
  const args = ["detect", "--argv", "two words", "quote'\"argument", `https://example.invalid/?token=${secret}`, "public/example.html"];
  const result = f.invoke(args);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout.toString()), args);
  const raw = fs.readFileSync(f.filename, "utf8");
  for (const value of [secret, "https://", "public/example.html", "two words", "quote"]) {
    assert.equal(raw.includes(value), false);
  }
  assert.equal(f.read().calls[0].command, "detect");
});

test("renders quoted paths and marker-like text as data, not executable code", (t) => {
  const f = fixture(t);
  const native = path.join(f.directory, `native-"__IMPECCABLE_TRACE_ID__"`);
  fs.renameSync(f.native, native);
  fs.writeFileSync(f.wrapper, renderWrapper(native, f.filename, f.header.trace_id));
  const result = f.invoke(["detect", "0"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.toString(), "out:");
  assert.equal(f.read().calls[0].return_code, 0);
});

test("disables supported telemetry and update checks for native calls", (t) => {
  const f = fixture(t);
  const result = f.invoke(["context", "--environment"]);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout.toString()), ["1", "1"]);
  assert.equal(f.read().calls[0].command, "context");
});

test("keeps help/version invocations separate from detect commands", (t) => {
  const f = fixture(t);
  for (const flag of ["--help", "-h", "--version", "-V"]) {
    assert.equal(f.invoke(["detect", flag]).status, 0);
  }
  assert.ok(f.read().calls.every((call) => call.command === "info"));
});

test("records a launch failure without claiming native completion", (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.native);
  const result = f.invoke(["detect"]);
  assert.equal(result.status, 127);
  const trace = f.read();
  assert.equal(trace.outcome, "launch_failure_observed");
  assert.equal(trace.calls[0].status, "launch_failed");
  assert.equal(trace.calls[0].return_code, undefined);
});

test("log symlinks do not alter files or prevent native execution", (t) => {
  const f = fixture(t);
  const outside = path.join(f.directory, "unrelated");
  fs.writeFileSync(outside, "untouched");
  fs.unlinkSync(f.filename);
  fs.symlinkSync(outside, f.filename);
  const result = f.invoke(["detect", "2"], Buffer.from("payload"));
  assert.equal(result.status, 2);
  assert.equal(result.stdout.toString(), "out:payload");
  assert.ok(result.stderr.includes(Buffer.from("Impeccable tracing is incomplete")));
  assert.equal(fs.readFileSync(outside, "utf8"), "untouched");
  assert.ok(fs.existsSync(f.filename + ".degraded"));
});

test("a FIFO trace sink cannot block the native invocation", (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.filename);
  const mkfifo = spawnSync("python3", ["-c", "import os,sys; os.mkfifo(sys.argv[1])", f.filename]);
  assert.equal(mkfifo.status, 0);
  const result = f.invoke(["detect", "2"]);
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.ok(fs.existsSync(f.filename + ".degraded"));
});

test("concurrent invocations produce complete, noninterleaved record pairs", async (t) => {
  const f = fixture(t);
  await Promise.all(Array.from({ length: 12 }, (_, index) => new Promise((resolve, reject) => {
    const child = spawn("python3", [f.wrapper, "detect", "0"]);
    const stdout = [];
    child.stdout.on("data", (data) => stdout.push(data));
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        assert.equal(code, 0);
        assert.equal(Buffer.concat(stdout).toString(), `out:${index}`);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(String(index));
  })));
  const trace = f.read();
  assert.deepEqual(trace.issues, []);
  assert.equal(trace.calls.length, 12);
  assert.equal(new Set(trace.calls.map((call) => call.call_id)).size, 12);
  assert.ok(trace.calls.every((call) => call.return_code === 0));
});

for (const signalName of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  test(`forwards ${signalName} and preserves the native termination result`, { timeout: 10000 }, async (t) => {
    const f = fixture(t);
    const run = (executable, args) => new Promise((resolve, reject) => {
      const child = spawn(executable, args);
      child.stdin.end();
      child.stderr.resume();
      child.once("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
      child.stdout.once("data", () => child.kill(signalName));
    });
    const bare = await run(f.native, ["detect", "--sleep"]);
    const wrapped = await run("python3", [f.wrapper, "detect", "--sleep"]);
    assert.deepEqual(wrapped, bare);
    const trace = f.read();
    assert.deepEqual(trace.issues, []);
    assert.equal(trace.calls[0].status, "completed");
    assert.equal(trace.calls[0].return_code, bare.signal ? -os.constants.signals[bare.signal] : bare.code);
  });
}

test("ignores pre-arming validation events and reports zero only as no evidence", (t) => {
  const f = fixture(t);
  assert.equal(f.invoke(["detect", "2"]).status, 2);
  const oldRows = fs.readFileSync(f.filename, "utf8").split("\n").slice(1).join("\n");
  const trace = parseTrace(oldRows + JSON.stringify(f.header) + "\n", f.header);
  assert.equal(trace.outcome, "no_call_evidence");
  assert.deepEqual(trace.calls, []);
});

test("reports malformed, orphaned, and unfinished records as incomplete", (t) => {
  const f = fixture(t);
  const at_ms = Date.now();
  const start = { event: "start", trace_id: f.header.trace_id, call_id: randomUUID(), at_ms, command: "detect", pid: 1 };
  const orphan = { event: "complete", trace_id: f.header.trace_id, call_id: randomUUID(), at_ms, native_pid: 2, return_code: 0 };
  fs.appendFileSync(f.filename, JSON.stringify(start) + "\nnot-json\n" + JSON.stringify(orphan) + "\n");
  const trace = f.read();
  assert.equal(trace.outcome, "incomplete");
  assert.ok(trace.issues.includes("malformed_record"));
  assert.ok(trace.issues.includes("orphan_or_duplicate_completion"));
  assert.ok(trace.issues.includes("unfinished_call"));
});

test("rejects missing, mismatched, duplicate, and truncated arming data", (t) => {
  const f = fixture(t);
  const encoded = JSON.stringify(f.header) + "\n";
  assert.throws(() => parseTrace("", f.header), TraceError);
  assert.throws(() => parseTrace("{}\n", f.header), /trace_not_armed/);
  assert.throws(() => parseTrace(encoded.slice(0, -1), f.header), /truncated/);
  assert.throws(() => parseTrace(encoded + encoded, f.header), /multiple_arming/);
  assert.throws(() => parseTrace(encoded, { ...f.header, trace_id: randomUUID() }), /identity_mismatch/);
  assert.throws(() => parseTrace(JSON.stringify({ ...f.header, trace_id: { toString: "bad" } }) + "\n", f.header), TraceError);
});

test("does not expose additional untrusted record fields", (t) => {
  const f = fixture(t);
  assert.equal(f.invoke(["detect", "0"]).status, 0);
  const rows = fs.readFileSync(f.filename, "utf8").trimEnd().split("\n").map(JSON.parse);
  for (const row of rows) row.secret = "do-not-publish-this";
  const trace = parseTrace(rows.map((row) => JSON.stringify(row)).join("\n") + "\n", f.header);
  assert.equal(JSON.stringify(trace).includes("do-not-publish-this"), false);
});

test("collects scoped records and explicitly reports writer degradation", (t) => {
  const f = fixture(t);
  assert.equal(f.invoke(["detect", "2"]).status, 2);
  assert.equal(f.collect().outcome, "native_completion_observed");
  fs.writeFileSync(f.filename + ".degraded", "");
  const result = f.collect();
  assert.equal(result.outcome, "incomplete");
  assert.equal(result.calls[0].return_code, 2);
  assert.ok(result.issues.includes("writer_reported_degradation"));
});

test("preserves collected diagnostics when the native file later disappears", (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.native);
  assert.equal(f.invoke(["detect"]).status, 127);
  const result = f.collect();
  assert.equal(result.outcome, "incomplete");
  assert.equal(result.calls[0].status, "launch_failed");
  assert.ok(result.issues.includes("installed_entrypoint_or_native_unavailable"));
});

test("rejects redirected trace paths, symlinks, and oversized files", (t) => {
  const f = fixture(t);
  assert.throws(() => readTrace({
    root: f.directory,
    filename: path.join(f.directory, "not-a-trace"),
    expected: f.header,
    entrypoint: f.wrapper,
    native: f.native,
  }), TraceError);
  const original = fs.readFileSync(f.filename);
  const outside = path.join(f.directory, "outside");
  fs.writeFileSync(outside, original);
  fs.unlinkSync(f.filename);
  fs.symlinkSync(outside, f.filename);
  assert.throws(() => f.collect());
  fs.unlinkSync(f.filename);
  fs.writeFileSync(f.filename, Buffer.alloc(1024 * 1024 + 1, 65));
  assert.throws(() => f.collect(), /invalid_trace_file/);
});

test("a FIFO cannot hang the post collector", (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.filename);
  assert.equal(spawnSync("python3", ["-c", "import os,sys; os.mkfifo(sys.argv[1])", f.filename]).status, 0);
  const args = {
    root: f.directory, filename: f.filename, expected: f.header, entrypoint: f.wrapper, native: f.native,
  };
  const result = spawnSync(process.execPath, [
    "-e", "require(process.argv[1]).readTrace(JSON.parse(process.argv[2]))",
    path.join(__dirname, "trace.cjs"), JSON.stringify(args),
  ], { timeout: 2000, encoding: "utf8" });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("invalid_trace_file"));
});

test("a closed stderr cannot make tracing prevent native execution", (t) => {
  const f = fixture(t);
  fs.unlinkSync(f.filename);
  const result = spawnSync("python3", [
    "-c", "import os,sys; os.close(2); os.execv(sys.executable, [sys.executable, *sys.argv[1:]])",
    f.wrapper, "detect", "--argv",
  ], { timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout.toString()), ["detect", "--argv"]);
});

test("the privileged installer refuses non-Actions execution", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "main.cjs")], {
    env: { ...process.env, GITHUB_ACTIONS: "false" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("requires GitHub-hosted Linux x64"));
});
