const fs = require("node:fs");
const path = require("node:path");
const { requiredEnv, runIdentity } = require("./main.cjs");

const identity = runIdentity();
const root = fs.realpathSync(requiredEnv("RUNNER_TEMP"));
const filename = requiredEnv("STATE_impeccable_probe_file");
const probeId = requiredEnv("STATE_impeccable_probe_id");
const directory = path.dirname(filename);

if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(probeId) ||
  path.dirname(directory) !== root ||
  !/^impeccable-trace-probe-[A-Za-z0-9]{6}$/.test(path.basename(directory)) ||
  path.basename(filename) !== "probe-id" ||
  !fs.lstatSync(directory).isDirectory() ||
  !fs.lstatSync(filename).isFile() ||
  fs.statSync(filename).size !== probeId.length + 1
) {
  throw new Error("Invalid Impeccable logging probe state");
}
if (fs.readFileSync(filename, "utf8") !== `${probeId}\n`) {
  throw new Error("Impeccable logging probe state did not survive unchanged");
}

fs.unlinkSync(filename);
fs.rmdirSync(directory);
console.log("IMPECCABLE_TRACE_PROBE_POST " + JSON.stringify({
  ...identity,
  probe_id: probeId,
  at: new Date().toISOString(),
  shared_file_verified: true,
  native_path_present: fs.existsSync("/usr/local/bin/impeccable-engine"),
}));
