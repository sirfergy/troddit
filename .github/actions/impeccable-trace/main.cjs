const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

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

function main() {
  const identity = runIdentity();
  const state = requiredEnv("GITHUB_STATE");
  const root = fs.realpathSync(requiredEnv("RUNNER_TEMP"));
  const directory = fs.mkdtempSync(path.join(root, "impeccable-trace-probe-"));
  const filename = path.join(directory, "probe-id");
  const probeId = randomUUID();
  fs.writeFileSync(filename, `${probeId}\n`, { mode: 0o600 });
  fs.appendFileSync(
    state,
    `impeccable_probe_file=${filename}\nimpeccable_probe_id=${probeId}\n`
  );
  console.log("IMPECCABLE_TRACE_PROBE_MAIN " + JSON.stringify({
    ...identity,
    probe_id: probeId,
    at: new Date().toISOString(),
    native_path_present: fs.existsSync("/usr/local/bin/impeccable-engine"),
  }));
}

module.exports = { requiredEnv, runIdentity };

if (require.main === module) main();
