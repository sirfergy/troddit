const { randomUUID } = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { digest, parseTrace } = require("./trace.cjs");

const ENTRYPOINT = "/usr/local/bin/impeccable-engine";
const NATIVE = "/usr/local/lib/impeccable-trace/native";
const reviewEnvironment = {
  IMPECCABLE_NO_TELEMETRY: "1",
  IMPECCABLE_NO_UPDATE_CHECK: "1",
};

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || /[\r\n]/.test(value)) {
    throw new Error(`Missing or invalid ${name}`);
  }
  return value;
}

function runIdentity() {
  const runId = requiredEnv("GITHUB_RUN_ID");
  const runAttempt = requiredEnv("GITHUB_RUN_ATTEMPT");
  if (!/^\d+$/.test(runId) || !/^\d+$/.test(runAttempt)) {
    throw new Error("Invalid workflow run identity");
  }
  return { run_id: runId, run_attempt: runAttempt };
}

function renderWrapper(native, traceFile, traceId) {
  const values = { NATIVE: native, TRACE_FILE: traceFile, TRACE_ID: traceId };
  const template = fs.readFileSync(path.join(__dirname, "wrapper.py.in"), "utf8");
  return template.replace(/__IMPECCABLE_(NATIVE|TRACE_FILE|TRACE_ID)__/g, (_, key) => {
    if (typeof values[key] !== "string" || values[key].includes("\0")) {
      throw new Error("Invalid native tracing literal");
    }
    return JSON.stringify(values[key]);
  });
}

function invoke(executable, args, cwd) {
  const result = spawnSync(executable, args, {
    cwd,
    env: { ...process.env, ...reviewEnvironment },
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.signal) {
    throw new Error("Impeccable trace self-test did not complete");
  }
  return result;
}

function install(source, destination, mode) {
  execFileSync("sudo", ["install", "-D", "-m", mode, source, destination], {
    stdio: "inherit",
  });
}

function main() {
  if (
    process.platform !== "linux" ||
    process.arch !== "x64" ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.RUNNER_ENVIRONMENT !== "github-hosted"
  ) {
    throw new Error("Native tracing installation requires GitHub-hosted Linux x64");
  }

  const identity = runIdentity();
  const state = requiredEnv("GITHUB_STATE");
  const root = fs.realpathSync(requiredEnv("RUNNER_TEMP"));
  const workspace = fs.realpathSync(requiredEnv("GITHUB_WORKSPACE"));
  const expectedHash = requiredEnv("INPUT_SHA256");
  if (
    !/^[0-9a-f]{64}$/.test(expectedHash) ||
    !fs.lstatSync(ENTRYPOINT).isFile() ||
    digest(ENTRYPOINT) !== expectedHash
  ) {
    throw new Error("Installed Impeccable engine does not match its checksum pin");
  }

  const directory = fs.mkdtempSync(path.join(root, "impeccable-trace-"));
  const filename = path.join(directory, "calls.jsonl");
  const traceId = randomUUID();
  const candidate = path.join(path.dirname(ENTRYPOINT), `.impeccable-trace-${traceId}`);
  const source = path.join(directory, "wrapper.py");
  const fixture = path.join(directory, "self-test.html");
  fs.writeFileSync(filename, "", { mode: 0o600 });
  fs.writeFileSync(source, renderWrapper(NATIVE, filename, traceId), { mode: 0o600 });
  fs.writeFileSync(fixture, `<!doctype html><html lang="en"><title>Trace self-test</title>
<style>h1{background:linear-gradient(90deg,#a855f7,#06b6d4);background-clip:text;color:transparent}</style>
<h1>Trace self-test</h1></html>`, { mode: 0o600 });

  install(ENTRYPOINT, NATIVE, "0755");
  if (digest(NATIVE) !== expectedHash) {
    throw new Error("Copied Impeccable engine does not match its checksum pin");
  }
  install(source, candidate, "0755");
  const wrapperHash = digest(candidate);
  const header = {
    event: "armed",
    trace_id: traceId,
    ...identity,
    native_sha256: expectedHash,
    wrapper_sha256: wrapperHash,
    at_ms: Date.now(),
  };
  const expected = { ...header };
  const commands = [
    { args: ["engine-probe"], status: 0, command: "engine-probe" },
    { args: ["detect", "--no-config", "--json", fixture], status: 2, command: "detect" },
  ];
  for (const command of commands) {
    const bare = invoke(NATIVE, command.args, workspace);
    const traced = invoke(candidate, command.args, workspace);
    if (
      bare.status !== command.status ||
      traced.status !== bare.status ||
      !traced.stdout.equals(bare.stdout) ||
      !traced.stderr.equals(bare.stderr)
    ) {
      throw new Error("Tracing changed the native engine's self-test result");
    }
  }
  const validation = parseTrace(
    JSON.stringify(header) + "\n" + fs.readFileSync(filename, "utf8"),
    expected
  );
  if (
    validation.issues.length ||
    validation.calls.length !== commands.length ||
    validation.calls.some((call, index) =>
      call.status !== "completed" ||
      call.command !== commands[index].command ||
      call.return_code !== commands[index].status
    ) ||
    fs.existsSync(filename + ".degraded")
  ) {
    throw new Error("Native tracing self-test records are incomplete");
  }

  header.at_ms = Date.now();
  fs.writeFileSync(filename, JSON.stringify(header) + "\n");
  const saved = {
    impeccable_trace_file: filename,
    impeccable_trace_id: traceId,
    impeccable_native_sha256: expectedHash,
    impeccable_wrapper_sha256: wrapperHash,
  };
  if (Object.values(saved).some((value) => /[\r\n]/.test(value))) {
    throw new Error("Invalid native tracing action state");
  }
  fs.appendFileSync(
    state,
    Object.entries(saved).map(([key, value]) => `${key}=${value}\n`).join("")
  );

  // The installed entrypoint stays native until every validation above succeeds.
  execFileSync("sudo", ["mv", "-f", candidate, ENTRYPOINT], { stdio: "inherit" });
  console.log("IMPECCABLE_TRACE_ARMED " + JSON.stringify(header));
}

module.exports = {
  ENTRYPOINT, NATIVE, requiredEnv, runIdentity, renderWrapper, reviewEnvironment,
};

if (require.main === module) main();
