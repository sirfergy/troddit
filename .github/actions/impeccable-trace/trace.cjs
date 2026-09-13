const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_TRACE_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const COMMANDS = new Set(["engine-probe", "detect", "context", "info", "other"]);
const integer = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

class TraceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function digest(filename) {
  return createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

function parseTrace(text, expected) {
  let armed = false;
  const calls = new Map();
  const issues = [];
  const issue = (code) => { if (!issues.includes(code)) issues.push(code); };
  if (typeof text !== "string") throw new TraceError("invalid_trace_input");
  if (Buffer.byteLength(text) > MAX_TRACE_BYTES) {
    text = Buffer.from(text).subarray(0, MAX_TRACE_BYTES).toString("utf8");
    issue("oversized_trace");
  }
  if (!text.endsWith("\n")) {
    text = text.slice(0, text.lastIndexOf("\n") + 1);
    issue("truncated_trace");
  }
  for (const line of text.slice(0, -1).split("\n")) {
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      if (armed) issue("malformed_record");
      continue;
    }
    if (object(row) && row.event === "armed") {
      if (armed) throw new TraceError("multiple_arming_records");
      if (
        typeof row.trace_id !== "string" || !UUID.test(row.trace_id) ||
        row.trace_id !== expected.trace_id ||
        row.run_id !== expected.run_id ||
        row.run_attempt !== expected.run_attempt ||
        typeof row.native_sha256 !== "string" || !HASH.test(row.native_sha256) ||
        row.native_sha256 !== expected.native_sha256 ||
        typeof row.wrapper_sha256 !== "string" || !HASH.test(row.wrapper_sha256) ||
        row.wrapper_sha256 !== expected.wrapper_sha256 ||
        !integer(row.at_ms)
      ) {
        throw new TraceError("arming_identity_mismatch");
      }
      armed = true;
      continue;
    }
    if (!armed) continue;
    if (
      !object(row) || row.trace_id !== expected.trace_id ||
      typeof row.call_id !== "string" || !UUID.test(row.call_id) || !integer(row.at_ms)
    ) {
      issue("invalid_record_identity");
      continue;
    }
    if (row.event === "start") {
      if (!COMMANDS.has(row.command) || !integer(row.pid, 1) || calls.has(row.call_id)) {
        issue("invalid_or_duplicate_start");
        continue;
      }
      calls.set(row.call_id, {
        call_id: row.call_id,
        command: row.command,
        started_at_ms: row.at_ms,
        wrapper_pid: row.pid,
        status: "incomplete",
      });
      continue;
    }
    const call = calls.get(row.call_id);
    if (!call || call.status !== "incomplete") {
      issue("orphan_or_duplicate_completion");
      continue;
    }
    if (row.event === "complete" && integer(row.native_pid, 1) && integer(row.return_code, -64, 255)) {
      Object.assign(call, {
        status: "completed",
        finished_at_ms: row.at_ms,
        native_pid: row.native_pid,
        return_code: row.return_code,
      });
    } else if (row.event === "launch_error" && integer(row.error_number, 1, 4096)) {
      Object.assign(call, {
        status: "launch_failed",
        finished_at_ms: row.at_ms,
        error_number: row.error_number,
      });
    } else {
      issue("invalid_completion");
    }
  }
  if (!armed) throw new TraceError("trace_not_armed");
  const observed = [...calls.values()];
  if (observed.some((call) => call.status === "incomplete")) issue("unfinished_call");
  return {
    calls: observed,
    issues,
    outcome: issues.length ? "incomplete"
      : observed.some((call) => call.status === "completed") ? "native_completion_observed"
      : observed.length ? "launch_failure_observed" : "no_call_evidence",
  };
}

function readTrace({ root, filename, expected, entrypoint, native }) {
  root = fs.realpathSync(root);
  const directory = path.dirname(filename);
  if (
    !UUID.test(expected.trace_id) ||
    !HASH.test(expected.native_sha256) ||
    !HASH.test(expected.wrapper_sha256) ||
    path.dirname(directory) !== root ||
    !/^impeccable-trace-[A-Za-z0-9]{6}$/.test(path.basename(directory)) ||
    path.basename(filename) !== "calls.jsonl" ||
    !fs.lstatSync(directory).isDirectory()
  ) {
    throw new TraceError("invalid_trace_state");
  }
  const descriptor = fs.openSync(
    filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  );
  let text;
  let oversized = false;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new TraceError("invalid_trace_file");
    oversized = stat.size > MAX_TRACE_BYTES;
    const buffer = Buffer.alloc(MAX_TRACE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(descriptor, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
    }
    text = buffer.subarray(0, length).toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
  const result = parseTrace(text, expected);
  if (oversized && !result.issues.includes("oversized_trace")) result.issues.push("oversized_trace");
  try {
    if (digest(entrypoint) !== expected.wrapper_sha256 || digest(native) !== expected.native_sha256) {
      result.issues.push("installed_entrypoint_or_native_changed");
    }
  } catch (error) {
    if (!Number.isInteger(error.errno)) throw error;
    result.issues.push("installed_entrypoint_or_native_unavailable");
  }
  if (fs.existsSync(filename + ".degraded")) {
    result.issues.push("writer_reported_degradation");
  }
  if (result.issues.length) result.outcome = "incomplete";
  return result;
}

module.exports = { MAX_TRACE_BYTES, TraceError, digest, parseTrace, readTrace };
